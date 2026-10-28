import { tr, trNum } from '../i18n/request-lang';
import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
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
import { fromMinor } from '../common/money';
import { isDbId } from '../common/validation';
import {
  PLATFORMS,
  expandTiktokShortLink,
  isTiktokShortLink,
  platformOf,
  videoKey,
} from '../common/platforms';
import {
  closeOpenOrders,
  freedOrder,
  fundOf,
  isFrozen,
  lockOrder,
  syncFundBusy,
  termsOf,
  videoTerms,
} from '../orders/order-status';
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

/**
 * Слот «в работе» тикает (сгорает, напоминание), пока заказ принимает видео и фонд не «занят»
 * роликами на проверке (Order.fundBusyAt): тогда сдать нельзя не по вине креатора.
 */
const SLOT_TICKS: Prisma.OrderWhereInput = {
  ...ACCEPTS_VIDEOS,
  fundBusyAt: null,
};

// Свободного остатка может не хватать и из-за резерва роликов на проверке — тогда он ещё вернётся.
const EXHAUSTED_MESSAGE = () => tr('errors.budgetShort');

/**
 * Модератор зафиксировал меньше этой доли просмотров, которые указал креатор, — одобрить нельзя:
 * завышение. Такой ролик отклоняют с INFLATED_VIEWS, и сдать его снова нельзя.
 */
const INFLATED_SHARE = 0.5;

/** Причина отклонения за завышенные просмотры — креатор увидит её; по ней же не дают сдать ролик снова. */
export const INFLATED_VIEWS =
  'Просмотры завышены: модератор насчитал меньше половины указанных — этот ролик больше не принимается';

/**
 * Роликов одного креатора на проверке по заказу: каждый резервирует оплату за порог, и без
 * предела один креатор занял бы весь фонд роликами с выдуманными просмотрами до решения модератора.
 */
export const MAX_IN_REVIEW = 3;

/** Сколько помним просмотры ролика, посчитанные при сдаче (countedAtSubmit). */
const SUBMIT_COUNT_TTL_MS = 15 * 60_000;

const ALREADY_CLAIMED_MESSAGE = () => tr('errors.alreadyClaimed');

/** Причина отклонения, когда публикацию удалили до конца холда — креатор увидит её. */
export const PUBLICATION_DELETED =
  'Публикация удалена до итога просмотров — начисление отменено';

/** То же, когда заказ требовал ссылку в шапке профиля (Order.linkInBio), а её сняли до итога. */
export const BIO_LINK_REMOVED =
  'Ссылку из шапки профиля убрали до итога просмотров — начисление отменено';

const DUPLICATE_VIDEO_MESSAGE = () => tr('errors.duplicateVideo');

const isDuplicate = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

