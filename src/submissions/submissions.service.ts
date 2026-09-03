import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, OrderStatus, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const ALREADY_CLAIMED_MESSAGE =
  'Вы уже откликнулись на этот заказ — загляните в «Мои отклики»';

const ACTIVE_STATUSES: SubmissionStatus[] = [
  SubmissionStatus.IN_PROGRESS,
  SubmissionStatus.SUBMITTED,
  SubmissionStatus.MODERATOR_APPROVED,
];

@Injectable()
export class SubmissionsService {
  constructor(private readonly prisma: PrismaService) {}

  hasActiveClaim(orderId: number, creatorId: number) {
    return this.prisma.submission
      .findFirst({
        where: { orderId, creatorId, status: { in: ACTIVE_STATUSES } },
      })
      .then((s) => s !== null);
  }

  async claim(orderId: number, creatorId: number) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const order = await tx.order.findUnique({ where: { id: orderId } });
          if (!order) throw new NotFoundException('Заказ не найден');
          if (order.status !== OrderStatus.OPEN)
            throw new ForbiddenException('Заказ сейчас недоступен');

          const existing = await tx.submission.findFirst({
            where: { orderId, creatorId, status: { in: ACTIVE_STATUSES } },
          });
          if (existing) throw new ForbiddenException(ALREADY_CLAIMED_MESSAGE);

          return tx.submission.create({
            data: { orderId, creatorId },
            include: { order: true, creator: true },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      // Два одновременных отклика (например, двойной тап по кнопке) оба проходят
      // проверку выше и гонятся за вставкой — Postgres прерывает проигравшего с ошибкой
      // сериализации (код Prisma P2034), не давая создать дублирующий активный отклик.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2034'
      ) {
        throw new ForbiddenException(ALREADY_CLAIMED_MESSAGE);
      }
      throw err;
    }
  }

  async attachVideo(submissionId: number, creatorId: number, videoUrl: string) {
    const submission = await this.mustFind(submissionId);
    if (submission.creatorId !== creatorId)
      throw new ForbiddenException('Это не ваш отклик');
    await this.transitionStatus(submissionId, [SubmissionStatus.IN_PROGRESS], {
      videoUrl,
      status: SubmissionStatus.SUBMITTED,
      submittedAt: new Date(),
    });
    return this.mustFind(submissionId);
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

  listByOrder(orderId: number) {
    return this.prisma.submission.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      include: { creator: true, order: true },
    });
  }

  async moderatorApprove(submissionId: number, moderatorTelegramId: bigint) {
    await this.transitionStatus(submissionId, [SubmissionStatus.SUBMITTED], {
      status: SubmissionStatus.MODERATOR_APPROVED,
      moderatorId: moderatorTelegramId,
      decidedAt: new Date(),
    });
    return this.prisma.submission.findUniqueOrThrow({
      where: { id: submissionId },
      include: { order: { include: { advertiser: true } }, creator: true },
    });
  }

  async moderatorReject(
    submissionId: number,
    moderatorTelegramId: bigint,
    comment: string,
  ) {
    await this.transitionStatus(submissionId, [SubmissionStatus.SUBMITTED], {
      status: SubmissionStatus.MODERATOR_REJECTED,
      moderatorId: moderatorTelegramId,
      moderatorComment: comment,
      decidedAt: new Date(),
    });
    return this.mustFind(submissionId);
  }

  async advertiserApprove(submissionId: number, advertiserId: number) {
    const submission = await this.mustFind(submissionId);
    if (submission.order.advertiserId !== advertiserId) {
      throw new ForbiddenException('Это не ваш заказ');
    }
    await this.transitionStatus(
      submissionId,
      [SubmissionStatus.MODERATOR_APPROVED],
      { status: SubmissionStatus.ADVERTISER_APPROVED, decidedAt: new Date() },
    );
    return this.mustFind(submissionId);
  }

  async advertiserReject(
    submissionId: number,
    advertiserId: number,
    comment: string,
  ) {
    const submission = await this.mustFind(submissionId);
    if (submission.order.advertiserId !== advertiserId) {
      throw new ForbiddenException('Это не ваш заказ');
    }
    await this.transitionStatus(
      submissionId,
      [SubmissionStatus.MODERATOR_APPROVED],
      {
        status: SubmissionStatus.ADVERTISER_REJECTED,
        advertiserComment: comment,
        decidedAt: new Date(),
      },
    );
    return this.mustFind(submissionId);
  }

  async stats() {
    const [pending, approved, rejected] = await Promise.all([
      this.prisma.submission.count({
        where: { status: SubmissionStatus.SUBMITTED },
      }),
      this.prisma.submission.count({
        where: { status: SubmissionStatus.ADVERTISER_APPROVED },
      }),
      this.prisma.submission.count({
        where: {
          status: {
            in: [
              SubmissionStatus.MODERATOR_REJECTED,
              SubmissionStatus.ADVERTISER_REJECTED,
            ],
          },
        },
      }),
    ]);
    return { pending, approved, rejected };
  }

  private async mustFind(id: number) {
    const submission = await this.prisma.submission.findUnique({
      where: { id },
      include: { order: true, creator: true },
    });
    if (!submission) throw new NotFoundException('Отклик не найден');
    return submission;
  }

  /**
   * Атомарно применяет переход статуса, обусловленный текущим статусом — поэтому два
   * одновременных действия над одним откликом (двойной тап, или гонка двух модераторов
   * над одним пунктом очереди) не могут оба пройти: первый `updateMany` находит строку,
   * второй видит `count === 0` и сообщает «уже обработано» вместо перезаписи.
   */
  private async transitionStatus(
    submissionId: number,
    fromStatuses: SubmissionStatus[],
    data: Prisma.SubmissionUpdateManyMutationInput,
  ) {
    const result = await this.prisma.submission.updateMany({
      where: { id: submissionId, status: { in: fromStatuses } },
      data,
    });
    if (result.count === 0) {
      await this.mustFind(submissionId);
      throw new ForbiddenException('Этот отклик уже обработан');
    }
  }
}
