import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { fetchModUsers, type ModUserRow, type ModUsersFilter } from '../api';
import { formatDate, formatMoney } from '../format';
import s from '../ui.module.css';
import { usePaged } from './usePaged';

const FILTERS: { id: ModUsersFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'creators', label: 'Креаторы' },
  { id: 'advertisers', label: 'Заказчики' },
  { id: 'banned', label: 'Заблокированные' },
];

/** «Люди» таблицей — как в мини-аппе (webapp/src/views/mod/ModUsersView.tsx): поиск, фильтр, профиль с баном. */
export function Users() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ModUsersFilter>('all');
  const fetchPage = useCallback(
    (page: number) => fetchModUsers(search, filter, page),
    [search, filter],
  );
  // поиск — по мере ввода, но не на каждую букву
  const list = usePaged<ModUserRow>(fetchPage, search ? 300 : 0);

  return (
    <div className={s.page}>
      <h1>Люди</h1>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="@username, имя или Telegram ID"
        aria-label="Поиск по @username, имени или Telegram ID"
        autoComplete="off"
      />
      <div className={s.chips} role="radiogroup" aria-label="Кого показать">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {list.error ? (
        <p className={s.hint}>Не удалось загрузить пользователей</p>
      ) : (
        !list.loading &&
        list.items.length === 0 && (
          <p className={s.hint}>
            {search ? 'Никого не нашли.' : 'Пользователей нет.'}
          </p>
        )
      )}

      {list.items.length > 0 && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Пользователь</th>
                <th>Креатор</th>
                <th>Заказчик</th>
                <th>С нами</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((u) => (
                <tr key={u.id}>
                  <td>
                    <Link to={`/mod/creators/${u.id}`}>{u.label}</Link>
                    <small>TG {u.telegramId}</small>
                  </td>
                  <td data-label="Креатор">
                    {u.creator ? (
                      <>
                        одобрено {u.creator.approved}
                        <small>
                          к выводу {formatMoney(u.creator.available)}
                        </small>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td data-label="Заказчик">
                    {u.advertiser
                      ? `заказов ${u.advertiser.orders}, открыто ${u.advertiser.open}`
                      : '—'}
                  </td>
                  <td data-label="С нами">с {formatDate(u.createdAt)}</td>
                  <td data-label="Статус">
                    {u.banned && (
                      <span className={`${s.badge} ${s.danger}`}>
                        {u.banned.final ? 'Бан без обжалования' : 'Бан'}
                      </span>
                    )}
                    {u.banned?.reason && <small>{u.banned.reason}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {list.items.length < list.total && (
        <button
          type="button"
          className={`${s.btn} ${s.more}`}
          disabled={list.loading}
          onClick={list.loadMore}
        >
          {list.loading ? 'Загрузка…' : 'Показать ещё'}
        </button>
      )}
    </div>
  );
}
