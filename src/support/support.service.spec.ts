import type { ConfigService } from '@nestjs/config';
import type { Context, Telegraf } from 'telegraf';
import type { PrismaService } from '../prisma/prisma.service';
import { SupportService } from './support.service';

describe('лимит сообщений в поддержку', () => {
  const service = () =>
    new SupportService(
      {} as Telegraf<Context>,
      {} as PrismaService,
      { get: () => '-100' } as unknown as ConfigService,
    );
  const send = (s: SupportService, id: number, times: number) =>
    Array.from({ length: times }, () => s.allowMessage(id));

  it('один человек — не больше 5 в минуту', () => {
    expect(send(service(), 1, 6)).toEqual([
      ...Array<string>(5).fill('ok'),
      'flood',
    ]);
  });

  it('несколько аккаунтов вместе — не больше 15 в минуту на всю группу', () => {
    const s = service();
    for (const id of [1, 2, 3]) send(s, id, 5);
    expect(s.allowMessage(4)).toBe('busy');
  });

  it('флудер не съедает общий лимит', () => {
    const s = service();
    send(s, 1, 50);
    expect(s.allowMessage(2)).toBe('ok');
  });
});
