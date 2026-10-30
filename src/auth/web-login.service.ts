import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { tr } from '../i18n/request-lang';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

/** Сколько живёт ссылка входа и код. */
const TTL_MS = 10 * 60_000;
/** Неверных кодов на одну ссылку — дальше вход по ней закрыт (4 цифры: шанс угадать 5 из 10 000). */
const MAX_ATTEMPTS = 5;
/** Префикс параметра /start: t.me/<бот>?start=login_<токен>. */
export const LOGIN_START_PREFIX = 'login_';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const codeHash = (token: string, code: string) => sha256(`${token}:${code}`);

/**
 * Вход на сайт кодом из бота — без окна Telegram, где он просит номер телефона. Сайт получает
 * одноразовую ссылку на бота; бот присылает тому, кто её открыл, код из 4 цифр; код вводят на сайте.
 * Чужая ссылка ничего не даёт: код приходит в Telegram владельцу аккаунта, а не тому, кто её прислал.
 */
@Injectable()
export class WebLoginService {
  private botUsername?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    @InjectBot() private readonly bot: Telegraf<Context>,
  ) {}

  /** Новая ссылка входа; токен — странице, она отправит его вместе с кодом. */
  async start(): Promise<{ token: string; link: string }> {
    // заодно — просроченные: таблица не растёт от брошенных входов
    await this.prisma.webLogin.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    const token = randomBytes(24).toString('base64url');
    await this.prisma.webLogin.create({
      data: {
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + TTL_MS),
      },
    });
    this.botUsername ??= this.bot.telegram.getMe().then((me) => me.username);
    const username = await this.botUsername.catch((err: unknown) => {
      this.botUsername = undefined; // Telegram недоступен — следующий вход спросит снова
      throw err;
    });
    return {
      token,
      link: `https://t.me/${username}?start=${LOGIN_START_PREFIX}${token}`,
    };
  }

  /**
   * Бот: ссылку открыл этот пользователь Telegram — привязываем вход к нему и выдаём код.
   * null — ссылка устарела или не наша. Открыл снова — новый код, попытки не обнуляются.
   */
  async issueCode(
    token: string,
    from: { id: number; username?: string; first_name?: string },
  ): Promise<string | null> {
    const row = await this.prisma.webLogin.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (!row || row.expiresAt < new Date()) return null;
    const user = await this.users.findOrCreate({
      telegramId: BigInt(from.id),
      username: from.username,
      firstName: from.first_name,
    });
    const code = String(randomInt(0, 10_000)).padStart(4, '0');
    await this.prisma.webLogin.update({
      where: { tokenHash: row.tokenHash },
      data: { userId: user.id, codeHash: codeHash(token, code) },
    });
    return code;
  }

  /** Сайт: код верный — id пользователя, ссылка входа сгорает. */
  async verify(token: string, code: string): Promise<number> {
    const tokenHash = sha256(token);
    const row = await this.prisma.webLogin.findUnique({ where: { tokenHash } });
    if (!row || row.expiresAt < new Date())
      throw new BadRequestException(tr('errors.loginCodeExpired'));
    if (!row.codeHash || !row.userId)
      throw new BadRequestException(tr('errors.loginCodeNotSent'));
    // попытку считаем до сверки и атомарно: параллельные запросы не переберут код в обход лимита
    const { count } = await this.prisma.webLogin.updateMany({
      where: { tokenHash, attempts: { lt: MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (count === 0)
      throw new BadRequestException(tr('errors.loginCodeLocked'));
    const ok =
      /^\d{4}$/.test(code) &&
      timingSafeEqual(
        Buffer.from(codeHash(token, code)),
        Buffer.from(row.codeHash),
      );
    if (!ok) throw new BadRequestException(tr('errors.loginCodeWrong'));
    // одноразовая: из двух одновременных верных запросов войдёт один
    const used = await this.prisma.webLogin.deleteMany({
      where: { tokenHash, codeHash: row.codeHash },
    });
    if (used.count === 0)
      throw new BadRequestException(tr('errors.loginCodeExpired'));
    return row.userId;
  }
}
