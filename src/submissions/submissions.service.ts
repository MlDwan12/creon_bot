import { tr, trNum } from '../i18n/request-lang';
import { randomBytes } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import {
  Prisma,
  OrderStatus,
  SubmissionStatus,
  VideoPlatform,
} from '@prisma/client';
import {
  ACCRUED,
  budgetState,
  payoutFor,
  spentByOrder,
  HOLD_DAYS,
} from '../orders/budget';
import { DAY_MS } from '../orders/deadline';
import { titleVisibleToCreators } from '../common/format';
import { PLATFORMS, platformOf, videoKey } from '../common/platforms';
import { closeOpenOrders, isFrozen, lockOrder } from '../orders/order-status';
import {
  transitionSubmission,
  tryTransitionSubmission,
} from './submission-status';
import { PrismaService } from '../prisma/prisma.service';
import { ViewCounterService } from './view-counter.service';

/** Заказ не снят модератором: по снятому видео не одобряют и не оплачивают. */
const NOT_TAKEN_DOWN: Prisma.OrderWhereInput = {
  status: { not: OrderStatus.REJECTED },
};

/** Сколько дней у креатора на видео после отклика — потом слот сгорает (SLOT_EXPIRED). */
export const SLOT_DAYS = 7;

/** До какого момента креатор должен прислать видео по отклику «в работе». */
export function slotDueAt(createdAt: Date) {
  return new Date(createdAt.getTime() + SLOT_DAYS * DAY_MS);
}

/**
 * По таким заказам видео ещё принимают (как в attachVideo) — только тогда слот может сгореть.
 * Замороженный на время правки (PENDING_MODERATION, EDIT_REJECTED) видео не принимает и слоты не
 * жжёт: после одобрения правки они продлеваются (OrdersService.moderatorApprove).
 */
const ACCEPTS_VIDEOS: Prisma.OrderWhereInput = {
  status: {
    notIn: [
      OrderStatus.EXPIRED,
      OrderStatus.REJECTED,
      OrderStatus.PENDING_MODERATION,
      OrderStatus.EDIT_REJECTED,
    ],
  },
};

// Свободного остатка может не хватать и из-за резерва роликов на проверке — тогда он ещё вернётся.
const EXHAUSTED_MESSAGE = () => tr('errors.budgetShort');

const ALREADY_CLAIMED_MESSAGE = () => tr('errors.alreadyClaimed');

/** Причина отклонения, когда публикацию удалили до конца холда — креатор увидит её. */
export const PUBLICATION_DELETED =
  'Публикация удалена до итога просмотров — начисление отменено';

const DUPLICATE_VIDEO_MESSAGE = () => tr('errors.duplicateVideo');

const isDuplicate = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

