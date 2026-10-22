import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type Notification,
  type Order,
  OrderStatus,
  type Payout,
  PayoutStatus,
  Prisma,
  type Submission,
  type User,
} from '@prisma/client';
import { InjectBot } from 'nestjs-telegraf';
import { fromMinor } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { HOLD_DAYS } from '../orders/budget';
import { SLOT_DAYS } from '../submissions/submissions.service';
import { Context, Markup, Telegraf, TelegramError } from 'telegraf';
import {
  creatorLabel,
  escapeHtml,
  formatDeadline,
  formatMoney,
  html,
  orderCategoryLabel,
  titleVisibleToCreators,
} from '../common/format';
import { parseModeratorIds } from '../auth/moderator.util';
import { type Lang, translator, userLang } from '../i18n/i18n';
import type { TFunction } from 'i18next';

type SubmissionWithParties = Submission & { order: Order; creator: User };

/** Строка очереди: кому, текст, экран для кнопки «Открыть» и язык её подписи. */
type Outgoing = Pick<Notification, 'chatId' | 'text' | 'html' | 'path'> & {
  lang?: Lang;
};

/** Получатель уведомления: кому писать и на каком языке (src/i18n, userLang). */
type Recipient = Pick<User, 'telegramId' | 'language' | 'telegramLanguage'>;

/** Текст на языке получателя: t — перевод, lang — для чисел и названий заказа. */
type Compose = (t: TFunction, lang: Lang) => string;

/** Сколько сообщений воркер берёт за раз и как часто смотрит в пустую очередь. */
const BATCH = 20;
const IDLE_MS = 1000;
const FAILED_IDLE_MS = 10_000;
/** Пауза между сообщениями: Telegram пускает ~30 сообщений в секунду на бота. */
const SEND_GAP_MS = 40;
/** Сколько ждать ответа Telegram на одно сообщение — зависший запрос не держит очередь. */
const SEND_TIMEOUT_MS = 10_000;
/** Попыток при сбоях сети и 5xx; 429 не считается — ждём, сколько сказал Telegram. */
const MAX_ATTEMPTS = 5;
/** Рассылки (новый заказ всем) — после обычных уведомлений. */
const PRIORITY_BROADCAST = 1;

/**
 * Все уведомления в чат бота о событиях из Mini App. К каждому — кнопка, открывающая нужный экран.
 *
 * Методы не ждут Telegram: пишут сообщение в очередь — таблицу Notification, — и HTTP-запрос
 * отвечает сразу (закрытие заказа с 50 откликами — это 50 сообщений). Воркер в этом же процессе
 * отправляет очередь по одному сообщению, в лимите Telegram, с таймаутом и повтором после 429.
 * Очередь в базе: неотправленное переживает рестарт, а несколько экземпляров не задвоят сообщения
 * (строки берутся через FOR UPDATE SKIP LOCKED).
 */
