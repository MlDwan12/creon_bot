import { publicName } from './format';

describe('publicName', () => {
  it('первая буква имени и код — без самого имени и контактов в нём', () => {
    const name = publicName({
      id: 7,
      firstName: 'аня тг anya_ugc +380671234567',
    });
    expect(name).toMatch(/^Креатор А\. · [A-HJ-NP-Z2-9]{4}$/);
  });

  it('у креатора всегда один код, у разных — разные', () => {
    const code = (id: number) => publicName({ id, firstName: 'Аня' }).slice(-4);
    expect(code(7)).toBe(code(7));
    expect(code(7)).not.toBe(code(8));
  });

  it.each([
    ['＠anya', 'A'], // полноширинный @ — не буква, первая буква — a
    ['', null],
    [null, null],
    ['😀 123', null],
  ])('«%s» → буква %s', (firstName, letter) => {
    const name = publicName({ id: 1, firstName });
    expect(
      name.startsWith(letter ? `Креатор ${letter}. · ` : 'Креатор · '),
    ).toBe(true);
  });
});
