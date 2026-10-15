import { recordExternalApi } from '../monitoring/metrics';
import { tr } from '../i18n/request-lang';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SocialAccount, SocialPlatform, User } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  enabledProviders,
  Provider,
  ProviderRejected,
  randomState,
  Tokens,
  VideoStats,
} from './providers';
import { TokenCrypto } from './token-crypto';

/** Сколько ждём возвращения креатора с площадки после «Подключить». */
const PENDING_TTL_MS = 15 * 60 * 1000;
/** Обновляем access-токен заранее, чтобы он не протух посреди запроса. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** Аккаунтов одной площадки у креатора: по каждому — запрос к площадке при подсчёте просмотров. */
export const MAX_PER_PLATFORM = 5;

/**
 * Аккаунты креаторов на площадках, подключённые через OAuth (TikTok, VK, Instagram); на площадке
 * их может быть несколько (MAX_PER_PLATFORM). По токену креатора
 * читаем просмотры его роликов — ViewCounterService. Площадка без ключей в env выключена: кнопки
 * подключения нет, её ролики считает модератор.
 */
@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);
  private readonly providers: Map<SocialPlatform, Provider>;
  private readonly crypto?: TokenCrypto;
  private readonly webappUrl: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.providers = new Map(
      enabledProviders(config).map((p) => [p.platform, p]),
    );
    const key = config.get<string>('SOCIAL_TOKENS_KEY');
    // без ключа шифрования площадки не включаем (env.validation требует его вместе с ключами площадок)
    if (key) this.crypto = new TokenCrypto(key);
    else this.providers.clear();
    this.webappUrl = config.get<string>('WEBAPP_URL')!.replace(/\/$/, '');
  }

  /** Площадка по ссылке на ролик, если она включена и id ролика разобран. */
  providerFor(url: string): { provider: Provider; videoId: string } | null {
    for (const provider of this.providers.values()) {
      const videoId = provider.videoId(url);
      if (videoId) return { provider, videoId };
    }
    return null;
  }

  /** Включённые площадки и подключённые на них аккаунты креатора — для экрана профиля. */
  async list(userId: number) {
    const accounts = await this.prisma.socialAccount.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      select: { id: true, platform: true, label: true },
    });
    return [...this.providers.values()].map((p) => {
      const mine = accounts
        .filter((a) => a.platform === p.platform)
        .map(({ id, label }) => ({ id, label }));
      return {
        platform: p.platform,
        name: p.name,
        accounts: mine,
        canAdd: mine.length < MAX_PER_PLATFORM,
      };
    });
  }

  /** Начать подключение: ссылка на вход на площадке. Вернётся креатор на callback. */
  async start(userId: number, platform: SocialPlatform) {
    const provider = this.mustProvider(platform);
    // ponytail: лимит проверяем только здесь — две вкладки входа сразу дадут лишний аккаунт; не страшно
    const count = await this.prisma.socialAccount.count({
      where: { userId, platform },
    });
    if (count >= MAX_PER_PLATFORM)
      throw new ForbiddenException(
        tr('errors.accountLimit', {
          max: MAX_PER_PLATFORM,
          platform: provider.name,
        }),
      );
    // брошенные входы — заодно убираем
    await this.prisma.oAuthPending.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    const state = randomState();
    const verifier = randomBytes(48).toString('base64url');
    await this.prisma.oAuthPending.create({
      data: {
        state,
        userId,
        platform,
        verifier,
        expiresAt: new Date(Date.now() + PENDING_TTL_MS),
      },
    });
    return provider.authorizeUrl({
      state,
      challenge: createHash('sha256').update(verifier).digest('base64url'),
      redirectUri: this.redirectUri(platform),
    });
  }

  /**
   * Callback площадки: проверяем state (одноразовый, ваш ли это вход), меняем код на токены и
   * сохраняем. Тот же аккаунт подключили снова — обновляем его. Аккаунт площадки уже у другого
   * креатора — отказ: чужие ролики за свои не выдать.
   */
  async complete(
    platform: SocialPlatform,
    rawQuery: Record<string, unknown>,
  ): Promise<{ user: User; name: string }> {
    const provider = this.mustProvider(platform);
    const query = callbackParams(rawQuery);
    // одноразовый: удаляем сразу — даже неудачная попытка его сжигает
    const pending = query.state
      ? await this.prisma.oAuthPending
          .delete({ where: { state: query.state } })
          .catch((err: unknown) => {
            // нет такого — устарел или уже использован; другие сбои базы — наверх
            if (
              err instanceof Prisma.PrismaClientKnownRequestError &&
              err.code === 'P2025'
            )
              return null;
            throw err;
          })
      : null;
    if (
      !pending ||
      pending.platform !== platform ||
      pending.expiresAt.getTime() < Date.now()
    )
      throw new BadRequestException(tr('errors.oauthExpired'));

    let tokens: Tokens;
    try {
      tokens = await provider.exchange({
        query,
        verifier: pending.verifier,
        redirectUri: this.redirectUri(platform),
      });
    } catch (err) {
      this.logger.warn(
        `${provider.name}: подключение не удалось — ${String(err)}`,
      );
      throw new BadRequestException(
        err instanceof ProviderRejected
          ? tr('errors.oauthDenied', { platform: provider.name })
          : tr('errors.oauthDown', { platform: provider.name }),
      );
    }

    // имя — только для профиля: не отдали — подключаем без него
    const label = await provider.label(tokens.accessToken).catch(() => null);
    const data = { ...this.encrypted(tokens), label };
    try {
      const existing = await this.prisma.socialAccount.findUnique({
        where: {
          platform_externalId: { platform, externalId: tokens.externalId },
        },
      });
      if (existing && existing.userId !== pending.userId)
        throw new ConflictException(
          tr('errors.accountTaken', { platform: provider.name }),
        );
      if (existing)
        await this.prisma.socialAccount.update({
          where: { id: existing.id },
          data,
        });
      else
        await this.prisma.socialAccount.create({
          data: { userId: pending.userId, platform, ...data },
        });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        throw new ConflictException(
          tr('errors.accountTaken', { platform: provider.name }),
        );
      throw err;
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: pending.userId },
    });
    return { user, name: provider.name };
  }

  /** Отключить свой аккаунт; чужой id — ничего не происходит. */
  async disconnect(userId: number, accountId: number) {
    await this.prisma.socialAccount.deleteMany({
      where: { id: accountId, userId },
    });
  }

  /**
   * Просмотры роликов креатора по его токенам; нет в карте — посчитать не удалось. Аккаунтов на
   * площадке несколько — спрашиваем по очереди, пока не найдём все ролики: каждый аккаунт отдаёт
   * только свои. Аккаунт не подключён, площадка отозвала доступ или не ответила — ролика нет в
   * карте, его посчитает модератор.
   */
  async stats(
    userId: number,
    platform: SocialPlatform,
    videoIds: string[],
  ): Promise<Map<string, VideoStats>> {
    const out = new Map<string, VideoStats>();
    const provider = this.providers.get(platform);
    if (!provider || !videoIds.length) return out;
    const accounts = await this.prisma.socialAccount.findMany({
      where: { userId, platform },
      orderBy: { id: 'asc' },
    });
    let left = videoIds;
    for (const account of accounts) {
      if (!left.length) break;
      try {
        const token = await this.accessToken(account, provider);
        if (!token) continue;
        for (const [id, s] of await provider.stats(token, left)) out.set(id, s);
        recordExternalApi(provider.platform, true);
        left = left.filter((id) => !out.has(id));
      } catch (err) {
        recordExternalApi(provider.platform, false);
        this.logger.warn(
          `${provider.name}: просмотры по аккаунту #${account.id} не получены — ${String(err)}`,
        );
      }
    }
    return out;
  }

  /**
   * Действующий access-токен; протухает — обновляем и сохраняем новый (refresh может смениться).
   * Площадка отказала в обновлении (доступ отозван) — аккаунт удаляем: креатор подключит заново.
   * ponytail: два одновременных обновления одного аккаунта не сериализуются — при смене refresh
   * второе может получить отказ; тогда ролик посчитает модератор, а аккаунт останется.
   */
  private async accessToken(account: SocialAccount, provider: Provider) {
    if (account.accessExpiresAt.getTime() - REFRESH_MARGIN_MS > Date.now())
      return this.crypto!.decrypt(account.accessToken);
    try {
      const tokens = await provider.refresh({
        refreshToken: this.crypto!.decrypt(account.refreshToken),
        deviceId: account.deviceId,
        externalId: account.externalId,
      });
      await this.prisma.socialAccount.update({
        where: { id: account.id },
        data: this.encrypted(tokens),
      });
      return tokens.accessToken;
    } catch (err) {
      if (!(err instanceof ProviderRejected)) throw err;
      this.logger.warn(
        `${provider.name}: доступ отозван, аккаунт #${account.id} отключён`,
      );
      await this.prisma.socialAccount.deleteMany({ where: { id: account.id } });
      return null;
    }
  }

  private encrypted(
    t: Tokens,
  ): Pick<
    SocialAccount,
    | 'externalId'
    | 'accessToken'
    | 'refreshToken'
    | 'accessExpiresAt'
    | 'deviceId'
  > {
    return {
      externalId: t.externalId,
      accessToken: this.crypto!.encrypt(t.accessToken),
      refreshToken: this.crypto!.encrypt(t.refreshToken),
      accessExpiresAt: t.accessExpiresAt,
      deviceId: t.deviceId ?? null,
    };
  }

  private mustProvider(platform: SocialPlatform) {
    const provider = this.providers.get(platform);
    if (!provider) throw new NotFoundException(tr('errors.platformOff'));
    return provider;
  }

  /** Адрес возврата с площадки — его же регистрируют в настройках приложения на площадке. */
  redirectUri(platform: SocialPlatform) {
    return `${this.webappUrl}/oauth/${platform.toLowerCase()}/callback`;
  }
}

/**
 * Параметры callback строками. VK ID может прислать их одним JSON в `payload` — разворачиваем.
 */
function callbackParams(raw: Record<string, unknown>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw))
    if (typeof v === 'string') flat[k] = v;
  if (flat.payload) {
    try {
      const inner = JSON.parse(flat.payload) as Record<string, unknown>;
      for (const [k, v] of Object.entries(inner))
        if (typeof v === 'string' || typeof v === 'number') flat[k] = String(v);
    } catch {
      // не JSON — оставляем как есть, exchange сам скажет, чего не хватает
    }
  }
  return flat;
}