@Injectable()
export class NotificationsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(NotificationsService.name);
  private readonly moderatorIds: bigint[];
  private readonly webAppUrl: string;
  private stopping = false;
  private worker?: Promise<void>;

  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.moderatorIds = Array.from(
      parseModeratorIds(config.get<string>('MODERATOR_IDS')),
      (id) => BigInt(id),
    );
    this.webAppUrl = config.get<string>('WEBAPP_URL')!.replace(/\/$/, '');
  }

  /** Модераторам: новый заказ ждёт проверки. */
  orderCreated(order: Order & { advertiser: User }) {
    this.toModerators(
      this.orderCard('🆕 <b>Новый заказ на проверку</b>', order),
      `/mod/orders/${order.id}`,
    );
  }

  /**
   * Рекламодатель изменил заказ: модераторам — на повторную проверку; креаторам, которые уже
   * работают по нему, — что условия изменились. Кому слать — решает OrdersService.update (`notify`).
   */
  orderEdited(
    order: Order & { advertiser: User } & OrderWithCreators,
    notify: { moderators: boolean; creators: boolean },
  ) {
    if (notify.moderators)
      this.toModerators(
        this.orderCard('✏️ <b>Заказ изменён — снова на проверку</b>', order),
        `/mod/orders/${order.id}`,
      );
    if (notify.creators && order.submissions.length)
      this.toCreators(
        order,
        // по номеру, не по названию: новое название ещё не проверено модератором — в нём может быть контакт
        (t) => t('notify.orderEditedCreators', { id: order.id }),
      );
  }

  private orderCard(title: string, order: Order & { advertiser: User }) {
    return [
      title,
      '',
      `#${order.id}: <b>${escapeHtml(order.title)}</b>`,
      escapeHtml(order.description),
      orderCategoryLabel(order.category),
      `💰 Бюджет: ${formatMoney(fromMinor(order.budgetMinor))} · порог ${order.minViews.toLocaleString('ru-RU')} просмотров`,
      order.deadline ? `⏰ Дедлайн: ${formatDeadline(order.deadline)}` : '',
      `Рекламодатель: ${escapeHtml(creatorLabel(order.advertiser))}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Всем, кроме автора, модераторов, заблокированных и отписавшихся: в каталоге новый заказ.
   * Название уже проверено модератором. Бюджет не пишем — только ставку и порог.
   */
  newOrderPublished(order: Order) {
    // Получатели — одним INSERT … SELECT на язык: тысячи строк не идут через память процесса.
    // Язык — как userLang: выбранный в профиле, иначе русский только при русском Telegram.
    const notModerator = this.moderatorIds.length
      ? Prisma.sql`AND "telegramId" NOT IN (${Prisma.join(this.moderatorIds)})`
      : Prisma.empty;
    // COALESCE: без него NULL в «language» дал бы NULL во всём условии, и NOT не вернул бы русских
    const isEn = Prisma.sql`(COALESCE("language", '') = 'en' OR ("language" IS NULL AND COALESCE("telegramLanguage", '') NOT ILIKE 'ru%'))`;
    for (const lang of ['ru', 'en'] as const) {
      const t = translator(lang);
      const text = t('notify.newOrder', {
        title: order.title,
        cpm: money(lang, order.cpmMinor ?? 0),
        minViews: num(lang, order.minViews),
      });
      this.prisma.$executeRaw`
        INSERT INTO "Notification" ("chatId", "text", "path", "priority", "lang")
        SELECT "telegramId", ${text}, ${`/orders/${order.id}`}, ${PRIORITY_BROADCAST}, ${lang}
        FROM "User"
        WHERE id <> ${order.advertiserId} AND "bannedAt" IS NULL AND "notifyNewOrders"
          AND ${lang === 'en' ? isEn : Prisma.sql`NOT ${isEn}`} ${notModerator}`.catch(
        (err) => this.logger.error(err),
      );
    }
  }

  /** Модераторам: креатор прислал видео. */
  videoSubmitted(submission: SubmissionWithParties) {
    const text = [
      '🆕 <b>Новый отклик на модерацию</b>',
      '',
      `Заказ #${submission.order.id}: <b>${escapeHtml(submission.order.title)}</b>`,
      `Креатор: ${escapeHtml(creatorLabel(submission.creator))}`,
      `Видео: ${escapeHtml(submission.videoUrl ?? '')}`,
    ].join('\n');
    this.toModerators(text, `/mod/videos/${submission.id}`);
  }

  /** Модераторам: рекламодатель оставил отзыв с текстом — проверить до публикации. */
  reviewSubmitted(submission: SubmissionWithParties) {
    const text = [
      '🆕 <b>Отзыв на проверку</b>',
      '',
      `Заказ #${submission.order.id}: <b>${escapeHtml(submission.order.title)}</b>`,
      `Креатор: ${escapeHtml(creatorLabel(submission.creator))}`,
      `${'★'.repeat(submission.rating ?? 0)} ${escapeHtml(submission.review ?? '')}`,
    ].join('\n');
    this.toModerators(text, '/mod');
  }

  /** Рекламодателю: модератор опубликовал заказ. */
  orderApproved(order: Order & { advertiser: User }) {
    this.send(
      order.advertiser,
      (t) => t('notify.orderApproved', { title: order.title }),
      '/my-orders',
    );
  }

  /**
   * Рекламодателю: модератор отклонил заказ. Новый — разместить заново; правку опубликованного —
   * заказ заморожен, исправить правку или закрыть заказ.
   */
  orderRejected(order: Order & { advertiser: User }, comment: string) {
    const edit = order.status === OrderStatus.EDIT_REJECTED;
    this.send(
      order.advertiser,
      (t) =>
        t(edit ? 'notify.orderEditRejected' : 'notify.orderRejected', {
          title: order.title,
          reason: comment,
        }),
      edit ? '/my-orders' : `/my-orders/new?from=${order.id}`,
    );
  }

  /** Креаторам «в работе»: правку заказа одобрили — сдавать снова можно, слот продлён. */
  orderUnfrozen(order: OrderWithCreators) {
    this.toCreators(order, (t, lang) =>
      t('notify.orderUnfrozen', { order: forCreator(order, lang) }),
    );
  }

  /**
   * Модератор одобрил ролик: креатору — сколько начислено, рекламодателю — новый ролик по заказу
   * (оценить по желанию).
   */
  videoApprovedByModerator(
    submission: SubmissionWithParties & { order: { advertiser: User } },
  ) {
    const views = submission.views ?? 0;
    this.send(
      submission.creator,
      (t, lang) =>
        t('notify.videoApproved', {
          order: forCreator(submission.order, lang),
          views: num(lang, views),
          amount: money(lang, submission.payoutMinor),
          days: HOLD_DAYS,
        }),
      '/submissions',
      true,
    );
    this.send(
      submission.order.advertiser,
      (t, lang) =>
        t('notify.newVideo', {
          title: escapeHtml(submission.order.title),
          views: num(lang, views),
          url: escapeHtml(submission.videoUrl ?? ''),
        }),
      `/my-orders/${submission.order.id}/review`,
      true,
    );
  }

  /** Креатору: холд по ролику закончился, деньги можно вывести. */
  viewsFinalized(submission: SubmissionWithParties) {
    this.send(
      submission.creator,
      (t, lang) =>
        t('notify.holdReleased', {
          order: forCreator(submission.order, lang),
          amount: money(lang, submission.payoutMinor),
        }),
      '/submissions',
      true,
    );
  }

  /** Креатору: при итоге публикации не оказалось — начисление отменено. */
  publicationDeleted(submission: SubmissionWithParties) {
    this.send(
      submission.creator,
      (t, lang) =>
        t('notify.publicationDeleted', {
          order: forCreator(submission.order, lang),
        }),
      '/submissions',
      true,
    );
  }

  /** Креатору: модератор отклонил видео. */
  videoRejectedByModerator(submission: SubmissionWithParties, comment: string) {
    this.send(
      submission.creator,
      (t, lang) =>
        t('notify.videoRejected', {
          order: forCreator(submission.order, lang),
          reason: escapeHtml(comment),
        }),
      '/submissions',
      true,
    );
  }

  /** Креаторам с откликами на заказ: рекламодатель его закрыл. */
  orderClosed(order: OrderWithCreators) {
    this.toCreators(order, (t, lang) =>
      t('notify.orderClosed', { order: forCreator(order, lang) }),
    );
  }

  /** Креаторам, чьи слоты сгорели: рекламодатель закрыл замороженный заказ. */
  orderClosedSlotsBurned(order: OrderWithCreators) {
    this.toCreators(order, (t, lang) =>
      t('notify.orderClosedFrozen', { order: forCreator(order, lang) }),
    );
  }

  /** Бюджет заказа исчерпан, заказ закрыт: рекламодателю и креаторам «в работе». */
  orderBudgetExhausted(
    order: Order & { advertiser: User } & OrderWithCreators,
  ) {
    this.send(
      order.advertiser,
      (t) => t('notify.budgetExhausted', { title: escapeHtml(order.title) }),
      '/my-orders',
      true,
    );
    this.toCreators(order, (t, lang) =>
      t('notify.budgetExhaustedCreators', { order: forCreator(order, lang) }),
    );
  }

  /** Модератор закрыл заказ по жалобе: рекламодателю и креаторам с откликами. */
  orderClosedByModerator(
    order: Order & { advertiser: User } & OrderWithCreators,
  ) {
    this.send(
      order.advertiser,
      (t) => t('notify.closedByModerator', { title: escapeHtml(order.title) }),
      '/my-orders',
      true,
    );
    this.toCreators(order, (t, lang) =>
      t('notify.closedByModeratorCreators', { order: forCreator(order, lang) }),
    );
  }

  /** Модераторам: новая жалоба. */
  reportCreated(what: string) {
    this.toModerators(
      `🚩 Новая жалоба: ${escapeHtml(what)}`,
      '/mod?tab=reports',
    );
  }

  /**
   * Тем, кто жаловался: модератор рассмотрел жалобу. Язык — из базы, по telegramId. Промис —
   * когда сообщения уже в очереди: ждать его не обязательно (сбой — только в лог), но можно (тесты).
   */
  async reportResolved(telegramIds: bigint[], actioned: boolean) {
    if (!telegramIds.length) return;
    try {
      const users = await this.prisma.user.findMany({
        where: { telegramId: { in: telegramIds } },
      });
      if (!users.length) return;
      await this.prisma.notification.createMany({
        data: users.map((user) =>
          this.row(
            user,
            (t) =>
              t(actioned ? 'notify.reportActioned' : 'notify.reportDismissed'),
            '/',
          ),
        ),
      });
    } catch (err) {
      this.logger.error(err);
    }
  }

  /** Креаторам с откликами на заказ: рекламодатель его удалил. */
  orderRemoved(order: OrderWithCreators) {
    this.toCreators(order, (t, lang) =>
      t('notify.orderRemoved', { order: forCreator(order, lang) }),
    );
  }

  /** Срок заказа истёк: рекламодателю — что можно продлить, креаторам с откликом «в работе» — что видео уже не примут. */
  orderExpired(order: Order & { advertiser: User } & OrderWithCreators) {
    this.send(
      order.advertiser,
      (t) => t('notify.orderExpired', { title: escapeHtml(order.title) }),
      '/my-orders',
      true,
    );
    this.toCreators(order, (t, lang) =>
      t('notify.orderExpiredCreators', { order: forCreator(order, lang) }),
    );
  }

  /** Рекламодателю: совет по заказу (src/orders/order-insights.ts) — подробности в отчёте. */
  orderInsight(order: Order & { advertiser: User }, text: string) {
    this.send(
      order.advertiser,
      (t) => t('notify.insight', { title: order.title, text }),
      `/my-orders/${order.id}/review`,
    );
  }

  /** Креаторам с откликом «в работе»: срок заказа истекает меньше чем через сутки. */
  deadlineSoon(order: OrderWithCreators & Order) {
    this.toCreators(order, (t, lang) =>
      t('notify.deadlineSoon', { order: forCreator(order, lang) }),
    );
  }

  /** Креатору: слот по отклику сгорит меньше чем через сутки. */
  slotEndingSoon(submission: SubmissionWithParties) {
    this.send(
      submission.creator,
      (t, lang) =>
        t('notify.slotEndingSoon', {
          order: forCreator(submission.order, lang),
        }),
      `/submissions/${submission.id}/video`,
      true,
    );
  }

  /** Креатору: видео не прислали вовремя, слот сгорел. */
  slotExpired(submission: SubmissionWithParties) {
    this.send(
      submission.creator,
      (t, lang) =>
        t('notify.slotExpired', {
          order: forCreator(submission.order, lang),
          days: SLOT_DAYS,
        }),
      '/submissions',
      true,
    );
  }

  /** Модераторам: в очереди есть то, что ждёт дольше положенного. */
  moderationQueueStale(
    stale: {
      orders: number;
      videos: number;
      holds: number;
      payouts: number;
      reviews: number;
    },
    hours: number,
  ) {
    const parts = [
      stale.orders ? `заказов: ${stale.orders}` : '',
      stale.videos ? `видео: ${stale.videos}` : '',
      stale.holds ? `итогов просмотров: ${stale.holds}` : '',
      stale.payouts ? `заявок на вывод: ${stale.payouts}` : '',
      stale.reviews ? `отзывов: ${stale.reviews}` : '',
    ].filter(Boolean);
    this.toModerators(
      `🕓 Дольше ${hours} ч ждут проверки — ${parts.join(', ')}.`,
      '/mod',
    );
  }

  /** Креатору: аккаунт площадки подключён — просмотры его роликов там считаются сами. */
  socialAccountConnected(user: User, platformName: string) {
    this.send(
      user,
      (t) => t('notify.accountConnected', { platform: platformName }),
      '/profile',
    );
  }

  /**
   * Пользователю: кошелёк для выплат изменён или удалён — если это не он (угнали сессию Telegram),
   * узнает до того, как выведут деньги. Адрес — с краёв, этого хватит сверить.
   */
  walletChanged(user: User, wallet: string | null) {
    this.send(
      user,
      (t) =>
        wallet
          ? t('notify.walletChanged', {
              wallet: `${wallet.slice(0, 4)}…${wallet.slice(-4)}`,
            })
          : t('notify.walletRemoved'),
      '/profile',
    );
  }

  /** Креатору: заявку на вывод выполнили или отклонили. */
  payoutDecided(payout: Payout & { creator: User }) {
    this.send(
      payout.creator,
      (t, lang) =>
        payout.status === PayoutStatus.PAID
          ? t('notify.payoutPaid', { amount: money(lang, payout.amountMinor) })
          : t('notify.payoutRejected', {
              amount: money(lang, payout.amountMinor),
              reason: escapeHtml(payout.comment ?? ''),
            }),
      '/balance',
      true,
    );
  }

  /**
   * Файл в чат с ботом (отчёт CSV) — сразу, а не через очередь: пользователь ждёт ответа на экране.
   * `false` — не дошло (бота не запускали или заблокировали).
   */
  async sendFile(telegramId: bigint, content: string, filename: string) {
    try {
      await this.bot.telegram.sendDocument(telegramId.toString(), {
        source: Buffer.from(content, 'utf8'),
        filename,
      });
      return true;
    } catch (err) {
      this.logger.warn(err);
      return false;
    }
  }

  /** Креатору: рекламодатель оценил ролик. */
  videoRated(submission: SubmissionWithParties & { rating: number | null }) {
    if (!submission.rating) return;
    const rating = submission.rating;
    this.send(
      submission.creator,
      (t, lang) =>
        t('notify.videoRated', {
          order: forCreator(submission.order, lang),
          stars: '★'.repeat(rating) + '☆'.repeat(5 - rating),
        }),
      '/profile',
      true,
    );
  }

  onApplicationBootstrap() {
    this.worker = this.work();
  }

  /** Штатная остановка: дослать то, что воркер уже взял; остальное отправится после запуска. */
  async onApplicationShutdown() {
    this.stopping = true;
    await this.worker;
  }

  /** В очередь. Сбой записи не роняет действие, которое уже выполнено, — только в лог. */
  private enqueue(rows: Outgoing[]) {
    if (!rows.length) return;
    this.prisma.notification
      .createMany({ data: rows })
      .catch((err) => this.logger.error(err));
  }

  private toModerators(text: string, path: string) {
    this.enqueue(
      this.moderatorIds.map((chatId) => ({ chatId, text, html: true, path })),
    );
  }

  /** Каждому креатору один раз, даже если у него несколько попыток по заказу; на его языке. */
  private toCreators(order: OrderWithCreators, compose: Compose) {
    const creators = new Map(
      order.submissions.map((s) => [s.creator.telegramId, s.creator]),
    );
    this.enqueue(
      [...creators.values()].map((creator) => {
        const lang = userLang(creator);
        return {
          chatId: creator.telegramId,
          text: compose(translator(lang), lang),
          html: true,
          path: '/submissions',
          lang,
        };
      }),
    );
  }

  /** Пользователю — на его языке (выбранном в профиле или языке Telegram). */
  private send(to: Recipient, compose: Compose, path: string, asHtml = false) {
    this.enqueue([this.row(to, compose, path, asHtml)]);
  }

  /** Строка очереди для пользователя — текст на его языке. */
  private row(
    to: Recipient,
    compose: Compose,
    path: string,
    asHtml = false,
  ): Outgoing {
    const lang = userLang(to);
    return {
      chatId: to.telegramId,
      text: compose(translator(lang), lang),
      html: asHtml,
      path,
      lang,
    };
  }

  private async work() {
    while (!this.stopping) {
      let pause = IDLE_MS;
      try {
        if ((await this.processBatch()) > 0) continue;
      } catch (err) {
        // база недоступна — реже, чтобы не забить лог
        this.logger.error(err);
        pause = FAILED_IDLE_MS;
      }
      await sleep(pause);
    }
  }

  /**
   * Берёт пачку готовых сообщений и отправляет. Взятые откладываются на минуту — «аренда»: упади
   * процесс посреди пачки, другой экземпляр (или этот после рестарта) отправит их снова.
   * Возвращает, сколько взято. Вызывается и из тестов.
   */
  async processBatch(): Promise<number> {
    const batch = await this.prisma.$queryRaw<Notification[]>`
      UPDATE "Notification" SET "sendAfter" = now() + interval '1 minute'
      WHERE id IN (
        SELECT id FROM "Notification" WHERE "sendAfter" <= now()
        ORDER BY "priority", id LIMIT ${BATCH} FOR UPDATE SKIP LOCKED
      )
      RETURNING *`;
    if (!batch.length) return 0;
    batch.sort((a, b) => a.priority - b.priority || a.id - b.id);
    // Заблокированным бот не пишет — проверяем в момент отправки: бан мог случиться, пока ждали.
    const banned = new Set(
      (
        await this.prisma.user.findMany({
          where: {
            telegramId: { in: batch.map((n) => n.chatId) },
            bannedAt: { not: null },
          },
          select: { telegramId: true },
        })
      ).map((u) => u.telegramId),
    );
    for (const n of batch) {
      // остановка: недосланное из пачки уйдёт после рестарта, когда истечёт «аренда»
      if (this.stopping) break;
      if (!banned.has(n.chatId)) await this.deliver(n);
      else await this.prisma.notification.delete({ where: { id: n.id } });
      await sleep(SEND_GAP_MS);
    }
    return batch.length;
  }

  /** Одно сообщение: отправлено или повторять бессмысленно — удалить; иначе — повтор позже. */
  private async deliver(n: Notification) {
    const retry = await this.trySend(n);
    if (!retry) await this.prisma.notification.delete({ where: { id: n.id } });
    else
      await this.prisma.notification.update({
        where: { id: n.id },
        data: {
          sendAfter: new Date(Date.now() + retry.inMs),
          attempts: { increment: retry.counts ? 1 : 0 },
        },
      });
  }

  /** null — готово (доставлено или повтор не поможет); иначе — через сколько повторить. */
  private async trySend(
    n: Notification,
  ): Promise<{ inMs: number; counts: boolean } | null> {
    try {
      const kb = this.openButton(n.path, n.lang);
      await this.bot.telegram.callApi(
        'sendMessage',
        {
          chat_id: n.chatId.toString(),
          text: n.text,
          ...(n.html ? html(kb) : kb),
        },
        // telegraf типизирует сигнал своим полифилом; node-fetch принимает и встроенный
        { signal: AbortSignal.timeout(SEND_TIMEOUT_MS) as never },
      );
      return null;
    } catch (err) {
      const code = err instanceof TelegramError ? err.code : null;
      // 429 — не сбой: ждём, сколько сказал Telegram, попытку не тратим
      if (code === 429)
        return {
          inMs: ((err as TelegramError).parameters?.retry_after ?? 5) * 1000,
          counts: false,
        };
      // 4xx — заблокировал бота (403, обычное дело — не в лог), не запускал его, битый текст:
      // повтор не поможет
      if (code !== null && code < 500) {
        if (code !== 403)
          this.logger.warn(`Уведомление ${n.id} не доставлено: ${String(err)}`);
        return null;
      }
      // сеть, таймаут, 5xx — повторим с растущей паузой
      if (n.attempts + 1 < MAX_ATTEMPTS)
        return { inMs: (n.attempts + 1) * 30_000, counts: true };
      this.logger.error(
        `Уведомление ${n.id} брошено после ${MAX_ATTEMPTS} попыток: ${String(err)}`,
      );
      return null;
    }
  }

  /** Кнопка web_app работает только в личных чатах — все уведомления как раз туда. */
  private openButton(path: string, lang: string) {
    return Markup.inlineKeyboard([
      Markup.button.webApp(
        translator(lang === 'en' ? 'en' : 'ru')('bot.open'),
        this.webAppUrl + path,
      ),
    ]);
  }
}

/** Заказ в тексте креатору (HTML): название — только проверенное модератором, иначе номер. */
function forCreator(order: Order, lang: Lang) {
  if (!titleVisibleToCreators(order)) return `#${order.id}`;
  const title = escapeHtml(order.title);
  return lang === 'en' ? `“${title}”` : `«${title}»`;
}

/** Число с разделителями по языку: «12 500» / «12,500». */
function num(lang: Lang, n: number) {
  return n.toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU');
}

/** Сумма из центов: «12,5 USDT» / «12.5 USDT». */
function money(lang: Lang, minor: number) {
  return `${fromMinor(minor).toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU', { maximumFractionDigits: 2 })} USDT`;
}

type OrderWithCreators = Order & {
  submissions: { creator: Recipient }[];
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
