import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANGS, langFromTelegram, translator, userLang } from './i18n';

/** Ключи словаря без суффиксов множественного числа (_one, _few…) — у языков их разный набор. */
function keys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj))
    return [prefix];
  return Object.entries(obj).flatMap(([k, v]) =>
    keys(v, prefix ? `${prefix}.${k}` : k),
  );
}
const dictionary = (lang: string) =>
  new Set(
    keys(
      JSON.parse(
        readFileSync(join(process.cwd(), 'i18n', `${lang}.json`), 'utf8'),
      ),
    ).map((k) => k.replace(/_(zero|one|two|few|many|other)$/, '')),
  );

describe('i18n', () => {
  it('во всех словарях одни и те же ключи — перевод не забыт', () => {
    const [base, ...rest] = LANGS.map(dictionary);
    for (const other of rest)
      expect([...other].sort()).toEqual([...base].sort());
  });

  it('язык: выбранный в профиле, иначе по Telegram — русский только для ru', () => {
    expect(langFromTelegram('ru')).toBe('ru');
    expect(langFromTelegram('ru-RU')).toBe('ru');
    expect(langFromTelegram('en')).toBe('en');
    expect(langFromTelegram('uk')).toBe('en');
    expect(langFromTelegram(undefined)).toBe('en');
    expect(userLang({ language: 'en', telegramLanguage: 'ru' })).toBe('en');
    expect(userLang({ language: null, telegramLanguage: 'ru' })).toBe('ru');
    expect(userLang({ language: 'de', telegramLanguage: 'ru' })).toBe('ru');
  });

  it('русские множественные формы', () => {
    const t = translator('ru');
    expect(t('catalog.openCount', { count: 1 })).toBe('1 открытый заказ');
    expect(t('catalog.openCount', { count: 3 })).toBe('3 открытых заказа');
    expect(t('catalog.openCount', { count: 11 })).toBe('11 открытых заказов');
    expect(translator('en')('catalog.openCount', { count: 2 })).toBe(
      '2 open orders',
    );
  });
});
