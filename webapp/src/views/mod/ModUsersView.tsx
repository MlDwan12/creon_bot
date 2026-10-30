import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { fetchModUsers, type ModUserRow, type ModUsersFilter } from '../../api';
import { formatDate, formatMoney } from '../../format';
import s from './ModUsersView.module.css';

const FILTERS: { id: ModUsersFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'creators', label: 'Креаторы' },
  { id: 'advertisers', label: 'Заказчики' },
  { id: 'banned', label: 'Заблокированные' },
];

/** Что человек делал: креатор — ролики и баланс, заказчик — заказы. */
function activity(u: ModUserRow) {
  const parts: string[] = [];
  if (u.creator)
    parts.push(
      `креатор · одобрено ${u.creator.approved} · к выводу ${formatMoney(u.creator.available)}`,
    );
  if (u.advertiser)
    parts.push(
      `заказчик · заказов ${u.advertiser.orders}, открыто ${u.advertiser.open}`,
    );
  return parts.length ? parts.join(' · ') : 'ничего не делал';
}

/** Вкладка «Люди»: все пользователи, кроме модераторов, — поиск, фильтр и переход в профиль с баном. */
export default function ModUsersView() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ModUsersFilter>('all');
  const [users, setUsers] = useState<ModUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  /** Последняя загруженная страница; -1 — ещё ни одной. */
  const page = useRef(-1);
  const lastRequest = useRef(0);

  async function loadMore(reset = false) {
    // сменили поиск или фильтр, пока грузилась страница, — старый ответ не подмешиваем
    const requestId = ++lastRequest.current;
    if (reset) {
      page.current = -1;
      setUsers([]);
      setError('');
    }
    setLoading(true);
    try {
      const res = await fetchModUsers(search, filter, page.current + 1);
      if (requestId !== lastRequest.current) return;
      setUsers((list) => [...list, ...res.items]);
      setTotal(res.total);
      page.current += 1;
    } catch {
      if (requestId === lastRequest.current)
        setError('Не удалось загрузить пользователей');
    } finally {
      if (requestId === lastRequest.current) setLoading(false);
    }
  }

  // поиск — по мере ввода, но не на каждую букву: запрос через 300 мс после паузы
  useEffect(() => {
    const timer = setTimeout(() => void loadMore(true), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search, filter]); // грузим заново при смене поиска или фильтра

  return (
    <main className={s.page}>
      <h1>Люди</h1>
      <label className="visually-hidden" htmlFor="user-search">
        Поиск по @username, имени или Telegram ID
      </label>
      <input
        id="user-search"
        className={s.search}
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="@username, имя или Telegram ID"
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

      {error ? (
        <p className={s.hint}>{error}</p>
      ) : (
        !loading &&
        users.length === 0 && (
          <p className={s.hint}>
            {search ? 'Никого не нашли.' : 'Пользователей нет.'}
          </p>
        )
      )}

      {users.length > 0 && (
        <div className={s.list}>
          {users.map((u) => (
            <Link key={u.id} to={`/mod/creators/${u.id}`} className={s.row}>
              <span className={s.main}>
                <span className={s.title}>{u.label}</span>
                <span className={s.sub}>{activity(u)}</span>
                <span className={s.sub}>
                  с {formatDate(u.createdAt)} · TG {u.telegramId}
                  {u.banned?.reason && ` · ${u.banned.reason}`}
                </span>
              </span>
              {u.banned && (
                <span className={`${s.badge} ${s.danger}`}>
                  {u.banned.final ? 'Бан без обжалования' : 'Бан'}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}

      {users.length < total && (
        <button
          type="button"
          className={s.more}
          disabled={loading}
          onClick={() => void loadMore()}
        >
          {loading ? 'Загрузка…' : 'Показать ещё'}
        </button>
      )}
    </main>
  );
}
