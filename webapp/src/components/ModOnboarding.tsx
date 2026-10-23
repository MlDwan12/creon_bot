import { useEffect, useState } from 'react';
import { createStore, useStore } from '../store';
import s from './ModOnboarding.module.css';

/**
 * Короткое введение для модератора: что где в его окне и правила площадки. Показывается при
 * первом открытии окна модератора на устройстве, потом — по ссылке «Как работать модератору» в «Я».
 * Окно модератора только на русском — тексты здесь, а не в словаре.
 * ponytail: «уже видел» — на устройстве (localStorage); на новом телефоне покажется ещё раз.
 */
const SEEN_KEY = 'modOnboarding.v1';

function seen() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Открыто ли окно: само при первом входе, иначе — по ссылке из «Я». */
const open = createStore(!seen());
export const openModOnboarding = () => open.set(true);

const STEPS: { title: string; points: string[]; icon: string }[] = [
  {
    title: 'Очередь',
    icon: 'M4 13l2.5-8h11L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 13h4.5l1 2.5h5l1-2.5H20',
    points: [
      'Здесь всё, что ждёт решения: заказы, ролики, итоги холда, отзывы и жалобы.',
      'Сначала самые старые. Оранжевым — ждут дольше 4 часов: их — в первую очередь.',
      'Цифра на вкладке — сколько всего ждёт.',
    ],
  },
  {
    title: 'Проверка',
    icon: 'M5 12.5l4.5 4.5L19 7',
    points: [
      'Заказ: понятно ли задание, нет ли контактов в тексте. Поставьте ставку за 1000 просмотров и посмотрите карточку глазами креатора.',
      'Ролик: сверьте с требованиями заказа и зафиксируйте просмотры — за них и начислится оплата.',
      'Итог холда: публикация на месте — зафиксируйте просмотры; нет — «Публикация удалена».',
      'Отказ — всегда с причиной: её увидит автор.',
    ],
  },
  {
    title: 'Выплаты',
    icon: 'M3 6h18v13H3zM3 10.5h18M7 15h3',
    points: [
      'Переведите USDT в сети TRC20 на кошелёк из заявки и нажмите «Выплачено» — креатору придёт уведомление.',
      'Кошелёк сменили незадолго до заявки — уточните у креатора через поддержку, что это он.',
      'Креатор заблокирован — решайте, переводить ли.',
    ],
  },
  {
    title: 'Люди',
    icon: 'M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c1-3.2 3.5-4.8 6.5-4.8s5.5 1.6 6.5 4.8M16 4.8a3.5 3.5 0 0 1 0 6.4',
    points: [
      'Все креаторы и заказчики: поиск по @username, имени или Telegram ID.',
      'В профиле — блокировка с причиной и история: кто жаловался, кто банил и разбанивал.',
    ],
  },
  {
    title: 'Я',
    icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5',
    points: [
      'Ваши решения за период и сколько их ждали, таблица команды.',
      'Выгрузка CSV — своих действий или всей команды — придёт в чат с ботом.',
      'Там же — статистика площадки и «Что работает».',
    ],
  },
  {
    title: 'Правила',
    icon: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z',
    points: [
      'Стороны не видят контактов друг друга: заказчику — только имя с кодом («Креатор А. · K7M2»), без @username и соцсетей.',
      'Контакты в заказе, отзыве или ролике — повод отклонить: общение идёт только через площадку.',
      'Вопросы пользователей — в их теме в группе поддержки: ответ в теме бот перешлёт им, /close закрывает обращение.',
      'Модераторов в «Людях» нет — их не блокируют.',
    ],
  },
];

export default function ModOnboarding() {
  const isOpen = useStore(open);
  const [step, setStep] = useState(0);

  // Пока окно открыто, экран под ним не прокручивается: иначе на телефоне два скролла.
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  function close() {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // без хранилища покажется ещё раз при следующем запуске
    }
    open.set(false);
    setStep(0);
  }

  const current = STEPS[step];
  const last = step === STEPS.length - 1;
  return (
    <div
      className={s.onboarding}
      role="dialog"
      aria-modal="true"
      aria-label="Как работать модератору"
    >
      <div className={s.top}>
        <span className={s.counter}>
          {step + 1} из {STEPS.length}
        </span>
        <button type="button" className={s.link} onClick={close}>
          Пропустить
        </button>
      </div>
      <div className={s.dots} aria-hidden="true">
        {STEPS.map((st, i) => (
          <span key={st.title} className={i === step ? s.on : undefined} />
        ))}
      </div>
      <span className={s.icon} aria-hidden="true">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={current.icon} />
        </svg>
      </span>
      <h1>{current.title}</h1>
      <ul className={s.points}>
        {current.points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <div
        className={s.buttons}
        style={step === 0 ? { gridTemplateColumns: '1fr' } : undefined}
      >
        {step > 0 && (
          <button
            type="button"
            className={s.back}
            onClick={() => setStep(step - 1)}
          >
            Назад
          </button>
        )}
        <button
          type="button"
          className="main-button"
          onClick={last ? close : () => setStep(step + 1)}
        >
          {last ? 'Понятно' : 'Дальше'}
        </button>
      </div>
    </div>
  );
}
