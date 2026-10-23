import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { role as roleStore, ROLE_HOME, type Role } from '../role';
import { useStore } from '../store';
import s from './RoleSwitch.module.css';

const ROLES: Role[] = ['creator', 'advertiser'];

/** Ссылки, а не кнопки: роль переключает сам переход (App.tsx → roleOfPath). */
export default function RoleSwitch() {
  const { t } = useTranslation();
  const role = useStore(roleStore);
  return (
    <nav className={s.roleSwitch} aria-label={t('roles.aria')}>
      {ROLES.map((r) => (
        <Link
          key={r}
          to={ROLE_HOME[r]}
          aria-current={role === r ? 'page' : undefined}
        >
          {t(`roles.${r}`)}
        </Link>
      ))}
    </nav>
  );
}
