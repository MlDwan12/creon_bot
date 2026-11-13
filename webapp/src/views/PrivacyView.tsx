import { useTranslation } from 'react-i18next';
import en from '../../../legal/privacy.en.html?raw';
import ru from '../../../legal/privacy.ru.html?raw';
import s from './PrivacyView.module.css';

/**
 * Политика конфиденциальности. Текст — в legal/ в корне (общий с сайтом, web/scripts/prerender.mjs);
 * свой, не из пользователей, поэтому вставляется как HTML. Действует русская редакция, английская —
 * перевод для удобства (так и написано в ней). Экран пересоздаётся при смене языка.
 */
export default function PrivacyView() {
  const { i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  return (
    <main
      className={s.page}
      lang={isEn ? 'en' : undefined}
      dangerouslySetInnerHTML={{ __html: isEn ? en : ru }}
    />
  );
}
