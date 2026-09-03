import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.status !== OrderStatus.OPEN)
      throw new ForbiddenException('Заказ сейчас недоступен');

    const existing = await this.prisma.submission.findFirst({
      where: { orderId, creatorId, status: { in: ACTIVE_STATUSES } },
    });
    if (existing)
      throw new ForbiddenException(
        'Вы уже откликнулись на этот заказ — загляните в «Мои отклики»',
      );

    return this.prisma.submission.create({
      data: { orderId, creatorId },
      include: { order: true, creator: true },
    });
  }

  async attachVideo(submissionId: number, creatorId: number, videoUrl: string) {
    const submission = await this.mustFind(submissionId);
    if (submission.creatorId !== creatorId)
      throw new ForbiddenException('Это не ваш отклик');
    this.assertStatus(submission, SubmissionStatus.IN_PROGRESS);
    return this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        videoUrl,
        status: SubmissionStatus.SUBMITTED,
        submittedAt: new Date(),
      },
      include: { order: true, creator: true },
    });
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
    const submission = await this.mustFind(submissionId);
    this.assertStatus(submission, SubmissionStatus.SUBMITTED);
    return this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: SubmissionStatus.MODERATOR_APPROVED,
        moderatorId: moderatorTelegramId,
        decidedAt: new Date(),
      },
      include: { order: { include: { advertiser: true } }, creator: true },
    });
  }

  async moderatorReject(
    submissionId: number,
    moderatorTelegramId: bigint,
    comment: string,
  ) {
    const submission = await this.mustFind(submissionId);
    this.assertStatus(submission, SubmissionStatus.SUBMITTED);
    return this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: SubmissionStatus.MODERATOR_REJECTED,
        moderatorId: moderatorTelegramId,
        moderatorComment: comment,
        decidedAt: new Date(),
      },
      include: { order: true, creator: true },
    });
  }

  async advertiserApprove(submissionId: number, advertiserId: number) {
    const submission = await this.mustFind(submissionId);
    this.assertStatus(submission, SubmissionStatus.MODERATOR_APPROVED);
    if (submission.order.advertiserId !== advertiserId) {
      throw new ForbiddenException('Это не ваш заказ');
    }
    return this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: SubmissionStatus.ADVERTISER_APPROVED,
        decidedAt: new Date(),
      },
      include: { order: true, creator: true },
    });
  }

  async advertiserReject(
    submissionId: number,
    advertiserId: number,
    comment: string,
  ) {
    const submission = await this.mustFind(submissionId);
    this.assertStatus(submission, SubmissionStatus.MODERATOR_APPROVED);
    if (submission.order.advertiserId !== advertiserId) {
      throw new ForbiddenException('Это не ваш заказ');
    }
    return this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: SubmissionStatus.ADVERTISER_REJECTED,
        advertiserComment: comment,
        decidedAt: new Date(),
      },
      include: { order: true, creator: true },
    });
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

  private assertStatus(
    submission: { status: SubmissionStatus },
    expected: SubmissionStatus,
  ) {
    if (submission.status !== expected) {
      throw new ForbiddenException('Этот отклик уже обработан');
    }
  }
}
