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
  type Payout,
  PayoutStatus,
  Prisma,
  type Submission,
  type User,
} from '@prisma/client';
import { InjectBot } from 'nestjs-telegraf';
import { fromMinor } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { VIEWS_TOPUP_DAYS } from '../orders/budget';
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

type SubmissionWithParties = Submission & { order: Order; creator: User };

/** Строка очереди: кому, текст, экран для кнопки «Открыть». */
type Outgoing = Pick<Notification, 'chatId' | 'text' | 'html' | 'path'>;

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
   * работают по нему, — что условия изменились.
   */
  orderEdited(order: Order & { advertiser: User } & OrderWithCreators) {
    this.toModerators(
      this.orderCard('✏️ <b>Заказ изменён — снова на проверку</b>', order),
      `/mod/orders/${order.id}`,
    );
    if (order.submissions.length)
      this.toCreators(
        order,
        // по номеру, не по названию: новое название ещё не проверено модератором — в нём может быть контакт
        `✏️ Рекламодатель изменил условия заказа #${order.id}. Заказ снова на проверке у модератора — после одобрения новые условия будут в карточке заказа.`,
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
    const text = [
      `🆕 Новый заказ: «${order.title}»`,
      `${formatMoney(fromMinor(order.cpmMinor ?? 0))} за 1000 просмотров · сдать можно от ${order.minViews.toLocaleString('ru-RU')} просмотров`,
      '',
      'Отключить такие сообщения — «Профиль» → «Уведомления».',
    ].join('\n');
    // Получатели — одним INSERT … SELECT: тысячи строк не идут через память процесса.
    const notModerator = this.moderatorIds.length
      ? Prisma.sql`AND "telegramId" NOT IN (${Prisma.join(this.moderatorIds)})`
      : Prisma.empty;
    this.prisma.$executeRaw`
      INSERT INTO "Notification" ("chatId", "text", "path", "priority")
      SELECT "telegramId", ${text}, ${`/orders/${order.id}`}, ${PRIORITY_BROADCAST}
      FROM "User"
      WHERE id <> ${order.advertiserId} AND "bannedAt" IS NULL AND "notifyNewOrders" ${notModerator}`.catch(
      (err) => this.logger.error(err),
    );
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

  /** Рекламодателю: модератор опубликовал заказ. */
  orderApproved(order: Order & { advertiser: User }) {
    this.send(
      order.advertiser.telegramId,
      `✅ Ваш заказ «${order.title}» прошёл модерацию и опубликован — креаторы уже видят его в каталоге.`,
      '/my-orders',
    );
  }

  /**
   * Рекламодателю: модератор отклонил заказ. Если это изменённый открытый заказ — креаторам,
   * которые по нему работали: он снят, продолжать не нужно.
   */
  orderRejected(
    order: Order & { advertiser: User } & OrderWithCreators,
    comment: string,
  ) {
    this.send(
      order.advertiser.telegramId,
      `❌ Ваш заказ «${order.title}» отклонён модератором.\nПричина: ${comment}\n\nВы можете разместить заказ заново, учтя замечания.`,
      `/my-orders/new?from=${order.id}`,
    );
    this.toCreators(
      order,
      // название — непроверенное (его и отклонили), поэтому по номеру
      `🔒 Заказ #${order.id} после изменений не прошёл модерацию и снят — не продолжайте работу по нему.`,
    );
  }

  /**
   * Модератор одобрил ролик: креатору — сколько начислено, рекламодателю — новый ролик по заказу
   * (оценить по желанию).
   */
  videoApprovedByModerator(
    submission: SubmissionWithParties & { order: { advertiser: User } },
  ) {
    const views = (submission.views ?? 0).toLocaleString('ru-RU');
    this.send(
      submission.creator.telegramId,
      `✅ Ролик по заказу ${forCreator(submission.order)} одобрен: ${views} просмотров, начислено ${formatMoney(fromMinor(submission.payoutMinor))}.\n\nЧерез ${VIEWS_TOPUP_DAYS} дня зафиксируем итог просмотров и доплатим за новые, пока в заказе есть бюджет. Вывести деньги — «Профиль» → «Баланс».`,
      '/submissions',
      true,
    );
    this.send(
      submission.order.advertiser.telegramId,
      [
        '🎬 Новый ролик по вашему заказу',
        '',
        `Заказ: ${escapeHtml(submission.order.title)}`,
        `Просмотров: ${views}`,
        `Видео: ${escapeHtml(submission.videoUrl ?? '')}`,
      ].join('\n'),
      `/my-orders/${submission.order.id}/review`,
      true,
    );
  }

  /** Креатору: итог просмотров после добора и доплата. */
  viewsFinalized(submission: SubmissionWithParties, extraMinor: number) {
    const views = (submission.views ?? 0).toLocaleString('ru-RU');
    this.send(
      submission.creator.telegramId,
      extraMinor > 0
        ? `📈 Итог по ролику (заказ ${forCreator(submission.order)}): ${views} просмотров, доплачено ${formatMoney(fromMinor(extraMinor))}.`
        : `📈 Итог по ролику (заказ ${forCreator(submission.order)}): ${views} просмотров. Доплаты нет — новых просмотров нет или бюджет заказа исчерпан.`,
      '/submissions',
      true,
    );
  }

  /** Креатору: модератор отклонил видео. */
  videoRejectedByModerator(submission: SubmissionWithParties, comment: string) {
    this.send(
      submission.creator.telegramId,
      `❌ Ваш отклик на заказ ${forCreator(submission.order)} отклонён модератором.\nПричина: ${escapeHtml(comment)}\n\nВы можете отправить новый отклик на этот заказ.`,
      '/submissions',
      true,
    );
  }

  /** Креаторам с откликами на заказ: рекламодатель его закрыл. */
  orderClosed(order: OrderWithCreators) {
    this.toCreators(
      order,
      `🔒 Заказ ${forCreator(order)} закрыт рекламодателем. Новые отклики по нему больше не принимаются.`,
    );
  }

  /** Бюджет заказа исчерпан, заказ закрыт: рекламодателю и креаторам «в работе». */
  orderBudgetExhausted(
    order: Order & { advertiser: User } & OrderWithCreators,
  ) {
    this.send(
      order.advertiser.telegramId,
      `💸 Бюджет заказа «${escapeHtml(order.title)}» израсходован — заказ закрыт. Отчёт по роликам — в «Мои заказы».`,
      '/my-orders',
      true,
    );
    this.toCreators(
      order,
      `🔒 Бюджет заказа ${forCreator(order)} исчерпан — новые ролики по нему не принимаются.`,
    );
  }

  /** Модератор закрыл заказ по жалобе: рекламодателю и креаторам с откликами. */
  orderClosedByModerator(
    order: Order & { advertiser: User } & OrderWithCreators,
  ) {
    this.send(
      order.advertiser.telegramId,
      `🚫 Ваш заказ «${escapeHtml(order.title)}» закрыт модератором: он нарушает правила площадки. Если это ошибка — напишите в поддержку.`,
      '/my-orders',
      true,
    );
    this.toCreators(
      order,
      `🔒 Заказ ${forCreator(order)} закрыт модератором за нарушение правил площадки — не продолжайте работу по нему.`,
    );
  }

  /** Модераторам: новая жалоба. */
  reportCreated(what: string) {
    this.toModerators(
      `🚩 Новая жалоба: ${escapeHtml(what)}`,
      '/mod?tab=reports',
    );
  }

  /** Тем, кто жаловался: модератор рассмотрел жалобу. */
  reportResolved(telegramIds: bigint[], actioned: boolean) {
    const text = actioned
      ? '✅ Мы рассмотрели вашу жалобу и приняли меры. Спасибо, что помогаете площадке.'
      : '👌 Мы рассмотрели вашу жалобу — нарушений не нашли. Спасибо, что сообщили.';
    for (const id of telegramIds) this.send(id, text, '/');
  }

  /** Креаторам с откликами на заказ: рекламодатель его удалил. */
  orderRemoved(order: OrderWithCreators) {
    this.toCreators(
      order,
      `🗑 Заказ ${forCreator(order)} удалён рекламодателем. Отклик по нему больше не актуален.`,
    );
  }

  /** Срок заказа истёк: рекламодателю — что можно продлить, креаторам с откликом «в работе» — что видео уже не примут. */
  orderExpired(order: Order & { advertiser: User } & OrderWithCreators) {
    this.send(
      order.advertiser.telegramId,
      `⏰ Срок заказа «${escapeHtml(order.title)}» истёк — заказ закрыт, новые видео не принимаются.\n\nУже присланные ролики модератор проверит и оплатит из бюджета. Чтобы собрать ещё, продлите срок в «Мои заказы».`,
      '/my-orders',
      true,
    );
    this.toCreators(
      order,
      `⏰ Срок заказа ${forCreator(order)} истёк — видео по нему больше не принимаются.`,
    );
  }

  /** Рекламодателю: совет по заказу (src/orders/order-insights.ts) — подробности в отчёте. */
  orderInsight(order: Order & { advertiser: User }, text: string) {
    this.send(
      order.advertiser.telegramId,
      `💡 Совет по заказу «${order.title}»\n\n${text}\n\nВоронка и все советы — в отчёте по заказу.`,
      `/my-orders/${order.id}/review`,
    );
  }

  /** Креаторам с откликом «в работе»: срок заказа истекает меньше чем через сутки. */
  deadlineSoon(order: OrderWithCreators & Order) {
    this.toCreators(
      order,
      `⏳ Меньше чем через сутки истекает срок заказа ${forCreator(order)} — успейте отправить видео. После срока его не примут.`,
    );
  }

  /** Креатору: слот по отклику сгорит меньше чем через сутки. */
  slotEndingSoon(submission: SubmissionWithParties) {
    this.send(
      submission.creator.telegramId,
      `⏳ Меньше чем через сутки сгорит ваш слот по заказу ${forCreator(submission.order)} — успейте отправить видео.`,
      `/submissions/${submission.id}/video`,
      true,
    );
  }

  /** Креатору: видео не прислали вовремя, слот сгорел. */
  slotExpired(submission: SubmissionWithParties) {
    this.send(
      submission.creator.telegramId,
      `⌛ Слот по заказу ${forCreator(submission.order)} сгорел: видео не прислали за ${SLOT_DAYS} дней. Если заказ ещё открыт, можно откликнуться снова.`,
      '/submissions',
      true,
    );
  }

  /** Модераторам: в очереди есть то, что ждёт дольше положенного. */
  moderationQueueStale(
    stale: { orders: number; videos: number; topups: number; payouts: number },
    hours: number,
  ) {
    const parts = [
      stale.orders ? `заказов: ${stale.orders}` : '',
      stale.videos ? `видео: ${stale.videos}` : '',
      stale.topups ? `итогов просмотров: ${stale.topups}` : '',
      stale.payouts ? `заявок на вывод: ${stale.payouts}` : '',
    ].filter(Boolean);
    this.toModerators(
      `🕓 Дольше ${hours} ч ждут проверки — ${parts.join(', ')}.`,
      '/mod',
    );
  }

  /** Креатору: заявку на вывод выполнили или отклонили. */
  payoutDecided(payout: Payout & { creator: User }) {
    const amount = formatMoney(fromMinor(payout.amountMinor));
    this.send(
      payout.creator.telegramId,
      payout.status === PayoutStatus.PAID
        ? `💸 Выплата ${amount} отправлена. Если деньги не пришли — напишите в поддержку.`
        : `❌ Заявка на вывод ${amount} отклонена.\nПричина: ${escapeHtml(payout.comment ?? '')}\n\nСумма вернулась на баланс.`,
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
    this.send(
      submission.creator.telegramId,
      `⭐ Рекламодатель оценил ваш ролик по заказу ${forCreator(submission.order)}: ${'★'.repeat(submission.rating)}${'☆'.repeat(5 - submission.rating)}`,
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

  /** Каждому креатору один раз, даже если у него несколько попыток по заказу. */
  private toCreators(order: OrderWithCreators, text: string) {
    const ids = new Set(order.submissions.map((s) => s.creator.telegramId));
    this.enqueue(
      [...ids].map((chatId) => ({
        chatId,
        text,
        html: true,
        path: '/submissions',
      })),
    );
  }

  private send(chatId: bigint, text: string, path: string, asHtml = false) {
    this.enqueue([{ chatId, text, html: asHtml, path }]);
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
      const kb = this.openButton(n.path);
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
  private openButton(path: string) {
    return Markup.inlineKeyboard([
      Markup.button.webApp('Открыть', this.webAppUrl + path),
    ]);
  }
}

/** Заказ в тексте креатору (HTML): название — только проверенное модератором, иначе номер. */
function forCreator(order: Order) {
  return titleVisibleToCreators(order)
    ? `«${escapeHtml(order.title)}»`
    : `#${order.id}`;
}

type OrderWithCreators = Order & {
  submissions: { creator: { telegramId: bigint } }[];
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
