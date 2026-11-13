// Лендинг и юридические страницы в готовый HTML — после `vite build` и `vite build --ssr`
// (package.json, build). Заготовка — dist/landing.html: в ней стили и скрипт лендинга со своими хешами.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

const { render } = await import('../dist-ssr/render.js');
const { html, faqLd, privacy, terms } = render();
const template = readFileSync('dist/landing.html', 'utf8');
for (const mark of ['<!--landing-->', '<!--faq-ld-->'])
  if (!template.includes(mark))
    throw new Error(`dist/landing.html: нет метки ${mark}`);

/** Страница по заготовке: своё тело, заголовок, описание и адрес; разметка вопросов — только у лендинга. */
function page(body, { title, description, path, ld }) {
  let out = template.replace('<!--landing-->', () => body);
  out = ld
    ? out.replace('<!--faq-ld-->', () => ld)
    : out.replace(
        /\s*<script type="application\/ld\+json"><!--faq-ld--><\/script>/,
        '',
      );
  if (!title) return out;
  const url = `https://site.fixumapp.com${path}`;
  return out
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(
      /(<meta\s+name="description"\s+content=")[^"]*"/,
      `$1${description}"`,
    )
    .replace(/(<link rel="canonical" href=")[^"]*"/, `$1${url}"`)
    .replace(/(<meta property="og:url" content=")[^"]*"/, `$1${url}"`)
    .replace(/(<meta property="og:title" content=")[^"]*"/, `$1${title}"`);
}

const pages = {
  'dist/landing.html': page(html, { ld: faqLd }),
  'dist/privacy.html': page(privacy, {
    title: 'Политика конфиденциальности — Fixum',
    description: 'Какие данные Fixum хранит, зачем и кто их видит.',
    path: '/privacy.html',
  }),
  'dist/terms.html': page(terms, {
    title: 'Пользовательское соглашение — Fixum',
    description: 'Условия работы с сервисом Fixum для брендов и креаторов.',
    path: '/terms.html',
  }),
};
for (const [file, content] of Object.entries(pages)) {
  writeFileSync(file, content);
  console.log(`${file}: отрисован (${content.length} символов)`);
}
rmSync('dist-ssr', { recursive: true, force: true });
