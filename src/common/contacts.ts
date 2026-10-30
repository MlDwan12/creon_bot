/*
 * Контакты для связи в обход площадки. findContacts — подсказка модератору, вместе с намёками
 * («пишите в тг»): ложные срабатывания допустимы. findExactContacts — только явные
 * контакты: по ним текст, который модератор не видит, отклоняется.
 * Ссылки на маркетплейсы и прочие сайты не считаем: в задании они нормальны.
 * Текст сначала приводится к одному виду (normalize): иначе «＠ivan», «@ivan» с невидимым символом
 * внутри или «t%2Eme» прошли бы мимо.
 */

/** Домен целиком, а не хвост слова: «habit.ly» — не bit.ly, «pivk.com» — не vk.com; поддомены (www., m.) — да. */
const DOMAIN_START = '(?<![\\w-])';

/** Сами контакты: @ник, ссылки на мессенджеры и соцсети, телефон, email. */
const CONTACTS: RegExp[] = [
  // @ник (но не часть email); любой буквой — ник с кириллической «а» тоже, и через пробел после @
  /(?<![\w.@])@ ?\p{L}[\p{L}\d_]{3,31}/giu,
  // мессенджеры и соцсети; сокращатели и визитки прячут, куда ведут, — тоже контакт
  new RegExp(
    `(?:https?:\\/\\/)?(?:www\\.)?${DOMAIN_START}(?:t\\.me|telegram\\.(?:me|dog)|wa\\.me|api\\.whatsapp\\.com|vk\\.(?:com|ru|cc|me)|ok\\.ru|instagram\\.com|discord\\.(?:gg|com)|viber\\.click|bit\\.ly|clck\\.ru|tinyurl\\.com|cutt\\.ly|goo\\.su|t\\.ly|is\\.gd|linktr\\.ee|taplink\\.(?:cc|at|ws))(?:\\/\\S*)?`,
    'giu',
  ),
  // российский телефон: +7 или 8 и 10 цифр с любыми разделителями
  /(?<!\d)(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/gu,
  // любой международный: + и 10–15 цифр с разделителями
  /(?<![\d+])\+\d(?:[\s\-()]*\d){9,14}(?!\d)/gu,
  // email
  // с начала слова: иначе на длинной строке без @ поиск квадратичный
  /(?<![\w.+-])[\w.+-]+@[\w-]+\.[a-z]{2,}/giu,
];

/** Намёки — только подсказка модератору: «видео не для телеграма» — не контакт. */
const HINTS: RegExp[] = [
  // «пишите в тг», «в личку», ватсап…
  /(?<![\p{L}\d])(?:телеграм\p{L}*|тг|tg|telegram|ватсап\p{L}*|вотсап\p{L}*|whats?app|вайбер\p{L}*|viber|в\s+лс|в\s+личк\p{L}*|в\s+директ)(?![\p{L}\d])/giu,
  // профиль на площадке, а не ролик: x.com/brand, youtube.com/channel/… — пример ролика в задании законен
  new RegExp(
    `${DOMAIN_START}(?:x|twitter)\\.com\\/(?!i\\/|status\\/)\\w+(?!\\w)(?!\\/status)|${DOMAIN_START}youtube\\.com\\/(?:channel|c|user)\\/[\\w-]+`,
    'giu',
  ),
];

/**
 * Один вид для поиска: полноширинные и прочие «похожие» символы — в обычные (NFKC: ＠ → @),
 * невидимые (zero-width, разворот текста, селекторы вариантов) — прочь, %-коды в ссылках —
 * раскодировать. Точки-«иероглифы» (「t。me」) — в обычную: браузер в адресе делает так же (IDNA).
 */
function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .replace(
      /\p{Cf}|[\u034F\u180B-\u180F\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu,
      '',
    )
    .replace(/[\u3002\uFF0E\uFF61]/g, '.')
    .replace(/(?:%[0-9a-f]{2})+/gi, (m) => {
      try {
        return decodeURIComponent(m);
      } catch {
        return m;
      }
    });
}

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

function find(patterns: RegExp[], text: string): string[] {
  const t = normalize(text);
  const found = patterns.flatMap((re) =>
    [...t.matchAll(re)].map((m) => ({ at: m.index, value: m[0].trim() })),
  );
  found.sort((a, b) => a.at - b.at);
  return [...new Set(found.map((f) => f.value))];
}
