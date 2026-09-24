import { createHmac } from 'node:crypto';
import { validateInitData } from './init-data.util';

const TOKEN = '123456:TEST-token';
const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60;

/** Подписывает поля так же, как это делает Telegram, — чтобы собрать валидный initData. */
function sign(fields: Record<string, string>, token = TOKEN): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret)
    .update(dataCheckString)
    .digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const fields = {
  auth_date: String(NOW / 1000 - 60),
  query_id: 'AAH',
  signature: 'ed25519-sig',
  user: JSON.stringify({ id: 42, first_name: 'Иван', username: 'ivan' }),
};

describe('validateInitData', () => {
  it('принимает корректно подписанные данные и отдаёт пользователя', () => {
    expect(validateInitData(sign(fields), TOKEN, DAY, NOW)).toEqual({
      id: 42,
      first_name: 'Иван',
      username: 'ivan',
    });
  });

  it('отклоняет подмену пользователя', () => {
    const raw = new URLSearchParams(sign(fields));
    raw.set('user', JSON.stringify({ id: 1 }));
    expect(validateInitData(raw.toString(), TOKEN, DAY, NOW)).toBeNull();
  });

  it('отклоняет данные, подписанные другим ботом', () => {
    expect(
      validateInitData(sign(fields, '999:other'), TOKEN, DAY, NOW),
    ).toBeNull();
  });

  it('отклоняет устаревшие данные', () => {
    const old = { ...fields, auth_date: String(NOW / 1000 - DAY - 1) };
    expect(validateInitData(sign(old), TOKEN, DAY, NOW)).toBeNull();
  });

  it('отклоняет данные без hash или с мусором в hash', () => {
    expect(
      validateInitData(new URLSearchParams(fields).toString(), TOKEN, DAY, NOW),
    ).toBeNull();
    const raw = new URLSearchParams(sign(fields));
    raw.set('hash', 'zz');
    expect(validateInitData(raw.toString(), TOKEN, DAY, NOW)).toBeNull();
  });
});
