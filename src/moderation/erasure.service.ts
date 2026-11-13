import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, SubmissionStatus } from '@prisma/client';
import { ModeratorGuard } from '../auth/moderator.guard';
import { PayoutsService } from '../payouts/payouts.service';
import { PrismaService } from '../prisma/prisma.service';

/** Что мешает удалить данные — по-русски для модератора; пусто — можно. */
export function erasureBlockers(
  activeOrders: number,
  openSubmissions: number,
  balance: {
    heldMinor: number;
    requestedMinor: number;
    availableMinor: number;
  },
): string[] {
  const out: string[] = [];
  if (activeOrders) out.push(`заказы в работе (${activeOrders})`);
  if (openSubmissions)
    out.push(`отклики в работе или на проверке (${openSubmissions})`);
  if (balance.heldMinor)
    out.push('ролики в холде — деньги ещё не зафиксированы');
  if (balance.requestedMinor)
    out.push('заявка на вывод — проведите или отклоните');
  if (balance.availableMinor)
    out.push('на балансе есть деньги к выводу — пусть выведет');
  return out;
}

/** Заказы, которые ещё идут или ждут модератора: удалять данные заказчика рано. */
const ACTIVE_ORDERS: OrderStatus[] = [
  OrderStatus.PENDING_MODERATION,
  OrderStatus.OPEN,
  OrderStatus.EDIT_REJECTED,
];

/**
 * Удаление личных данных по запросу пользователя (политика конфиденциальности, п. 6) — делает
 * модератор. Стираем то, по чему можно узнать человека: имя, username, кошелёк, соцсети, подключённые
 * аккаунты площадок, почту и телефон из заявок, сессии сайта; telegramId меняем на -id. Заказы,
 * ролики и выплаты остаются — без привязки к человеку, для отчётности и отчётов заказчикам.
 * Ссылки на опубликованные ролики не трогаем: это публичный контент, за который заплатил заказчик.
 * Переписка в группе поддержки — в Telegram, не в нашей базе: тему модератор удаляет там сам.
 */
@Injectable()
export class ErasureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payouts: PayoutsService,
    private readonly moderatorGuard: ModeratorGuard,
  ) {}

  async erase(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    if (this.moderatorGuard.isModerator(user))
      throw new ForbiddenException('Данные модератора так не удалить');
    if (user.erasedAt) throw new ConflictException('Данные уже удалены');
    const blockers = await this.blockers(userId);
    if (blockers.length)
      throw new ConflictException(`Сначала завершите: ${blockers.join('; ')}`);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          // реальные id Telegram положительные — -id не совпадёт ни с кем и останется уникальным
          telegramId: BigInt(-userId),
          username: null,
          firstName: null,
          socialLinks: [],
          payoutWallet: null,
          supportTopicId: null,
          supportChatId: null,
          erasedAt: new Date(),
          // кабинет заказчика закрыт: заказы видно в отчётах, новых не будет
          advertiserAt: null,
          advertiserClosedAt: user.advertiserAt
            ? new Date()
            : user.advertiserClosedAt,
        },
      }),
      this.prisma.socialAccount.deleteMany({ where: { userId } }),
      this.prisma.oAuthPending.deleteMany({ where: { userId } }),
      this.prisma.webLogin.deleteMany({ where: { userId } }),
      this.prisma.linkVerification.deleteMany({ where: { userId } }),
      this.prisma.advertiserApplication.deleteMany({ where: { userId } }),
      // выплаты остаются для отчётности, кошелёк в них — нет
      this.prisma.payout.updateMany({
        where: { creatorId: userId },
        data: { wallet: null },
      }),
      // недосланные уведомления ему же: адрес чата — его telegramId
      this.prisma.notification.deleteMany({
        where: { chatId: user.telegramId },
      }),
    ]);
  }

  /**
   * Незавершённое, что потерялось бы с данными: деньги, которые ему ещё должны, и дела, по которым
   * с ним надо связаться. Модератор сначала решает их (заблокировать — закроет заказы и отклики).
   */
  private async blockers(userId: number): Promise<string[]> {
    const [orders, submissions, balance] = await Promise.all([
      this.prisma.order.count({
        where: { advertiserId: userId, status: { in: ACTIVE_ORDERS } },
      }),
      this.prisma.submission.count({
        where: {
          creatorId: userId,
          status: {
            in: [SubmissionStatus.IN_PROGRESS, SubmissionStatus.SUBMITTED],
          },
        },
      }),
      this.payouts.balance(userId),
    ]);
    return erasureBlockers(orders, submissions, balance);
  }
}
