import { useTranslation } from 'react-i18next';
import { tList } from '../i18n';
import s from '../ui.module.css';

/**
 * Уроки для креаторов — тексты из словаря (learn.lessons.<key>), как в мини-аппе
 * (webapp/src/views/LearnView.tsx). Ролики к урокам пока не сняты — без кнопки «Смотреть».
 */
const LESSONS = ['take', 'shoot', 'submit', 'timing', 'withdraw', 'rules'];

export function Learn() {
  const { t } = useTranslation();
  return (
    <div className={`${s.page} ${s.narrow}`}>
      <header>
        <h1>{t('learn.title')}</h1>
        <p className={s.hint}>{t('learn.subtitle')}</p>
      </header>
      {/* <details> — раскрывается сам, без кода и с клавиатуры; первый урок открыт */}
      {LESSONS.map((key, i) => (
        <details key={key} className={s.card} open={i === 0}>
          <summary>
            {i + 1}. {t(`learn.lessons.${key}.title`)}
          </summary>
          <ul>
            {tList(`learn.lessons.${key}.keys`).map((k) => (
              <li key={k}>
                <strong>{k}</strong>
              </li>
            ))}
          </ul>
          <p className={s.hint}>{t(`learn.lessons.${key}.text`)}</p>
        </details>
      ))}
    </div>
  );
}
