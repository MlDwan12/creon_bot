import { findContacts, findExactContacts } from './contacts';

describe('findContacts', () => {
  it.each([
    ['пишите @ivan_petrov', '@ivan_petrov'],
    ['связь: t.me/ivan', 't.me/ivan'],
    ['https://vk.com/id123', 'https://vk.com/id123'],
    ['звоните +7 (999) 123-45-67', '+7 (999) 123-45-67'],
    ['или 89991234567', '89991234567'],
    ['почта ivan@mail.ru', 'ivan@mail.ru'],
    ['напишите в тг', 'тг'],
    ['Пишите в ЛИЧКУ', 'в ЛИЧКУ'],
    ['мой ватсап ниже', 'ватсап'],
  ])('находит: %s', (text, fragment) => {
    expect(findContacts(text)).toContain(fragment);
  });

  it.each([
    'Снять распаковку наушников, 30 секунд, вертикально',
    'Товар: https://www.ozon.ru/product/123 и https://www.wildberries.ru/catalog/1',
    'Бюджет 5000, срок 7 дней, артикул 12345678901',
    'Тгновенно не бывает', // «тг» внутри слова
  ])('не срабатывает: %s', (text) => {
    expect(findContacts(text)).toEqual([]);
  });

  it('email не считается ещё и @ником; повторы убираются', () => {
    expect(findContacts('ivan@mail.ru', 'снова ivan@mail.ru')).toEqual([
      'ivan@mail.ru',
    ]);
  });
});

describe('findExactContacts', () => {
  it('только явные контакты, без намёков', () => {
    expect(findExactContacts('пишите @ivan_petrov в тг')).toEqual([
      '@ivan_petrov',
    ]);
    expect(findExactContacts('Видео не для телеграма, переснимите')).toEqual(
      [],
    );
  });
});

describe('обходы фильтра', () => {
  it.each([
    ['＠ivan_petrov', '@ivan_petrov'], // полноширинный @
    ['@iv\u200ban_petrov', '@ivan_petrov'], // невидимый символ внутри
    ['пишите @ ivan_petrov', '@ ivan_petrov'], // пробел после @
    ['@аnya_ugc', '@аnya_ugc'], // кириллическая «а»
    ['https://t%2Eme/ivan', 'https://t.me/ivan'],
    ['https://%74.me/ivan', 'https://t.me/ivan'],
    ['https://bit.ly/3abc', 'https://bit.ly/3abc'],
    ['https://linktr.ee/brand', 'https://linktr.ee/brand'],
    ['taplink.cc/brand', 'taplink.cc/brand'],
    ['+380 67 123 45 67', '+380 67 123 45 67'],
    ['+1 (555) 123-4567', '+1 (555) 123-4567'],
    // точки-«иероглифы» и селекторы вариантов: браузер сведёт адрес к t.me / wa.me
    ['https://t\u3002me/ivan', 'https://t.me/ivan'],
    ['https://t\uFF61me/ivan', 'https://t.me/ivan'],
    ['https://t.\uFE0Fme/ivan', 'https://t.me/ivan'],
    ['https://wa\u3002me/79991234567', 'https://wa.me/79991234567'],
  ])('явный контакт: %s', (text, fragment) => {
    expect(findExactContacts(text)).toContain(fragment);
  });

  it.each([
    'https://habit.ly/page', // не bit.ly
    'https://pivk.com/x', // не vk.com
    'Цена 1500 руб., +20% к охватам',
    'https://www.ozon.ru/product/123',
  ])('не контакт: %s', (text) => {
    expect(findExactContacts(text)).toEqual([]);
  });

  it('профиль на площадке — подсказка модератору, не отказ', () => {
    for (const url of [
      'https://x.com/brand',
      'https://www.youtube.com/channel/UC123abc',
    ]) {
      expect(findExactContacts(url)).toEqual([]);
      expect(findContacts(url)).toHaveLength(1);
    }
    expect(findContacts('https://x.com/brand/status/123')).toEqual([]);
  });
});

it('ссылка с www. и поддоменом — тоже контакт', () => {
  expect(findExactContacts('https://www.instagram.com/brand')).toHaveLength(1);
  expect(findExactContacts('https://m.vk.com/brand')).toHaveLength(1);
});
