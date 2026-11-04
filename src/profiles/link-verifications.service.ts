import { tr } from '../i18n/request-lang';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { LinkVerificationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const { PENDING, VERIFIED, NO_CODE } = LinkVerificationStatus;
/** Без похожих символов (0/O, 1/I): код вписывают руками. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Код подтверждения для ссылки креатора: один и тот же, пока ссылка та же, — хранить его до
 * отправки не нужно. Знать чужой код бесполезно: вписать его в описание может только владелец.
 */
export function linkCode(userId: number, url: string) {
  const hash = createHash('sha256').update(`${userId}:${url}`).digest();
  return `FX-${[...hash.subarray(0, 4)].map((b) => ALPHABET[b % ALPHABET.length]).join('')}`;
}

export type LinkCheck = {
  url: string;
  code: string;
  /** null — ещё не отправляли на проверку. */
  status: LinkVerificationStatus | null;
};

/**
 * Подтверждение аккаунтов соцсетей кодом в описании (по желанию креатора): креатор вписывает код
 * и отправляет, модератор открывает аккаунт и сверяет. Действует последняя запись по ссылке и
 * только пока ссылка есть в профиле (User.socialLinks). Решения — условными updateMany: два
 * модератора не решат проверку дважды.
 */
@Injectable()
export class LinkVerificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Статус каждой ссылки профиля — креатору в профиле. */
  async checks(userId: number, links: string[]): Promise<LinkCheck[]> {
    const last = await this.latest(userId, links);
    return links.map((url) => ({
      url,
      code: linkCode(userId, url),
      status: last.get(url) ?? null,
    }));
  }

  /** Подтверждённые ссылки из тех, что сейчас в профиле, — модератору при проверке ролика. */
  async verified(userId: number, links: string[]) {
    const last = await this.latest(userId, links);
    return links.filter((url) => last.get(url) === VERIFIED);
  }

  /** «Код добавлен» — ссылка уходит модератору. Уже на проверке или подтверждена — 409. */
  async submit(userId: number, links: string[], url: string) {
    if (!links.includes(url))
      throw new BadRequestException(tr('errors.linkNotInProfile'));
    const status = (await this.latest(userId, [url])).get(url);
    if (status === PENDING || status === VERIFIED)
      throw new ConflictException(tr(`errors.link_${status}`));
    try {
      return await this.prisma.linkVerification.create({
        data: { userId, url, code: linkCode(userId, url) },
        include: { user: true },
      });
    } catch (err) {
      // двойной тап: вторую проверку той же ссылки не пускает частичный уникальный индекс
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        throw new ConflictException(tr('errors.link_PENDING'));
      throw err;
    }
  }

  /** Очередь модератора: старые первыми. */
  listPending() {
    return this.prisma.linkVerification.findMany({
      where: { status: PENDING },
      include: { user: true },
      orderBy: { id: 'asc' },
    });
  }

  /** Решение модератора: код есть (VERIFIED) или нет (NO_CODE). */
  async decide(id: number, moderatorId: bigint, found: boolean) {
    const done = await this.prisma.linkVerification.updateMany({
      where: { id, status: PENDING },
      data: {
        status: found ? VERIFIED : NO_CODE,
        moderatorId,
        decidedAt: new Date(),
      },
    });
    if (!done.count) throw new ConflictException('Проверку уже рассмотрели');
    return this.prisma.linkVerification.findUniqueOrThrow({
      where: { id },
      include: { user: true },
    });
  }

  /** Последний статус по каждой ссылке. */
  private async latest(userId: number, links: string[]) {
    const rows = await this.prisma.linkVerification.findMany({
      where: { userId, url: { in: links } },
      orderBy: { id: 'asc' },
      select: { url: true, status: true },
    });
    return new Map(rows.map((r) => [r.url, r.status]));
  }
}