@Injectable()
export class SubmissionsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubmissionsService.name);
  private readonly submitCounts = new Map<
    string,
    { views: number | undefined; until: number }
  >();

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
   * Ключ ролика по текущему правилу (videoKey) — у сданных до него или по старому правилу, чтобы их
   * не сдали повторно (Submission_video_once). Если тот же ролик уже на проверке или оплачен по
   * другому отклику, ключ не меняем (индекс не даст): такие дубли логируем для модераторов —
   * возможно, один ролик оплачен дважды.
   * ponytail: по строке на запрос и повтор дублей при каждом старте — роликов сотни, не миллионы.
   */
  async backfillVideoKeys() {
    const rows = await this.prisma.submission.findMany({
      where: { videoUrl: { not: null } },
      select: { id: true, videoUrl: true, videoKey: true },
      orderBy: { id: 'asc' },
    });
    const duplicates: number[] = [];
    let filled = 0;
    for (const { id, videoUrl, videoKey: current } of rows) {
      let key: string;
      try {
        key = videoKey(videoUrl!);
      } catch {
        continue; // не ссылка — сравнивать не с чем
      }
      if (key === current) continue;
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
        `Один ролик сдан несколько раз — проверьте, не оплачен ли дважды; отклики: ${duplicates.join(', ')}`,
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
    video: {
      url: string;
      views: number;
      acceptMinor: number | null;
      bioLinkConfirmed?: boolean;
    },
  ) {
    const { order } = await this.assertCanSubmit(
      submissionId,
      creatorId,
      video.url,
    );
    // ссылку в шапке модератор проверит при одобрении и в конце холда — здесь креатор её подтверждает
    if (order.linkInBio && !video.bioLinkConfirmed)
      throw new BadRequestException(tr('errors.confirmLinkInBio'));
    // после проверки прав: запрос к TikTok — только по своему отклику
    const url = isTiktokShortLink(video.url)
      ? await expandTiktokShortLink(video.url)
      : video.url;
    if (!url) throw new BadRequestException(tr('errors.videoShortLink'));
    const counted = await this.countedAtSubmit(url, creatorId);
    return this.attachVideo(
      submissionId,
      creatorId,
      url,
      counted ?? video.views,
      video.acceptMinor,
    );
  }

  /**
   * Просмотры ролика при сдаче по API площадки; undefined — не посчитать. Запоминаем на
   * SUBMIT_COUNT_TTL_MS: повторные сдачи той же ссылки («не хватило — ещё раз») не тратят квоту
   * YouTube и платные чтения X.
   * ponytail: в памяти процесса, инстанс один; старые записи вычищаются при каждой сдаче.
   */
  private async countedAtSubmit(url: string, creatorId: number) {
    const now = Date.now();
    for (const [k, v] of this.submitCounts)
      if (v.until < now) this.submitCounts.delete(k);
    const key = `${creatorId} ${url}`;
    const cached = this.submitCounts.get(key);
    if (cached) return cached.views;
    const views = (await this.viewCounter.fetchViews([{ url, creatorId }])).get(
      url,
    )?.views;
    this.submitCounts.set(key, { views, until: now + SUBMIT_COUNT_TTL_MS });
    return views;
  }

  /**
   * Креатор сдаёт ролик, набравший порог просмотров. Из фонда резервируется выплата за порог —
   * не за заявленные просмотры: их пишет сам креатор, и завышенное число заняло бы весь фонд до
   * решения модератора. Модератор начисляет за реальные просмотры из резерва и свободного остатка.
   * Остатка не хватает даже на порог — сдать нельзя. Один ролик сдаётся один раз (Submission_video_once).
   *
   * Просмотры не влезают в свободный остаток — сдать можно только с согласием на остаток
   * (`acceptMinor` — сумма, которую креатор видел): иначе 409 OVER_BUDGET с суммой и оплачиваемыми
   * просмотрами. Согласился — за роликом закрепляется весь остаток (не меньше `acceptMinor`),
   * просмотры сверх него не оплачиваются. Остаток успел уменьшиться — снова 409 с новой суммой.
   */
  async attachVideo(
    submissionId: number,
    creatorId: number,
    videoUrl: string,
    views: number,
    acceptMinor: number | null = null,
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
    const inflated = await this.prisma.submission.count({
      where: {
        videoKey: videoKey(videoUrl),
        status: SubmissionStatus.MODERATOR_REJECTED,
        moderatorComment: INFLATED_VIEWS,
      },
    });
    if (inflated) throw new ForbiddenException(tr('errors.inflatedVideo'));
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { order, budget } = await this.lockBudget(tx, submission.orderId);
        if (budget.exhausted) throw new ForbiddenException(EXHAUSTED_MESSAGE());
        const reserve = payoutFor(order.minViews, order.cpmMinor!);
        // резерв за порог уже не больше остатка (иначе exhausted), так что остаток — весь free
        const overBudget = payoutFor(views, order.cpmMinor!) > budget.free;
        if (overBudget && (acceptMinor === null || acceptMinor > budget.free))
          throw new ConflictException({
            code: 'OVER_BUDGET',
            message: tr('errors.overBudget'),
            payout: fromMinor(budget.free),
            paidViews: Math.floor((budget.free * 1000) / order.cpmMinor!),
          });
        // под блокировкой заказа: параллельные сдачи лимит не обойдут
        const inReview = await tx.submission.count({
          where: {
            orderId: submission.orderId,
            creatorId,
            status: SubmissionStatus.SUBMITTED,
          },
        });
        if (inReview >= MAX_IN_REVIEW)
          throw new ForbiddenException(
            tr('errors.tooManyInReview', { max: MAX_IN_REVIEW }),
          );
        await transitionSubmission(
          tx,
          submissionId,
          [SubmissionStatus.IN_PROGRESS],
          {
            videoUrl,
            videoKey: videoKey(videoUrl),
            views,
            payoutMinor: overBudget ? budget.free : reserve,
            agreedPayoutMinor: overBudget ? budget.free : null,
            status: SubmissionStatus.SUBMITTED,
            submittedAt: new Date(),
            // условия при сдаче: по ним проверят и оплатят ролик, как бы заказ потом ни правили
            terms: termsOf(order),
          },
          ACCEPTS_VIDEOS,
        );
        await syncFundBusy(tx, submission.orderId);
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

  /**
   * Очередь видео: сначала ролики заказов, чей фонд «занят» (Order.fundBusyAt), — пока их не
   * проверят, по заказу никто не может сдать ролик; дальше — старые первыми.
   */
  listPendingModeration() {
    return this.prisma.submission.findMany({
      where: { status: SubmissionStatus.SUBMITTED },
      orderBy: [
        { order: { fundBusyAt: { sort: 'asc', nulls: 'last' } } },
        { submittedAt: 'asc' },
      ],
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
  /**
   * Ссылка на ролик по коду — для /v/<код> в отчёте рекламодателя: только одобренный ролик (в отчёт
   * попадают они), без учёта перехода.
   */
  async videoByCode(trackCode: string) {
    const submission = await this.prisma.submission.findFirst({
      where: { trackCode, status: SubmissionStatus.MODERATOR_APPROVED },
      select: { videoUrl: true },
    });
    return submission?.videoUrl ?? null;
  }

  /**
   * Пример ролика из заказа по номеру с 1 (VideoLinkController). Только у заказов, которые модератор
   * хоть раз одобрил: примеры заказа на первой проверке никому, кроме модератора, не видны.
   * null — нет такого заказа или примера.
   */
  async exampleUrl(orderId: number, n: number) {
    if (!isDbId(orderId)) return null;
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, approvedBudgetMinor: { not: null } },
      select: { exampleUrls: true },
    });
    return order?.exampleUrls[n - 1] ?? null;
  }

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
        order: SLOT_TICKS,
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
      SLOT_TICKS,
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
        order: SLOT_TICKS,
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
   * Меньше половины указанных креатором — не одобряем: это завышение (rejectInflated).
   * `freed` — фонд заказа больше не «занят»: креаторам «в работе» можно сдавать.
   */
  async moderatorApprove(
    submissionId: number,
    moderatorTelegramId: bigint,
    views: number,
    likes: number | null = null,
  ) {
    const found = await this.mustFind(submissionId);
    const { minViews } = videoTerms(found.order, found);
    if (views < minViews)
      throw new ForbiddenException(
        `Меньше порога (${minViews.toLocaleString('ru-RU')} просмотров) — такой ролик отклоните`,
      );
    if (found.views !== null && views < found.views * INFLATED_SHARE)
      throw new ForbiddenException(
        `Меньше половины указанных креатором (${found.views.toLocaleString('ru-RU')}) — отклоните ролик за завышенные просмотры`,
      );
    return this.prisma.$transaction(async (tx) => {
      const { order, budget } = await this.lockBudget(tx, found.orderId);
      // свой резерв ролик может использовать целиком — он уже в `spent`
      const current = await this.mustFind(submissionId, tx);
      const payoutMinor = Math.min(
        payoutFor(views, videoTerms(order, current).cpmMinor!),
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
        freed: await freedOrder(tx, order.id),
      };
    });
  }

  /**
   * Отклонение: резерв возвращается в фонд — под блокировкой заказа, чтобы пересчитать «занятость»
   * фонда (`freed` — как у moderatorApprove).
   */
  async moderatorReject(
    submissionId: number,
    moderatorTelegramId: bigint,
    comment: string,
  ) {
    const found = await this.mustFind(submissionId);
    return this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, found.orderId);
      await transitionSubmission(
        tx,
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
      return {
        submission: await this.mustFind(submissionId, tx),
        freed: await freedOrder(tx, found.orderId),
      };
    });
  }

  /** Отклонение за завышенные просмотры: тот же ролик больше не сдать (attachVideo), причина — INFLATED_VIEWS. */
  rejectInflated(submissionId: number, moderatorTelegramId: bigint) {
    return this.moderatorReject(
      submissionId,
      moderatorTelegramId,
      INFLATED_VIEWS,
    );
  }

  /** Сколько роликов креатора отклонено за завышенные просмотры — модератору: повтор — повод для бана. */
  inflatedCount(creatorId: number) {
    return this.prisma.submission.count({
      where: {
        creatorId,
        status: SubmissionStatus.MODERATOR_REJECTED,
        moderatorComment: INFLATED_VIEWS,
      },
    });
  }

  /**
   * При итоге модератор не нашёл публикацию: креатор удалил ролик до конца холда — или, если заказ
   * требовал ссылку в шапке профиля (`bioLink`), убрал её. Начисление отменяется и возвращается в
   * фонд заказа — деньги ещё не выводились, они были в холде.
   */
  async publicationDeleted(
    submissionId: number,
    moderatorTelegramId: bigint,
    bioLink = false,
  ) {
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
          moderatorComment: bioLink ? BIO_LINK_REMOVED : PUBLICATION_DELETED,
          payoutMinor: 0,
          decidedAt: new Date(),
        },
      );
      return {
        submission: await this.mustFind(submissionId, tx),
        freed: await freedOrder(tx, found.orderId),
      };
    });
  }

  /** Свободный остаток фонда заказа — показать модератору при проверке ролика. */
  async orderBudget(
    order: Parameters<typeof budgetState>[0] &
      Parameters<typeof fundOf>[0] & { id: number },
  ) {
    const spent =
      (await spentByOrder(this.prisma, [order.id])).get(order.id) ?? 0;
    return budgetState(fundOf(order), spent);
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
   * `automatic` — итог от API без модератора: креатора, которого забанили, пока шёл запрос к API,
   * не завершаем — бан проверяется в самом обновлении, решение о деньгах за модератором.
   */
  async finalizeViews(
    submissionId: number,
    views: number,
    likes: number | null = null,
    automatic = false,
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
          ...(automatic && { creator: { is: { bannedAt: null } } }),
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
    const order = fundOf(
      await tx.order.findUniqueOrThrow({ where: { id: orderId } }),
    );
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
