import { PLATFORM_PATHS } from '../components/PlatformIcon';

/**
 * Лендинг site.fixumapp.com — для тех, кто не вошёл. Рендерится в готовый HTML при сборке
 * (render.tsx + scripts/prerender.mjs): поисковики видят текст без JS. Поэтому здесь нет роутера,
 * window и загрузки данных — только props. Тот же компонент можно положить в Next.js как есть.
 * Ссылки на бота (data-bot) после загрузки подставляет client.ts из /api/web/config — у прода и
 * дев-стенда боты разные, а сборка одна; без JS они ведут на /login, где бот тоже есть.
 */

export type Faq = { q: string; a: string }[];

const LOGIN = '/login';

const PLATFORMS = [
  ['TIKTOK', 'TikTok'],
  ['YOUTUBE', 'YouTube'],
  ['VK', 'VK'],
  ['INSTAGRAM', 'Instagram'],
] as const;

const BRAND_STEPS = [
  'Опишите задание, приложите 3–10 примеров роликов и задайте бюджет',
  'Модератор проверит заказ и назначит ставку за 1000 просмотров',
  'Креаторы публикуют ролики у себя — каждый проверяет модератор',
  'Бюджет закончится — заказ закроется сам. Сверх бюджета не потратите',
];

const CREATOR_STEPS = [
  'Выберите заказ в каталоге и откликнитесь',
  'Опубликуйте ролик у себя в соцсети — на всё 7 дней',
  'Набрали порог просмотров — пришлите ссылку',
  'Модератор зафиксирует просмотры, через 5 дней деньги можно вывести',
];

const FACTS = [
  ['от 10 USDT', 'бюджет заказа — начните с теста'],
  ['за 1000', 'просмотров — ставку назначает модератор'],
  ['5 дней', 'холд: проверяем, что ролик на месте'],
  ['USDT', 'оплата и вывод в TRC20'],
];

/** Иконки гарантий — контуром, цвет задаёт CSS (currentColor). */
const GUARANTEES: { title: string; text: string; icon: string }[] = [
  {
    title: 'Каждый ролик проверяет модератор',
    text: 'Сверяет с заданием и сам фиксирует просмотры. Платите за них, а не за цифру, которую назвал креатор.',
    icon: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z M9 12l2 2 4-4',
  },
  {
    title: 'Удалённый ролик не оплачивается',
    text: '5 дней после одобрения проверяем, что публикация на месте. Нет её — деньги возвращаются в бюджет заказа.',
    icon: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M12 7v5l3 2',
  },
  {
    title: 'Один ролик — одна оплата',
    text: 'Тот же ролик дважды не сдать — ни в один заказ, ни в разные.',
    icon: 'M7 5h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z M4 10h16',
  },
  {
    title: 'Отчёт по каждому заказу',
    text: 'Ролики, просмотры, переходы по ссылке и цена 1000 просмотров — по заказу и по каждому креатору.',
    icon: 'M5 19V9 M12 19V5 M19 19v-7',
  },
  {
    title: 'Всё через поддержку',
    text: 'Стороны не видят контактов друг друга. Вопросы и споры решает менеджер Fixum.',
    icon: 'M4 6h16v10H9l-5 4z',
  },
  {
    title: 'Бюджет под контролем',
    text: 'Тратится только на одобренные ролики. Закончился — заказ закрывается сам.',
    icon: 'M3 12h4l3-8 4 16 3-8h4',
  },
];

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="steps">
      {items.map((text, i) => (
        <li key={text}>
          <span className="num" aria-hidden="true">
            {i + 1}
          </span>
          <p>{text}</p>
        </li>
      ))}
    </ol>
  );
}

