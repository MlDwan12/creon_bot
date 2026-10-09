import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, OrderStatus, SubmissionStatus } from '@prisma/client';
import {
  ACCRUED,
  budgetState,
  HOLDS_MONEY,
  payoutFor,
  spentByOrder,
  VIEWS_TOPUP_DAYS,
} from '../orders/budget';
import { DAY_MS } from '../orders/deadline';
import { videoKey } from '../common/platforms';
import { closeOpenOrders, lockOrder } from '../orders/order-status';
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

/** По таким заказам видео ещё принимают (как в attachVideo) — только тогда слот может сгореть. */
const ACCEPTS_VIDEOS: Prisma.OrderWhereInput = {
  status: { notIn: [OrderStatus.EXPIRED, OrderStatus.REJECTED] },
};

// Свободного остатка может не хватать и из-за резерва роликов на проверке — тогда он ещё вернётся.
const EXHAUSTED_MESSAGE =
  'Свободного бюджета в заказе сейчас не хватает на ролик — новые ролики по нему не принимаются';

const ALREADY_CLAIMED_MESSAGE =
  'По этому заказу у вас уже есть отклик в работе — отправьте по нему видео в «Мои отклики»';

const ON_REVIEW_MESSAGE =
  'Ваш ролик по этому заказу ещё на проверке — следующий можно будет прислать после решения модератора';

