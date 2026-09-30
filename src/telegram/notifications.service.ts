import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type Order,
  type Payout,
  PayoutStatus,
  type Submission,
  type User,
} from '@prisma/client';
import { InjectBot } from 'nestjs-telegraf';
import { kopecksToRubles } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { VIEWS_TOPUP_DAYS } from '../orders/budget';
import { SLOT_DAYS } from '../submissions/submissions.service';
import { Context, Markup, Telegraf } from 'telegraf';
import {
  creatorLabel,
  escapeHtml,
  formatDeadline,
  formatRubles,
  html,
  orderCategoryLabel,
  titleVisibleToCreators,
} from '../common/format';
import { parseModeratorIds } from '../auth/moderator.util';

type SubmissionWithParties = Submission & { order: Order; creator: User };

/**
 * Все уведомления в чат бота о событиях из Mini App. К каждому — кнопка, открывающая нужный экран.
 * Каждая отправка глушит ошибку: получатель мог заблокировать бота или ещё не запускал его.
 *
 * Отправка — в фоне, через одну общую очередь: HTTP-запрос не ждёт Telegram (закрытие заказа
 * с 50 откликами — это 50 сообщений), а сообщения уходят по одному, что заодно держит бота
 * в лимите Telegram (~30 сообщений в секунду на бота).
 * ponytail: очередь в памяти — при падении процесса неотправленное теряется (при штатной остановке
 * дожидаемся её). Станет важно — таблица-очередь в Postgres.
 */
@Injectable()
export class NotificationsService implements OnApplicationShutdown {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly moderatorIds: string[];
  private readonly webAppUrl: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.moderatorIds = Array.from(
      parseModeratorIds(config.get<string>('MODERATOR_IDS')),
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
      `💰 Бюджет: ${formatRubles(kopecksToRubles(order.budgetMinor))} · порог ${order.minViews.toLocaleString('ru-RU')} просмотров`,
      order.deadline ? `⏰ Дедлайн: ${formatDeadline(order.deadline)}` : '',
      `Рекламодатель: ${escapeHtml(creatorLabel(order.advertiser))}`,
    ]
      .filter(Boolean)
      .join('\n');
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
      `✅ Ролик по заказу ${forCreator(submission.order)} одобрен: ${views} просмотров, начислено ${formatRubles(kopecksToRubles(submission.payoutMinor))}.\n\nЧерез ${VIEWS_TOPUP_DAYS} дня зафиксируем итог просмотров и доплатим за новые, пока в заказе есть бюджет. Вывести деньги — «Мои отклики» → «Баланс».`,
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
        ? `📈 Итог по ролику (заказ ${forCreator(submission.order)}): ${views} просмотров, доплачено ${formatRubles(kopecksToRubles(extraMinor))}.`
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
    const amount = formatRubles(kopecksToRubles(payout.amountMinor));
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

  /**
   * Штатная остановка (редеплой) — дослать очередь. Последний этап остановки: HTTP-сервер уже
   * закрыт и дождался запросов в работе, так что новых уведомлений после этого не появится.
   */
  async onApplicationShutdown() {
    await this.queue;
  }

  /** В очередь: задача выполнится после предыдущих; её сбой не останавливает следующие. */
  private enqueue(task: () => Promise<unknown>) {
    this.queue = this.queue.then(task).then(
      () => undefined,
      (err) => this.logger.error(err),
    );
  }

  private toModerators(text: string, path: string) {
    const extra = html(this.openButton(path));
    for (const modId of this.moderatorIds) {
      this.enqueue(async () => {
        try {
          await this.bot.telegram.sendMessage(modId, text, extra);
        } catch {
          // модератор ещё не запускал бота — пропускаем
        }
      });
    }
  }

  /** Каждому креатору один раз, даже если у него несколько попыток по заказу. */
  private toCreators(order: OrderWithCreators, text: string) {
    const seen = new Set<bigint>();
    for (const s of order.submissions) {
      if (seen.has(s.creator.telegramId)) continue;
      seen.add(s.creator.telegramId);
      this.send(s.creator.telegramId, text, '/submissions', true);
    }
  }

  private send(telegramId: bigint, text: string, path: string, asHtml = false) {
    const kb = this.openButton(path);
    this.enqueue(async () => {
      // Заблокированным бот не пишет. Проверяем в момент отправки: блокировка могла случиться,
      // пока сообщение ждало в очереди.
      const user = await this.prisma.user.findUnique({
        where: { telegramId },
        select: { bannedAt: true },
      });
      if (user?.bannedAt) return;
      try {
        await this.bot.telegram.sendMessage(
          telegramId.toString(),
          text,
          asHtml ? html(kb) : kb,
        );
      } catch {
        // получатель мог заблокировать бота
      }
    });
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