export function Landing({ faq }: { faq: Faq }) {
  return (
    <>
      <header className="top">
        <div className="wrap topbar">
          <a className="logo" href="/" aria-label="Fixum — на главную">
            <span className="mark" aria-hidden="true">
              F
            </span>
            Fixum
          </a>
          <nav className="navlinks" aria-label="Разделы">
            <a href="#brands">Брендам</a>
            <a href="#creators">Креаторам</a>
            <a href="#safe">Гарантии</a>
            <a href="#faq">Вопросы</a>
          </nav>
          <div className="topactions">
            <a className="btn ghost small navlogin" href={LOGIN}>
              Войти
            </a>
            <a className="btn violet small" href={LOGIN} data-bot="">
              Открыть в Telegram
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="wrap hero">
          <div className="herotext">
            <p className="eyebrow">Реклама в коротких роликах</p>
            <h1 className="display">
              Реклама у креаторов — оплата{' '}
              <span className="mark-lime">только за просмотры</span>
            </h1>
            <p className="lead">
              Бренд задаёт бюджет, креаторы публикуют ролики в своих соцсетях.
              Модератор проверяет каждый ролик и фиксирует просмотры — платите
              только за них.
            </p>
            <div className="actions">
              <a className="btn violet" href="#brands">
                Заказать рекламу
              </a>
              <a className="btn ghost" href="#creators">
                Зарабатывать на роликах
              </a>
            </div>
            <div className="platforms">
              <p className="label">Ролики публикуют в</p>
              <ul>
                {PLATFORMS.map(([code, name]) => (
                  <li key={code}>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d={PLATFORM_PATHS[code]} />
                    </svg>
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Пример интерфейса — не реальные данные */}
          <div className="preview" aria-hidden="true">
            <div className="card shadow">
              <div className="row between">
                <div>
                  <p className="strong">Обзор наушников</p>
                  <p className="hint small">Заказ · пример</p>
                </div>
                <span className="chip">Идёт сбор</span>
              </div>
              <div className="budget">
                <span style={{ width: '58%' }} />
                <span className="reserved" style={{ width: '10%' }} />
              </div>
              <p className="hint small">Потрачено 174 из 300 USDT</p>
              <div className="tiles">
                <div>
                  <p className="hint xsmall">Роликов</p>
                  <p className="tilenum">9</p>
                </div>
                <div>
                  <p className="hint xsmall">Просмотров</p>
                  <p className="tilenum">108 700</p>
                </div>
                <div>
                  <p className="hint xsmall">За 1000</p>
                  <p className="tilenum">1,6 $</p>
                </div>
              </div>
            </div>
            <div className="card shadow approved">
              <span className="play">
                <svg width="18" height="18" viewBox="0 0 16 16">
                  <path d="M4 2.5v11l9-5.5z" fill="#fff" />
                </svg>
              </span>
              <div className="grow">
                <p className="strong">Ролик одобрен</p>
                <p className="hint small">
                  12 400 просмотров · проверил модератор
                </p>
              </div>
              <span className="plus">+24,8 USDT</span>
            </div>
          </div>
        </section>

        <section className="facts" aria-label="Условия">
          <div className="wrap factsgrid">
            {FACTS.map(([big, small]) => (
              <div key={big}>
                <p className="factbig">{big}</p>
                <p className="factsmall">{small}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="wrap audiences">
          <div id="brands" className="card aud aud-brand">
            <p className="eyebrow">Брендам</p>
            <h2 className="h2">Платите за просмотры, а не за обещания</h2>
            <Steps items={BRAND_STEPS} />
            <div className="audfoot">
              <p className="hint">
                Кабинет заказчика открываем после короткого созвона — так в
                каталоге остаются только настоящие бренды.
              </p>
              <div>
                <a className="btn violet" href={LOGIN} data-bot="">
                  Стать заказчиком
                </a>
              </div>
            </div>
          </div>
          <div id="creators" className="card aud aud-creator">
            <p className="eyebrow olive">Креаторам</p>
            <h2 className="h2">Получайте USDT за просмотры своих роликов</h2>
            <Steps items={CREATOR_STEPS} />
            <div className="audfoot">
              <p className="hint">
                Оплата за порог закрепляется в момент сдачи — бюджет заказа не
                уйдёт другим, пока ролик на проверке.
              </p>
              <div>
                <a className="btn lime" href={LOGIN} data-bot="">
                  Смотреть заказы
                </a>
              </div>
            </div>
          </div>
        </section>

        <section id="safe" className="wrap section">
          <div className="sectionhead">
            <p className="eyebrow">Гарантии</p>
            <h2 className="h1">Честно для обеих сторон</h2>
          </div>
          <div className="guarantees">
            {GUARANTEES.map((g) => (
              <div key={g.title} className="card">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={g.icon} />
                </svg>
                <h3 className="h3">{g.title}</h3>
                <p className="muted">{g.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="faq" className="wrap section faqsection">
          <div className="faqhead">
            <p className="eyebrow">Вопросы</p>
            <h2 className="h1">Частые вопросы</h2>
            <p className="muted">
              Не нашли ответ — напишите боту, ответит менеджер.
            </p>
          </div>
          <div className="faqlist">
            {faq.map((f, i) => (
              <details key={f.q} open={i === 0}>
                <summary>
                  {f.q}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="wrap cta-wrap">
          <div className="cta">
            <div className="ctatext">
              <h2 className="h1">Всё работает в Telegram</h2>
              <p>
                Заказы, ролики, отчёты и выплаты — в мини-приложении. На сайте —
                те же кабинеты с компьютера.
              </p>
            </div>
            <div className="actions">
              <a className="btn lime" href={LOGIN} data-bot="">
                Открыть в Telegram
              </a>
              <a className="btn white" href={LOGIN}>
                Войти на сайт
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="wrap footrow">
          <span className="logo small">Fixum</span>
          <nav aria-label="Подвал">
            <a href={LOGIN} data-privacy="">
              Политика конфиденциальности
            </a>
            <a href={LOGIN} data-bot="">
              Поддержка в Telegram
            </a>
            <a href={LOGIN}>Вход</a>
          </nav>
          <span>© 2026 Fixum</span>
        </div>
      </footer>
    </>
  );
}