@Injectable()
export class SubmissionsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly viewCounter: ViewCounterService,
  ) {}

  onApplicationBootstrap() {
    this.backfillVideoKeys().catch((err) =>
      this.logger.error('Не удалось заполнить videoKey старых роликов', err),
    );
  }

  /**
   * Ключ ролика для сданных до появления videoKey — чтобы их не сдали повторно (Submission_video_once).
   * Если тот же ролик уже на проверке или оплачен по другому отклику, ключ не ставим (индекс не даст):
   * такие дубли логируем для модераторов, остальное заполнится.
   * ponytail: по строке на запрос и повтор дублей при каждом старте — старых роликов сотни, не миллионы.
   */
  async backfillVideoKeys() {
    const rows = await this.prisma.submission.findMany({
      where: { videoKey: null, videoUrl: { not: null } },
      select: { id: true, videoUrl: true },
      orderBy: { id: 'asc' },
    });
    const duplicates: number[] = [];
    let filled = 0;
    for (const { id, videoUrl } of rows) {
      let key: string;
      try {
        key = videoKey(videoUrl!);
      } catch {
        continue; // не ссылка — сравнивать не с чем
      }
      try {
        await this.prisma.submission.update({
          where: { id },
          data: { videoKey: key },
        });
        filled++;
      } catch (err) {
        if (!isDuplicate(err)) throw err;
        duplicates.push(id);
      }
    }
    if (duplicates.length)
      this.logger.warn(
        `Один ролик сдан несколько раз — отклики без ключа: ${duplicates.join(', ')}`,
      );
    return { filled, duplicates };
  }

  /**
   * Видео по заказу креатор может присылать сколько угодно, но по одному: новый отклик — только
   * когда нет отклика «в работе» (без видео). Иначе двойной тап плодил бы пустые отклики.
   */
  hasInProgress(orderId: number, creatorId: number) {
    return this.prisma.submission
      .findFirst({
        where: { orderId, creatorId, status: SubmissionStatus.IN_PROGRESS },
      })
      .then((s) => s !== null);
  }

  async claim(orderId: number, creatorId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException(tr('errors.orderNotFound'));
    if (order.status !== OrderStatus.OPEN)
      throw new ForbiddenException(tr('errors.orderUnavailable'));
    if (order.advertiserId === creatorId)
      throw new ForbiddenException(tr('errors.ownOrder'));
    // без блокировки: сдачу всё равно проверит attachVideo, здесь — не брать слот впустую
    if ((await this.orderBudget(order)).exhausted)
      throw new ForbiddenException(EXHAUSTED_MESSAGE());
    // ponytail: заказ могут закрыть между проверкой и вставкой — отклик на только что закрытый
    // заказ безвреден (видео по закрытому принимаются), блокировать ради этого незачем.
    try {
      return await this.prisma.submission.create({
        // 72 случайных бита: перебором чужую ссылку не найти, совпадение кодов невероятно
        data: {
          orderId,
          creatorId,
          trackCode: randomBytes(9).toString('base64url'),
        },
        include: { order: true, creator: true },
      });
    } catch (err) {
      // Второй отклик «в работе» (двойной тап) не пустит частичный уникальный индекс
      // Submission_one_in_progress — отклики разных креаторов друг другу не мешают.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        throw new ForbiddenException(ALREADY_CLAIMED_MESSAGE());
      throw err;
    }
  }

  /**
   * Можно ли сдать это видео по отклику: он ваш, «в работе», заказ ещё принимает видео, площадка —
   * из разрешённых в заказе. Проверка до
   * обращения к API площадки (квота YouTube) — attachVideo всё равно повторит её под блокировкой.
   */
  private async assertCanSubmit(
    submissionId: number,
    creatorId: number,
    videoUrl: string,
  ) {
    const submission = await this.mustFind(submissionId);
    if (submission.creatorId !== creatorId)
      throw new ForbiddenException(tr('errors.notYourSubmission'));
    if (submission.status !== SubmissionStatus.IN_PROGRESS)
      throw new ForbiddenException(tr('errors.submissionProcessed'));
    // После срока видео не принимаются. После ручного закрытия — принимаются, пока есть бюджет.
    if (submission.order.status === OrderStatus.EXPIRED)
      throw new ForbiddenException(tr('errors.orderExpired'));
    // Заказ снят (бан рекламодателя).
    if (submission.order.status === OrderStatus.REJECTED)
      throw new ForbiddenException(tr('errors.orderRemovedByMod'));
    // Рекламодатель изменил заказ — до одобрения правки сдавать нельзя, слот не тикает.
    if (isFrozen(submission.order))
      throw new ForbiddenException(tr('errors.orderFrozen'));
    const { platforms } = submission.order;
    if (
      platforms.length &&
      !platforms.includes(platformOf(videoUrl) as VideoPlatform)
    )
      throw new ForbiddenException(
        tr('errors.videoOnlyOn', {
          platforms: platforms.map((p) => PLATFORMS[p].name).join(', '),
        }),
      );
    return submission;
  }

  /**
   * Сдача ролика из мини-аппа. Сначала — ваш ли отклик и ждёт ли он видео: иначе чужими id можно
   * тратить квоту API площадки. Где просмотры отдаёт API площадки — берём их, а не слова креатора.
   */
  async submitVideo(
    submissionId: number,
    creatorId: number,
    video: { url: string; views: number },
  ) {
    await this.assertCanSubmit(submissionId, creatorId, video.url);
    const counted = (
      await this.viewCounter.fetchViews([{ url: video.url, creatorId }])
    ).get(video.url)?.views;
    return this.attachVideo(
      submissionId,
      creatorId,
      video.url,
      counted ?? video.views,
    );
  }

  /**
   * Креатор сдаёт ролик, набравший порог просмотров. Из фонда резервируется выплата за порог —
   * не за заявленные просмотры: их пишет сам креатор, и завышенное число заняло бы весь фонд до
   * решения модератора. Модератор начисляет за реальные просмотры из резерва и свободного остатка.
   * Остатка не хватает даже на порог — сдать нельзя. Один ролик сдаётся один раз (Submission_video_once).
   */
  async attachVideo(
    submissionId: number,
    creatorId: number,
    videoUrl: string,
    views: number,
  ) {
    const submission = await this.assertCanSubmit(
      submissionId,
      creatorId,
      videoUrl,
    );
    if (views < submission.order.minViews)
      throw new ForbiddenException(
        tr('errors.belowThreshold', {
          views: trNum(submission.order.minViews),
        }),
      );
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { order, budget } = await this.lockBudget(tx, submission.orderId);
        if (budget.exhausted) throw new ForbiddenException(EXHAUSTED_MESSAGE());
        await transitionSubmission(
          tx,
          submissionId,
          [SubmissionStatus.IN_PROGRESS],
          {
            videoUrl,
            videoKey: videoKey(videoUrl),
            views,
            payoutMinor: payoutFor(order.minViews, order.cpmMinor!),
            status: SubmissionStatus.SUBMITTED,
            submittedAt: new Date(),
          },
          ACCEPTS_VIDEOS,
        );
        return this.mustFind(submissionId, tx);
      });
    } catch (err) {
      if (isDuplicate(err))
        throw new ForbiddenException(DUPLICATE_VIDEO_MESSAGE());
      throw err;
    }
  }

  findById(id: number) {
    return this.prisma.submission.findUnique({
      where: { id },
      include: { order: true, creator: true },
    });
  }

  listPendingModeration() {
    return this.prisma.submission.findMany({
      where: { status: SubmissionStatus.SUBMITTED },
      orderBy: { submittedAt: 'asc' },
      include: { order: true, creator: true },
    });
  }

  listByCreator(creatorId: number) {
    return this.prisma.submission.findMany({
      where: { creatorId },
      orderBy: { createdAt: 'desc' },
      include: { order: true },
    });
  }

  /**
   * Переход по ссылке креатора /r/<код>: +1 к счётчику, вернёт страницу товара. null — нет такой
   * ссылки или у заказа нет страницы товара.
   * ponytail: счётчик без защиты от накрутки — переходы на выплату не влияют; станут влиять —
   * считать уникальных по IP. Ролик, отклонённый и сданный заново новым откликом, хранит в описании
   * старую ссылку — её переходы останутся у отклонённого отклика и в отчёт не попадут.
   */
  async click(trackCode: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { trackCode },
      select: {
        id: true,
        order: { select: { targetUrl: true, status: true } },
      },
    });
    const url = submission?.order.targetUrl;
    // Правка заказа пишет новую ссылку сразу: до решения модератора (и после снятия) не ведём по ней
    // зрителей — иначе рекламодатель подменил бы её на фишинг под нашим доменом.
    if (!url || !titleVisibleToCreators(submission.order)) return null;
    await this.prisma.submission.update({
      where: { id: submission.id },
      data: { clicks: { increment: 1 } },
    });
    return url;
  }

  /** Какой по счёту это видео креатора по заказу: 1, 2, 3… */
  attemptNumber(s: { orderId: number; creatorId: number; id: number }) {
    return this.prisma.submission.count({
      where: { orderId: s.orderId, creatorId: s.creatorId, id: { lte: s.id } },
    });
  }

  /** Отклики «в работе», у которых слот уже сгорел. */
  listSlotOverdue() {
    return this.prisma.submission.findMany({
      where: {
        status: SubmissionStatus.IN_PROGRESS,
        createdAt: { lt: new Date(Date.now() - SLOT_DAYS * DAY_MS) },
        order: ACCEPTS_VIDEOS,
      },
      select: { id: true },
    });
  }

  /** Слот сгорел. `null` — креатор успел прислать видео, пока шла задача. */
  async expireSlot(submissionId: number) {
    const count = await tryTransitionSubmission(
      this.prisma,
      submissionId,
      [SubmissionStatus.IN_PROGRESS],
      { status: SubmissionStatus.SLOT_EXPIRED, decidedAt: new Date() },
      ACCEPTS_VIDEOS,
    );
    return count === 0 ? null : this.mustFind(submissionId);
  }

  /** Отклики «в работе», у которых слот сгорит меньше чем через сутки, — ещё без напоминания. */
  listSlotEndingSoon() {
    return this.prisma.submission.findMany({
      where: {
        status: SubmissionStatus.IN_PROGRESS,
        slotReminderSentAt: null,
        createdAt: { lt: new Date(Date.now() - (SLOT_DAYS - 1) * DAY_MS) },
        order: ACCEPTS_VIDEOS,
      },
      select: { id: true },
    });
  }

  /** Отмечает напоминание; `null` — уже отмечено или видео прислали. */
  async markSlotReminded(submissionId: number) {
    const { count } = await this.prisma.submission.updateMany({
      where: {
        id: submissionId,
        status: SubmissionStatus.IN_PROGRESS,
        slotReminderSentAt: null,
      },
      data: { slotReminderSentAt: new Date() },
    });
    return count === 0 ? null : this.mustFind(submissionId);
  }

  /**
   * Модератор проверил ролик по правилам оффера и фиксирует просмотры — выплата начисляется
   * окончательно: резерв заменяется суммой за `views` (не больше резерва + свободного остатка).
   */
  async moderatorApprove(
    submissionId: number,
    moderatorTelegramId: bigint,
    views: number,
    likes: number | null = null,
  ) {
    const found = await this.mustFind(submissionId);
    if (views < found.order.minViews)
      throw new ForbiddenException(
        `Меньше порога (${found.order.minViews.toLocaleString('ru-RU')} просмотров) — такой ролик отклоните`,
      );
    return this.prisma.$transaction(async (tx) => {
      const { order, budget } = await this.lockBudget(tx, found.orderId);
      // свой резерв ролик может использовать целиком — он уже в `spent`
      const current = await this.mustFind(submissionId, tx);
      const payoutMinor = Math.min(
        payoutFor(views, order.cpmMinor!),
        budget.free + current.payoutMinor,
      );
      await transitionSubmission(
        tx,
        submissionId,
        [SubmissionStatus.SUBMITTED],
        {
          status: SubmissionStatus.MODERATOR_APPROVED,
          moderatorId: moderatorTelegramId,
          views,
          likes,
          payoutMinor,
          decidedAt: new Date(),
        },
        NOT_TAKEN_DOWN,
      );
      return {
        submission: await tx.submission.findUniqueOrThrow({
          where: { id: submissionId },
          include: { order: { include: { advertiser: true } }, creator: true },
        }),
        closed: await this.closeIfExhausted(tx, order),
      };
    });
  }

  /** Отклонение: резерв возвращается в фонд. */
  async moderatorReject(
    submissionId: number,
    moderatorTelegramId: bigint,
    comment: string,
  ) {
    await transitionSubmission(
      this.prisma,
      submissionId,
      [SubmissionStatus.SUBMITTED],
      {
        status: SubmissionStatus.MODERATOR_REJECTED,
        moderatorId: moderatorTelegramId,
        moderatorComment: comment,
        payoutMinor: 0,
        decidedAt: new Date(),
      },
    );
    return this.mustFind(submissionId);
  }

  /**
   * При итоге модератор не нашёл публикацию: креатор удалил ролик до конца холда. Начисление
   * отменяется и возвращается в фонд заказа — деньги ещё не выводились, они были в холде.
   */
  async publicationDeleted(submissionId: number, moderatorTelegramId: bigint) {
    const found = await this.mustFind(submissionId);
    return this.prisma.$transaction(async (tx) => {
      // итог фиксируют под той же блокировкой заказа — проверка ниже не устареет
      await this.lockBudget(tx, found.orderId);
      if ((await this.mustFind(submissionId, tx)).finalizedAt)
        throw new ForbiddenException(
          'Итог уже зафиксирован — деньги вышли из холда',
        );
      await transitionSubmission(
        tx,
        submissionId,
        [SubmissionStatus.MODERATOR_APPROVED],
        {
          status: SubmissionStatus.MODERATOR_REJECTED,
          moderatorId: moderatorTelegramId,
          moderatorComment: PUBLICATION_DELETED,
          payoutMinor: 0,
          decidedAt: new Date(),
        },
      );
      return this.mustFind(submissionId, tx);
    });
  }

  /** Свободный остаток фонда заказа — показать модератору при проверке ролика. */
  async orderBudget(order: Parameters<typeof budgetState>[0] & { id: number }) {
    const spent =
      (await spentByOrder(this.prisma, [order.id])).get(order.id) ?? 0;
    return budgetState(order, spent);
  }

  /** Одобренные ролики, у которых закончился холд, — модератору проверить публикацию и зафиксировать итог. */
  listHoldDue() {
    return this.prisma.submission.findMany({
      where: {
        status: SubmissionStatus.MODERATOR_APPROVED,
        finalizedAt: null,
        decidedAt: { lt: new Date(Date.now() - HOLD_DAYS * DAY_MS) },
      },
      orderBy: { decidedAt: 'asc' },
      include: { order: true, creator: true },
    });
  }

  /** Сколько видео и итогов холда ждут модератора с момента раньше `before` — для напоминания. */
  async countStaleBefore(before: Date) {
    const [videos, holds, reviews] = await Promise.all([
      this.prisma.submission.count({
        where: {
          status: SubmissionStatus.SUBMITTED,
          submittedAt: { lt: before },
        },
      }),
      // итог ждёт с конца холда
      this.prisma.submission.count({
        where: {
          status: SubmissionStatus.MODERATOR_APPROVED,
          finalizedAt: null,
          decidedAt: {
            lt: new Date(before.getTime() - HOLD_DAYS * DAY_MS),
          },
        },
      }),
      this.prisma.submission.count({
        where: { reviewQueuedAt: { lt: before } },
      }),
    ]);
    return { videos, holds, reviews };
  }

  /**
   * Итог холда: через HOLD_DAYS после одобрения модератор (или API площадки) проверяет, что
   * публикация на месте, и фиксирует просмотры — только для отчёта рекламодателю. Оплата не меняется:
   * платим за просмотры, зафиксированные при одобрении. После итога деньги можно вывести.
   */
  async finalizeViews(
    submissionId: number,
    views: number,
    likes: number | null = null,
  ) {
    const found = await this.mustFind(submissionId);
    return this.prisma.$transaction(async (tx) => {
      // та же блокировка, что у publicationDeleted: ролик не окажется и с итогом, и снятым
      await this.lockBudget(tx, found.orderId);
      const current = await this.mustFind(submissionId, tx);
      const ready = new Date(
        (current.decidedAt?.getTime() ?? Date.now()) + HOLD_DAYS * DAY_MS,
      );
      if (ready > new Date())
        throw new ForbiddenException(
          `Итог фиксируется через ${HOLD_DAYS} дн. после одобрения`,
        );
      const { count } = await tx.submission.updateMany({
        where: {
          id: submissionId,
          status: SubmissionStatus.MODERATOR_APPROVED,
          finalizedAt: null,
        },
        data: {
          views,
          // лайки не ввели — остаются те, что зафиксированы при одобрении
          ...(likes !== null && { likes }),
          finalizedAt: new Date(),
        },
      });
      if (count === 0)
        throw new ForbiddenException('Итог по этому ролику уже зафиксирован');
      return this.mustFind(submissionId, tx);
    });
  }

  /**
   * Рекламодатель по желанию оценивает одобренный ролик; оценку не меняют. Отзыв с текстом уходит
   * модератору (`reviewQueuedAt`) и появится в профиле креатора после проверки: в тексте могут быть
   * оскорбления или контакты в обход площадки. Одни звёзды публикуются сразу.
   */
  async rate(
    submissionId: number,
    advertiserId: number,
    feedback: {
      rating: number;
      review: string | null;
      portfolioAllowed: boolean;
    },
  ) {
    const submission = await this.mustFind(submissionId);
    if (submission.order.advertiserId !== advertiserId)
      throw new ForbiddenException(tr('errors.notYourOrder'));
    const { count } = await this.prisma.submission.updateMany({
      where: {
        id: submissionId,
        status: SubmissionStatus.MODERATOR_APPROVED,
        rating: null,
      },
      data: {
        ...feedback,
        reviewQueuedAt: feedback.review ? new Date() : null,
      },
    });
    if (count === 0) throw new ForbiddenException(tr('errors.alreadyRated'));
    return this.mustFind(submissionId);
  }

  /** Отзывы, ждущие модератора, — старые первыми. */
  listPendingReviews() {
    return this.prisma.submission.findMany({
      where: { reviewQueuedAt: { not: null } },
      orderBy: { reviewQueuedAt: 'asc' },
      include: { order: { include: { advertiser: true } }, creator: true },
    });
  }

  /** Модератор публикует отзыв в профиле креатора; второй модератор получит ошибку, а не двойное уведомление. */
  async approveReview(submissionId: number) {
    const { count } = await this.prisma.submission.updateMany({
      where: { id: submissionId, reviewQueuedAt: { not: null } },
      data: { reviewQueuedAt: null },
    });
    if (count === 0) throw new NotFoundException('Отзыв уже проверен');
    return this.mustFind(submissionId);
  }

  /**
   * Модератор удаляет отзыв (оскорбления и т.п.) — опубликованный или ещё на проверке: оценка и текст
   * пропадают, ролик остаётся одобренным.
   */
  async removeReview(submissionId: number) {
    const { count } = await this.prisma.submission.updateMany({
      where: { id: submissionId, rating: { not: null } },
      data: { rating: null, review: null, reviewQueuedAt: null },
    });
    if (count === 0) throw new NotFoundException('Отзыв не найден');
  }

  /**
   * Бюджет заказа под блокировкой строки: резерв, начисление и итог по одному заказу идут по
   * очереди, иначе две одновременные операции вместе вышли бы за фонд.
   */
  private async lockBudget(tx: Prisma.TransactionClient, orderId: number) {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const spent = (await spentByOrder(tx, [orderId])).get(orderId) ?? 0;
    return { order, budget: budgetState(order, spent) };
  }

  /**
   * Начисленного столько, что на ролик с порогом не хватает, — открытый заказ закрывается.
   * Считается без резерва: он может вернуться в фонд, а закрытый заказ сам не откроется.
   * Вызывать под lockBudget того же заказа. Возвращает заказ с рекламодателем и креаторами
   * «в работе» для уведомления; `null` — закрывать не нужно.
   */
  private async closeIfExhausted(
    tx: Prisma.TransactionClient,
    order: Parameters<typeof budgetState>[0] & { id: number },
  ) {
    const orderId = order.id;
    const accrued =
      (await spentByOrder(tx, [orderId], ACCRUED)).get(orderId) ?? 0;
    if (!budgetState(order, accrued).exhausted) return null;
    if ((await closeOpenOrders(tx, [orderId])) === 0) return null;
    return tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        advertiser: true,
        submissions: {
          where: { status: SubmissionStatus.IN_PROGRESS },
          include: { creator: true },
        },
      },
    });
  }

  async stats() {
    const [pending, approved, rejected] = await Promise.all(
      [
        SubmissionStatus.SUBMITTED,
        SubmissionStatus.MODERATOR_APPROVED,
        SubmissionStatus.MODERATOR_REJECTED,
      ].map((status) => this.prisma.submission.count({ where: { status } })),
    );
    return { pending, approved, rejected };
  }

  private async mustFind(
    id: number,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const submission = await db.submission.findUnique({
      where: { id },
      include: { order: true, creator: true },
    });
    if (!submission)
      throw new NotFoundException(tr('errors.submissionNotFound'));
    return submission;
  }
}