const DUPLICATE_VIDEO_MESSAGE =
  'Этот ролик уже сдан — по этому или другому заказу. Один ролик оплачивается один раз';

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly viewCounter: ViewCounterService,
  ) {}

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
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.status !== OrderStatus.OPEN)
      throw new ForbiddenException('Заказ сейчас недоступен');
    if (order.advertiserId === creatorId)
      throw new ForbiddenException('Нельзя откликнуться на свой заказ');
    // без блокировки: сдачу всё равно проверит attachVideo, здесь — не брать слот впустую
    if ((await this.orderBudget(order)).exhausted)
      throw new ForbiddenException(EXHAUSTED_MESSAGE);
    // По ролику на проверке за раз: каждый резервирует часть фонда, и поток пустых сдач
    // (просмотры заявляет сам креатор) занял бы весь заказ до решения модератора.
    // ponytail: проверка без блокировки — двойной тап по разным откликам даст два ролика, не больше.
    const onReview = await this.prisma.submission.findFirst({
      where: { orderId, creatorId, status: SubmissionStatus.SUBMITTED },
      select: { id: true },
    });
    if (onReview) throw new ForbiddenException(ON_REVIEW_MESSAGE);
    // ponytail: заказ могут закрыть между проверкой и вставкой — отклик на только что закрытый
    // заказ безвреден (видео по закрытому принимаются), блокировать ради этого незачем.
    try {
      return await this.prisma.submission.create({
        data: { orderId, creatorId },
        include: { order: true, creator: true },
      });
    } catch (err) {
      // Второй отклик «в работе» (двойной тап) не пустит частичный уникальный индекс
      // Submission_one_in_progress — отклики разных креаторов друг другу не мешают.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        throw new ForbiddenException(ALREADY_CLAIMED_MESSAGE);
      throw err;
    }
  }

  /**
   * Можно ли сдать видео по отклику: он ваш, «в работе», заказ ещё принимает видео. Проверка до
   * обращения к API площадки (квота YouTube) — attachVideo всё равно повторит её под блокировкой.
   */
  private async assertCanSubmit(submissionId: number, creatorId: number) {
    const submission = await this.mustFind(submissionId);
    if (submission.creatorId !== creatorId)
      throw new ForbiddenException('Это не ваш отклик');
    if (submission.status !== SubmissionStatus.IN_PROGRESS)
      throw new ForbiddenException('Этот отклик уже обработан');
    // После срока видео не принимаются. После ручного закрытия — принимаются, пока есть бюджет.
    if (submission.order.status === OrderStatus.EXPIRED)
      throw new ForbiddenException(
        'Срок заказа истёк — видео больше не принимаются',
      );
    // Изменённый открытый заказ модератор отклонил — он снят с площадки.
    if (submission.order.status === OrderStatus.REJECTED)
      throw new ForbiddenException(
        'Заказ снят модератором — видео по нему не принимаются',
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
    await this.assertCanSubmit(submissionId, creatorId);
    const counted = (await this.viewCounter.fetchViews([video.url])).get(
      video.url,
    )?.views;
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
    const submission = await this.assertCanSubmit(submissionId, creatorId);
    if (views < submission.order.minViews)
      throw new ForbiddenException(
        `Ролик можно сдать, когда он наберёт ${submission.order.minViews.toLocaleString('ru-RU')} просмотров`,
      );
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { order, budget } = await this.lockBudget(tx, submission.orderId);
        if (budget.exhausted) throw new ForbiddenException(EXHAUSTED_MESSAGE);
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
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        throw new ForbiddenException(DUPLICATE_VIDEO_MESSAGE);
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

  /** Ролики заказа, за которыми закреплены деньги (на проверке и одобренные), — для отчёта. */
  listWithMoney(orderId: number) {
    return this.prisma.submission.findMany({
      where: { orderId, status: { in: HOLDS_MONEY } },
      include: { creator: true },
    });
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

  /** Свободный остаток фонда заказа — показать модератору при проверке ролика. */
  async orderBudget(order: Parameters<typeof budgetState>[0] & { id: number }) {
    const spent =
      (await spentByOrder(this.prisma, [order.id])).get(order.id) ?? 0;
    return budgetState(order, spent);
  }

  /** Одобренные ролики, у которых закончился добор просмотров, — модератору зафиксировать итог. */
  listTopupDue() {
    return this.prisma.submission.findMany({
      where: {
        status: SubmissionStatus.MODERATOR_APPROVED,
        finalizedAt: null,
        decidedAt: { lt: new Date(Date.now() - VIEWS_TOPUP_DAYS * DAY_MS) },
      },
      orderBy: { decidedAt: 'asc' },
      include: { order: true, creator: true },
    });
  }

  /** Сколько видео и итогов добора ждут модератора с момента раньше `before` — для напоминания. */
  async countStaleBefore(before: Date) {
    const [videos, topups] = await Promise.all([
      this.prisma.submission.count({
        where: {
          status: SubmissionStatus.SUBMITTED,
          submittedAt: { lt: before },
        },
      }),
      // итог ждёт с конца добора
      this.prisma.submission.count({
        where: {
          status: SubmissionStatus.MODERATOR_APPROVED,
          finalizedAt: null,
          decidedAt: {
            lt: new Date(before.getTime() - VIEWS_TOPUP_DAYS * DAY_MS),
          },
        },
      }),
    ]);
    return { videos, topups };
  }

  /**
   * Итог добора: модератор фиксирует просмотры через VIEWS_TOPUP_DAYS после одобрения. Прирост
   * доплачивается из свободного остатка, пока он есть; начисленное не уменьшается. `extraMinor` — доплата.
   */
  async finalizeViews(
    submissionId: number,
    views: number,
    likes: number | null = null,
  ) {
    const found = await this.mustFind(submissionId);
    return this.prisma.$transaction(async (tx) => {
      const { order, budget } = await this.lockBudget(tx, found.orderId);
      const current = await this.mustFind(submissionId, tx);
      // заказ снят модератором — итог фиксируем, но не доплачиваем (как и не одобряем по снятому)
      const extraMinor =
        order.status === OrderStatus.REJECTED
          ? 0
          : Math.max(
              0,
              Math.min(
                payoutFor(views, order.cpmMinor!) - current.payoutMinor,
                budget.free,
              ),
            );
      const ready = new Date(
        (current.decidedAt?.getTime() ?? Date.now()) +
          VIEWS_TOPUP_DAYS * DAY_MS,
      );
      if (ready > new Date())
        throw new ForbiddenException(
          `Итог просмотров фиксируется через ${VIEWS_TOPUP_DAYS} дня после одобрения`,
        );
      // не статус, но то же условное обновление: второй модератор не доплатит повторно
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
          payoutMinor: { increment: extraMinor },
          finalizedAt: new Date(),
        },
      });
      if (count === 0)
        throw new ForbiddenException('Итог по этому ролику уже зафиксирован');
      return {
        submission: await this.mustFind(submissionId, tx),
        extraMinor,
        closed: await this.closeIfExhausted(tx, order),
      };
    });
  }

  /** Рекламодатель по желанию оценивает одобренный ролик; оценку не меняют. */
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
      throw new ForbiddenException('Это не ваш заказ');
    const { count } = await this.prisma.submission.updateMany({
      where: {
        id: submissionId,
        status: SubmissionStatus.MODERATOR_APPROVED,
        rating: null,
      },
      data: feedback,
    });
    if (count === 0) throw new ForbiddenException('Этот ролик уже оценён');
    return this.mustFind(submissionId);
  }

  /** Модератор удаляет отзыв (оскорбления и т.п.): оценка и текст пропадают, ролик остаётся одобренным. */
  async removeReview(submissionId: number) {
    const { count } = await this.prisma.submission.updateMany({
      where: { id: submissionId, rating: { not: null } },
      data: { rating: null, review: null },
    });
    if (count === 0) throw new NotFoundException('Отзыв не найден');
  }

  /**
   * Бюджет заказа под блокировкой строки: резерв, начисление и доплата по одному заказу идут по
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
    if (!submission) throw new NotFoundException('Отклик не найден');
    return submission;
  }
}
