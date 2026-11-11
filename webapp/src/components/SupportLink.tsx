import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { type SupportAbout, supportSearch } from '@fixum/shared';
import { fetchMe } from '../api';

/** Ссылка «написать менеджеру» — форма в мини-аппе; `about` — тема, уйдёт вместе с сообщением. */
export default function SupportLink({
  label,
  about = null,
}: {
  label?: string;
  about?: SupportAbout | null;
}) {
  const { t } = useTranslation();
  // у модератора своё окно — та же форма по адресу /mod/support
  const path = useLocation().pathname.startsWith('/mod')
    ? '/mod/support'
    : '/support';
  // false — поддержка не настроена (или это сам аккаунт поддержки)
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    fetchMe()
      .then((me) => setEnabled(Boolean(me.supportUrl)))
      .catch(() => {});
  }, []);
  if (!enabled) return null;
  return (
    <Link
      to={{
        pathname: path,
        search: supportSearch(about),
      }}
      className="quiet-link"
    >
      {label ?? t('common.support')}
    </Link>
  );
}
