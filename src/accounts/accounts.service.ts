import {
  BadRequestException,
  ConflictException,
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

interface Pending {
  userId: number;
  platform: SocialPlatform;
  verifier: string;
  expiresAt: number;
}

/**
 * Аккаунты креаторов на площадках, подключённые через OAuth (TikTok, VK). По токену креатора
 * читаем просмотры его роликов — ViewCounterService. Площадка без ключей в env выключена: кнопки
 * подключения нет, её ролики считает модератор.
 */
@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);
  private readonly providers: Map<SocialPlatform, Provider>;
  private readonly crypto?: TokenCrypto;
  private readonly webappUrl: string;
  // ponytail: в памяти — после рестарта начатое подключение придётся повторить; инстанс один.
  private readonly pending = new Map<string, Pending>();

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

  /** Включённые площадки и подключены ли они у креатора — для экрана профиля. */
  async list(userId: number) {
    const accounts = await this.prisma.socialAccount.findMany({
      where: { userId },
      select: { platform: true },
    });
    return [...this.providers.values()].map((p) => ({
      platform: p.platform,
      name: p.name,
      connected: accounts.some((a) => a.platform === p.platform),
    }));
  }

  /** Начать подключение: ссылка на вход на площадке. Вернётся креатор на callback. */
  start(userId: number, platform: SocialPlatform) {
    const provider = this.mustProvider(platform);
    const now = Date.now();
    for (const [k, p] of this.pending)
      if (p.expiresAt < now) this.pending.delete(k);
    const state = randomState();
    const verifier = randomBytes(48).toString('base64url');
    this.pending.set(state, {
      userId,
      platform,
      verifier,
      expiresAt: now + PENDING_TTL_MS,
    });
    return provider.authorizeUrl({
      state,
      challenge: createHash('sha256').update(verifier).digest('base64url'),
      redirectUri: this.redirectUri(platform),
    });
  }

  /**
   * Callback площадки: проверяем state (одноразовый, ваш ли это вход), меняем код на токены и
   * сохраняем. Аккаунт площадки уже у другого креатора — отказ: чужие ролики за свои не выдать.
   */
  async complete(
    platform: SocialPlatform,
    rawQuery: Record<string, unknown>,
  ): Promise<{ user: User; name: string }> {
    const provider = this.mustProvider(platform);
    const query = callbackParams(rawQuery);
    const pending = query.state ? this.pending.get(query.state) : undefined;
    if (query.state) this.pending.delete(query.state);
    if (
      !pending ||
      pending.platform !== platform ||
      pending.expiresAt < Date.now()
    )
      throw new BadRequestException(
        'Ссылка устарела — нажмите «Подключить» в приложении ещё раз',
      );

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
          ? `${provider.name} не дал доступ к видео. Попробуйте ещё раз и разрешите доступ`
          : `${provider.name} не ответил — попробуйте позже`,
      );
    }

    try {
      await this.prisma.socialAccount.upsert({
        where: { userId_platform: { userId: pending.userId, platform } },
        create: { userId: pending.userId, platform, ...this.encrypted(tokens) },
        update: this.encrypted(tokens),
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        throw new ConflictException(
          `Этот аккаунт ${provider.name} уже подключён к другому профилю`,
        );
      throw err;
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: pending.userId },
    });
    return { user, name: provider.name };
  }

  async disconnect(userId: number, platform: SocialPlatform) {
    await this.prisma.socialAccount.deleteMany({ where: { userId, platform } });
  }

  /**
   * Просмотры роликов креатора по его токену; нет в карте — посчитать не удалось. Аккаунт не
   * подключён, площадка отозвала доступ или не ответила — пусто, ролик посчитает модератор.
   */
  async stats(
    userId: number,
    platform: SocialPlatform,
    videoIds: string[],
  ): Promise<Map<string, VideoStats>> {
    const provider = this.providers.get(platform);
    if (!provider || !videoIds.length) return new Map();
    try {
      const token = await this.accessToken(userId, provider);
      return token ? await provider.stats(token, videoIds) : new Map();
    } catch (err) {
      this.logger.warn(
        `${provider.name}: просмотры не получены — ${String(err)}`,
      );
      return new Map();
    }
  }

  /**
   * Действующий access-токен; протухает — обновляем и сохраняем новый (refresh может смениться).
   * Площадка отказала в обновлении (доступ отозван) — аккаунт удаляем: креатор подключит заново.
   * ponytail: два одновременных обновления одного аккаунта не сериализуются — при смене refresh
   * второе может получить отказ; тогда ролик посчитает модератор, а аккаунт останется.
   */
  private async accessToken(userId: number, provider: Provider) {
    const account = await this.prisma.socialAccount.findUnique({
      where: { userId_platform: { userId, platform: provider.platform } },
    });
    if (!account) return null;
    if (account.accessExpiresAt.getTime() - REFRESH_MARGIN_MS > Date.now())
      return this.crypto!.decrypt(account.accessToken);
    try {
      const tokens = await provider.refresh({
        refreshToken: this.crypto!.decrypt(account.refreshToken),
        deviceId: account.deviceId,
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
    if (!provider)
      throw new NotFoundException('Эта площадка пока не подключается');
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
