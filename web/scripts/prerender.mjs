// Лендинг в готовый HTML: тело и разметку вопросов (FAQPage) — в dist/landing.html.
// Запускается после `vite build` и `vite build --ssr` (package.json, build).
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

const { render } = await import('../dist-ssr/render.js');
const { html, faqLd } = render();
const file = 'dist/landing.html';
const page = readFileSync(file, 'utf8');
if (!page.includes('<!--landing-->') || !page.includes('<!--faq-ld-->'))
  throw new Error(`${file}: нет меток <!--landing--> / <!--faq-ld-->`);
writeFileSync(
  file,
  page
    .replace('<!--landing-->', () => html)
    .replace('<!--faq-ld-->', () => faqLd),
);
rmSync('dist-ssr', { recursive: true, force: true });
console.log(`${file}: лендинг отрисован (${html.length} символов)`);
