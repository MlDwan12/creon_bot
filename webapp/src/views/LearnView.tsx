import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tList } from '../i18n';
import { safeUrl } from '../telegram';
import s from './LearnView.module.css';

/**
 * Уроки для креаторов: тексты — в словаре (learn.lessons.<key>). Ролики добавим позже: вставить ссылку
 * в `videoUrl` — появится кнопка «Смотреть».
 * ponytail: список в коде, без админки — пока уроков несколько и меняются они редко.
 */
const LESSONS: { key: string; videoUrl: string | null }[] = [
  { key: 'take', videoUrl: null },
  { key: 'shoot', videoUrl: null },
  { key: 'submit', videoUrl: null },
  { key: 'timing', videoUrl: null },
  { key: 'withdraw', videoUrl: null },
  { key: 'rules', videoUrl: null },
];

export default function LearnView() {
  const { t } = useTranslation();
  /** Раскрыт один урок за раз — список короткий, видно все заголовки; -1 — все свёрнуты. */
  const [open, setOpen] = useState(0);
  return (
    <main className={s.learn}>
      <header className={s.head}>
        <h1>{t('learn.title')}</h1>
        <p>{t('learn.subtitle')}</p>
      </header>

      {LESSONS.map((l, i) => (
        <section key={l.key} className={s.lesson}>
          <button
            id={`lesson-${l.key}`}
            type="button"
            className={s.lessonHead}
            aria-expanded={open === i}
            aria-controls={`lesson-body-${l.key}`}
            onClick={() => setOpen(open === i ? -1 : i)}
          >
            <span
              className={open === i ? `${s.num} ${s.on}` : s.num}
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <span className={s.lessonTitle}>
              {t(`learn.lessons.${l.key}.title`)}
            </span>
            <svg
              className={open === i ? `${s.chevron} ${s.up}` : s.chevron}
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {open === i && (
            <div
              id={`lesson-body-${l.key}`}
              className={s.lessonBody}
              role="region"
              aria-labelledby={`lesson-${l.key}`}
            >
              <ul className={s.keys}>
                {tList(`learn.lessons.${l.key}.keys`).map((k) => (
                  <li key={k}>{k}</li>
                ))}
              </ul>
              <p>{t(`learn.lessons.${l.key}.text`)}</p>
              {safeUrl(l.videoUrl) && (
                <a
                  href={safeUrl(l.videoUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={s.watch}
                >
                  {t('learn.watch')}
                </a>
              )}
            </div>
          )}
        </section>
      ))}
    </main>
  );
}
