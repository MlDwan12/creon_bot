import { videoAuthor, walletChangedHoursBefore } from './moderation.controller';

const author = {
  platform: 'YOUTUBE' as const,
  id: 'UC1',
  handle: 'mrbeast',
  name: 'MrBeast',
};

describe('videoAuthor', () => {
  it('подтверждён только по подключённому аккаунту', () => {
    expect(
      videoAuthor({ views: 1, likes: null, ownAccount: true }, []).status,
    ).toBe('verified');
  });

  it('совпадение со ссылкой из профиля — не подтверждение: ссылки креатор вписал сам', () => {
    const stats = { views: 1, likes: null, author };
    expect(videoAuthor(stats, ['https://youtube.com/@MrBeast']).status).toBe(
      'inProfile',
    );
    expect(videoAuthor(stats, ['https://x.com/someone']).status).toBe(
      'mismatch',
    );
  });
});

describe('walletChangedHoursBefore', () => {
  const at = new Date('2026-10-22T12:00:00Z');
  const hoursAgo = (h: number) => new Date(at.getTime() - h * 3_600_000);

  it.each([
    [null, null],
    [hoursAgo(0.5), 0],
    [hoursAgo(47.9), 47],
    [hoursAgo(48), null],
    [hoursAgo(-1), null], // сменили после заявки — в заявке старый адрес
  ])('%s → %s', (changedAt, hours) => {
    expect(walletChangedHoursBefore(changedAt, at)).toBe(hours);
  });
});
