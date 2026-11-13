import { deflateSync } from 'node:zlib';
import type { Order, Submission } from '@prisma/client';
import { PUBLICATION_DELETED } from '../submissions/submissions.service';
import { cardHtml, cardPing, cardState, cardStatus } from './submission-card';

const sub = (over: Partial<Submission>) =>
  ({
    status: 'SUBMITTED',
    finalizedAt: null,
    goneAt: null,
    moderatorComment: null,
    videoUrl: 'https://vk.com/clip-1_2',
    views: 12400,
    payoutMinor: 2480,
    decidedAt: null,
    ...over,
    order: { id: 7, title: 'Заказ', status: 'OPEN' } as Order,
  }) as Submission & { order: Order };

describe('карточка ролика', () => {
  it('HTML в пределах Telegram: до 32 КБ и до 4 КБ после zlib 9', () => {
    for (const lang of ['ru', 'en'] as const) {
      const html = Buffer.from(cardHtml(lang));
      expect(html.length).toBeLessThanOrEqual(32768);
      expect(deflateSync(html, { level: 9 }).length).toBeLessThanOrEqual(4096);
      // строки вшиты, подстановки оставлены виджету
      expect(cardHtml(lang)).toContain('{{date}}');
      expect(cardHtml(lang)).not.toContain('__L__');
    }
  });

  it('состояние до 1 КБ даже с длинным названием и причиной', () => {
    const long = cardState(
      {
        ...sub({
          status: 'MODERATOR_REJECTED',
          moderatorComment: 'я'.repeat(2000),
        }),
        order: { id: 1, title: 'Ж'.repeat(500), status: 'OPEN' },
      },
      'ru',
    );
    expect(Buffer.byteLength(JSON.stringify(long))).toBeLessThanOrEqual(1024);
  });

  it('статус карточки по ролику', () => {
    expect(cardStatus(sub({}))).toBe('review');
    expect(cardStatus(sub({ status: 'MODERATOR_APPROVED' }))).toBe('hold');
    expect(
      cardStatus(sub({ status: 'MODERATOR_APPROVED', goneAt: new Date() })),
    ).toBe('gone');
    expect(
      cardStatus(
        sub({ status: 'MODERATOR_APPROVED', finalizedAt: new Date() }),
      ),
    ).toBe('ready');
    expect(
      cardStatus(
        sub({
          status: 'MODERATOR_REJECTED',
          moderatorComment: PUBLICATION_DELETED,
        }),
      ),
    ).toBe('canceled');
    expect(
      cardStatus(
        sub({ status: 'MODERATOR_REJECTED', moderatorComment: 'нет' }),
      ),
    ).toBe('rejected');
  });

  it('холд: дата конца и пинг с суммой; непроверенное название — только номер', () => {
    const state = cardState(
      {
        ...sub({
          status: 'MODERATOR_APPROVED',
          decidedAt: new Date('2026-11-13T09:00:00Z'),
        }),
        order: { id: 7, title: 'Заказ', status: 'PENDING_MODERATION' },
      },
      'ru',
    );
    expect(state).toMatchObject({ s: 'hold', t: '#7', p: 'VK', d: '18.11' });
    expect(cardPing(state, 'ru')).toBe(
      '✅ Ролик одобрен — начислено 24,8 USDT',
    );
    expect(cardPing({ ...state, s: 'review' }, 'ru')).toBe('');
  });
});
