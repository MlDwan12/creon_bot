import { ConflictException, Injectable } from '@nestjs/common';
import { AdvertiserApplicationStatus, Prisma } from '@prisma/client';
import type { User } from '@prisma/client';
import { tr } from '../i18n/request-lang';
import { PrismaService } from '../prisma/prisma.service';
import { advertiserAccess } from './advertiser-access';

const { PENDING, APPROVED, REJECTED } = AdvertiserApplicationStatus;

/**
 * Кабинет заказчика открывает модератор: креатор подаёт заявку, команда созванивается и открывает
 * кабинет или отказывает (повтор — через ADVERTISER_RETRY_DAYS). Закрытый модератором кабинет —
 * только чтение своих заказов, новой заявки нет. Решения — условными updateMany: два модератора
 * на одной заявке не решат её дважды.
 */
@Injectable()
export class AdvertisersService {
  constructor(private readonly prisma: PrismaService) {}

  async access(user: User, isModerator: boolean) {
    const last = await this.prisma.advertiserApplication.findFirst({
      where: { userId: user.id },
      orderBy: { id: 'desc' },
      select: { status: true, decidedAt: true },
    });
    return advertiserAccess(user, last, isModerator);
  }

  async apply(
    user: User,
    isModerator: boolean,
    input: { email: string; phone: string | null; consentVersion?: string },
  ) {
    const { state } = await this.access(user, isModerator);
    if (state !== 'none')
      throw new ConflictException(tr(`errors.application_${state}`));
    try {
      return await this.prisma.advertiserApplication.create({
        data: { userId: user.id, ...input },
      });
    } catch (err) {
      // двойной тап: вторую заявку на рассмотрении не пускает частичный уникальный индекс
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        throw new ConflictException(tr('errors.application_pending'));
      throw err;
    }
  }

  /** Очередь модератора: старые первыми. */
  listPending() {
    return this.prisma.advertiserApplication.findMany({
      where: { status: PENDING },
      include: { user: true },
      orderBy: { id: 'asc' },
    });
  }

  /** Одобрить заявку — открыть кабинет. */
  approve(applicationId: number, moderatorId: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const app = await tx.advertiserApplication.findUnique({
        where: { id: applicationId },
      });
      const done = await tx.advertiserApplication.updateMany({
        where: { id: applicationId, status: PENDING },
        data: { status: APPROVED, moderatorId, decidedAt: new Date() },
      });
      if (!app || !done.count)
        throw new ConflictException('Заявку уже рассмотрели');
      return tx.user.update({
        where: { id: app.userId },
        data: { advertiserAt: new Date(), advertiserClosedAt: null },
      });
    });
  }

  /** Отказ: `note` — только для команды. Повторная заявка — через ADVERTISER_RETRY_DAYS. */
  async reject(applicationId: number, moderatorId: bigint, note: string) {
    const done = await this.prisma.advertiserApplication.updateMany({
      where: { id: applicationId, status: PENDING },
      data: {
        status: REJECTED,
        moderatorId,
        note: note || null,
        decidedAt: new Date(),
      },
    });
    if (!done.count) throw new ConflictException('Заявку уже рассмотрели');
    return this.prisma.advertiserApplication.findUniqueOrThrow({
      where: { id: applicationId },
      include: { user: true },
    });
  }

  /** Открыть кабинет из карточки пользователя — без заявки или вернуть закрытый. Заявка на рассмотрении — одобряется. */
  open(userId: number, moderatorId: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const done = await tx.user.updateMany({
        where: { id: userId, advertiserAt: null },
        data: { advertiserAt: new Date(), advertiserClosedAt: null },
      });
      if (!done.count) throw new ConflictException('Кабинет уже открыт');
      await tx.advertiserApplication.updateMany({
        where: { userId, status: PENDING },
        data: { status: APPROVED, moderatorId, decidedAt: new Date() },
      });
      return tx.user.findUniqueOrThrow({ where: { id: userId } });
    });
  }

  /** Закрыть кабинет: активные заказы работают дальше, свои заказы видно, новых и правок нет. */
  async close(userId: number) {
    const done = await this.prisma.user.updateMany({
      where: { id: userId, advertiserAt: { not: null } },
      data: { advertiserAt: null, advertiserClosedAt: new Date() },
    });
    if (!done.count) throw new ConflictException('Кабинет и так закрыт');
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  }
}
