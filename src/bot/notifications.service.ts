import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Order, Submission, User } from '@prisma/client';
import { InjectBot } from 'nestjs-telegraf';
import { kopecksToRubles } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { Context, Markup, Telegraf } from 'telegraf';
import {
  creatorLabel,
  escapeHtml,
  formatDeadline,
  formatPrice,
  html,
  orderCategoryLabel,
} from './utils/format';
import { parseModeratorIds } from './utils/moderator.util';

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
      `💰 ${formatPrice(kopecksToRubles(order.priceKopecks))}`,
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

  /** Рекламодателю: модератор одобрил видео — теперь решение за ним. */
  videoApprovedByModerator(
    submission: Submission & { order: Order & { advertiser: User } },
  ) {
    const text = [
      '🎬 Новое видео на проверку',
      '',
      `Заказ: ${escapeHtml(submission.order.title)}`,
      `Видео: ${escapeHtml(submission.videoUrl ?? '')}`,
    ].join('\n');
    this.send(
      submission.order.advertiser.telegramId,
      text,
      `/my-orders/${submission.order.id}/review`,
      true,
    );
  }

  /** Креатору: модератор отклонил видео. */
  videoRejectedByModerator(submission: SubmissionWithParties, comment: string) {
    this.send(
      submission.creator.telegramId,
      `❌ Ваш отклик на заказ «${submission.order.title}» отклонён модератором.\nПричина: ${comment}\n\nВы можете отправить новый отклик на этот заказ.`,
      '/submissions',
    );
  }

  /** Креаторам с откликами на заказ: рекламодатель его закрыл. */
  orderClosed(order: OrderWithCreators) {
    this.toCreators(
      order,
      `🔒 Заказ «${escapeHtml(order.title)}» закрыт рекламодателем. Новые отклики по нему больше не принимаются.`,
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
      `🔒 Заказ «${escapeHtml(order.title)}» закрыт модератором за нарушение правил площадки — не продолжайте работу по нему.`,
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
      `🗑 Заказ «${escapeHtml(order.title)}» удалён рекламодателем. Отклик по нему больше не актуален.`,
    );
  }

  /** Срок заказа истёк: рекламодателю — что можно продлить, креаторам с откликом «в работе» — что видео уже не примут. */
  orderExpired(order: Order & { advertiser: User } & OrderWithCreators) {
    this.send(
      order.advertiser.telegramId,
      `⏰ Срок заказа «${escapeHtml(order.title)}» истёк — заказ закрыт, новые видео не принимаются.\n\nУже присланные видео можно принять или отклонить. Чтобы собрать ещё, продлите срок в «Мои заказы».`,
      '/my-orders',
      true,
    );
    this.toCreators(
      order,
      `⏰ Срок заказа «${escapeHtml(order.title)}» истёк — видео по нему больше не принимаются.`,
    );
  }

  /** Креаторам с откликом «в работе»: срок заказа истекает меньше чем через сутки. */
  deadlineSoon(order: OrderWithCreators & Order) {
    this.toCreators(
      order,
      `⏳ Меньше чем через сутки истекает срок заказа «${escapeHtml(order.title)}» — успейте отправить видео. После срока его не примут.`,
    );
  }

  /** Модераторам: в очереди есть то, что ждёт дольше положенного. */
  moderationQueueStale(orders: number, videos: number, hours: number) {
    const parts = [
      orders ? `заказов: ${orders}` : '',
      videos ? `видео: ${videos}` : '',
    ].filter(Boolean);
    this.toModerators(
      `🕓 Дольше ${hours} ч ждут проверки — ${parts.join(', ')}.`,
      '/mod',
    );
  }

  /** Креатору: рекламодатель принял видео. */
  videoAccepted(submission: SubmissionWithParties) {
    this.send(
      submission.creator.telegramId,
      `🎉 Рекламодатель подтвердил ваше видео по заказу «${submission.order.title}»!` +
        (submission.rating
          ? `\nОценка: ${'★'.repeat(submission.rating)}${'☆'.repeat(5 - submission.rating)}`
          : ''),
      '/submissions',
    );
  }

  /** Креатору: рекламодатель отклонил видео. */
  videoRejectedByAdvertiser(
    submission: SubmissionWithParties,
    comment: string,
  ) {
    this.send(
      submission.creator.telegramId,
      `❌ Рекламодатель отклонил ваше видео по заказу «${submission.order.title}».\nПричина: ${comment}\n\nВы можете отправить новый отклик на этот заказ.`,
      '/submissions',
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

type OrderWithCreators = Order & {
  submissions: { creator: { telegramId: bigint } }[];
};
