import { renderToStaticMarkup } from 'react-dom/server';
import ru from '../../../i18n/ru.json';
import { type Faq, Landing } from './Landing';

/**
 * Лендинг в HTML — при сборке (scripts/prerender.mjs). Вопросы — общие с экраном «Помощь»
 * (help.faq в i18n) плюс те, что нужны только тем, кто ещё не пользуется площадкой.
 */
export function render() {
  const faq: Faq = [
    {
      q: 'Сколько стоит реклама?',
      a: 'Вы задаёте общий бюджет — от 10 USDT. Модератор назначает ставку за 1000 просмотров, и бюджет тратится только на просмотры одобренных роликов.',
    },
    ...(ru.help.faq as Faq),
    {
      q: 'Как стать заказчиком?',
      a: 'Оставьте заявку в профиле: почта и, по желанию, телефон. Менеджер свяжется, коротко созвонимся — и откроем кабинет.',
    },
    {
      q: 'Как креатору получить деньги?',
      a: 'На кошелёк USDT в сети TRC20, от 10 USDT. Деньги за ролик доступны к выводу через 5 дней после одобрения.',
    },
  ];
  // разметка FAQPage (Schema.org): по ней поисковики могут показать вопросы прямо в выдаче
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
  return {
    html: renderToStaticMarkup(<Landing faq={faq} />),
    // < — чтобы текст не закрыл тег <script>
    faqLd: JSON.stringify(faqLd).replace(/</g, '\\u003c'),
  };
}
