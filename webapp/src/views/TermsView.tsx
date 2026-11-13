import { useTranslation } from 'react-i18next';
import ru from '../../../legal/terms.ru.html?raw';
import s from './PrivacyView.module.css';

/**
 * Пользовательское соглашение (оферта). Текст — в legal/ в корне (общий с сайтом); свой, поэтому
 * вставляется как HTML. Действует русская редакция; английской пока нет.
 */
export default function TermsView() {
  const { i18n } = useTranslation();
  return (
    <>
      {i18n.language === 'en' && (
        <p className={s.enNote} lang="en">
          The English version is in preparation. The Russian version below is
          the one in force.
        </p>
      )}
      <main className={s.page} dangerouslySetInnerHTML={{ __html: ru }} />
    </>
  );
}
