import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchMyOrders, type MyOrder } from '../api';
import { LanguagePicker } from '../components/LanguagePicker';
import { formatViews } from '../format';
import { useSession } from '../session';
import s from '../ui.module.css';

/** Профиль заказчика: сводка по его рекламе и язык (LanguagePicker) — как в мини-аппе (webapp/src/views/AccountView.tsx). */
export function Account() {
  const { t } = useTranslation();
  const { me } = useSession();
  const [orders, setOrders] = useState<MyOrder[]>();
  // второстепенное: не загрузилось — просто не показываем
  useEffect(() => {
    fetchMyOrders().then(setOrders, () => {});
  }, []);

  return (
    <div className={s.page}>
      <header>
        <h1>{me.firstName ?? t('tabs.profile')}</h1>
        <p className={s.hint}>{t('account.subtitle')}</p>
      </header>

      {!!orders?.length && (
        <div className={s.tiles}>
          <div className={s.tile}>
            <strong>
              {formatViews(orders.reduce((n, o) => n + o.views, 0))}
            </strong>
            <span>{t('account.views')}</span>
          </div>
          <div className={s.tile}>
            <strong>{orders.length}</strong>
            <span>{t('account.orders', { count: orders.length })}</span>
          </div>
          <div className={s.tile}>
            <strong>{orders.reduce((n, o) => n + o.approved, 0)}</strong>
            <span>
              {t('account.approved', {
                count: orders.reduce((n, o) => n + o.approved, 0),
              })}
            </span>
          </div>
        </div>
      )}

      <LanguagePicker />
    </div>
  );
}
