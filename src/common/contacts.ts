/*
 * Контакты для связи в обход площадки. findContacts — подсказка модератору, вместе с намёками
 * («пишите в тг»): ложные срабатывания допустимы. findExactContacts / stripContacts — только явные
 * контакты: по ним текст, который модератор не видит, отклоняется или вычищается.
 * Ссылки на маркетплейсы и прочие сайты не считаем: в задании они нормальны.
 */

/** Сами контакты: @ник, ссылки на мессенджеры и соцсети, телефон, email. */
const CONTACTS: RegExp[] = [
  // @ник (но не часть email)
  /(?<![\w.@])@[a-z][\w]{3,31}/giu,
  // мессенджеры и соцсети
  /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.(?:me|dog)|wa\.me|api\.whatsapp\.com|vk\.(?:com|ru|cc|me)|ok\.ru|instagram\.com|discord\.(?:gg|com)|viber\.click)(?:\/\S*)?/giu,
  // российский телефон: +7 или 8 и 10 цифр с любыми разделителями
  /(?<!\d)(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/gu,
  // email
  /[\w.+-]+@[\w-]+\.[a-z]{2,}/giu,
];

/** Намёки — только подсказка модератору: «видео не для телеграма» — не контакт. */
const HINTS: RegExp[] = [
  // «пишите в тг», «в личку», ватсап…
  /(?<![\p{L}\d])(?:телеграм\p{L}*|тг|tg|telegram|ватсап\p{L}*|вотсап\p{L}*|whats?app|вайбер\p{L}*|viber|в\s+лс|в\s+личк\p{L}*|в\s+директ)(?![\p{L}\d])/giu,
];

/** Найденные фрагменты без повторов, в порядке появления в тексте. */
export function findContacts(
  ...texts: (string | null | undefined)[]
): string[] {
  return find([...CONTACTS, ...HINTS], texts.filter(Boolean).join('\n'));
}

/** Только явные контакты (@ник, ссылка на мессенджер, телефон, email) — без намёков. */
export function findExactContacts(text: string): string[] {
  return find(CONTACTS, text);
}

/** Текст без явных контактов — для имени, которое видит другая сторона сделки. */
export function stripContacts(text: string): string {
  return CONTACTS.reduce((t, re) => t.replace(re, ' '), text)
    .replace(/\s+/g, ' ')
    .trim();
}

function find(patterns: RegExp[], text: string): string[] {
  const found = patterns.flatMap((re) =>
    [...text.matchAll(re)].map((m) => ({ at: m.index, value: m[0].trim() })),
  );
  found.sort((a, b) => a.at - b.at);
  return [...new Set(found.map((f) => f.value))];
}
