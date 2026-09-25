import { findContacts, findExactContacts, stripContacts } from './contacts';

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

describe('stripContacts', () => {
  it.each([
    ['Аня @anya_ugc', 'Аня'],
    ['Иван +7 999 123-45-67', 'Иван'],
    ['t.me/ivan Иван', 'Иван'],
    ['@anya_ugc', ''],
    ['Анна-Мария', 'Анна-Мария'],
  ])('%s → «%s»', (name, expected) => {
    expect(stripContacts(name)).toBe(expected);
  });
});
