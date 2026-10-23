import { useEffect, useRef, useState } from 'react';
import {
  categoryLabel,
  fetchWhatWorks,
  type OrderCategory,
  type Platform,
  PLATFORM_NAMES,
  type WhatWorks,
  type WhatWorksRow,
  type WhatWorksSlice,
} from '../../api';
import s from './ModWhatWorksView.module.css';

const PERIODS: { days: number | undefined; label: string }[] = [
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: undefined, label: 'Всё время' },
];

const SLICES: { key: WhatWorksSlice; label: string }[] = [
  { key: 'category', label: 'Категория' },
  { key: 'platform', label: 'Площадка' },
  { key: 'orientation', label: 'Ориентация' },
  { key: 'duration', label: 'Длительность' },
  { key: 'cpm', label: 'Ставка' },
];

const DURATION: Record<string, string> = {
  '15': 'до 15 с',
  '30': 'до 30 с',
  '60': 'до 60 с',
  LONG: 'больше 60 с',
};
const ORIENTATION: Record<string, string> = {
  VERTICAL: 'Вертикальная',
  HORIZONTAL: 'Горизонтальная',
};

function label(slice: WhatWorksSlice, key: string) {
  if (key === 'ANY') return 'Любая';
  if (slice === 'category') return categoryLabel(key as OrderCategory);
  if (slice === 'platform') return PLATFORM_NAMES[key as Platform] ?? key;
  if (slice === 'orientation') return ORIENTATION[key] ?? key;
  if (slice === 'duration') return DURATION[key] ?? key;
  return `$${key} за 1000`;
}

const percent = (n: number | null) => (n === null ? '—' : `${n}%`);
const views = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('ru-RU');

const METRICS: {
  key: 'avgViews' | 'takeRate' | 'approveRate';
  title: string;
  show: (n: number | null) => string;
}[] = [
  { key: 'avgViews', title: 'Больше всего просмотров', show: views },
  { key: 'takeRate', title: 'Охотнее всего берут', show: percent },
  { key: 'approveRate', title: 'Чаще всего одобряют', show: percent },
];

const ACTIVITIES: {
  key: WhatWorks['audience'][number]['activity'];
  label: string;
}[] = [
  { key: 'both', label: 'Заказы и ролики' },
  { key: 'orders', label: 'Размещали заказы' },
  { key: 'videos', label: 'Сдавали ролики' },
  { key: 'none', label: 'Только смотрели' },
];
const CABINETS = ['CREATOR', 'ADVERTISER', null] as const;

export default function ModWhatWorksView() {
  const [period, setPeriod] = useState<number | undefined>(30);
  const [data, setData] = useState<WhatWorks>();
  const [error, setError] = useState('');
  const [slice, setSlice] = useState<WhatWorksSlice>('category');
  const lastRequest = useRef(0);

  // Быстро переключили период — применяем только ответ на последний запрос.
  useEffect(() => {
    const requestId = ++lastRequest.current;
    setError('');
    fetchWhatWorks(period).then(
      (w) => requestId === lastRequest.current && setData(w),
      () =>
        requestId === lastRequest.current &&
        setError('Не удалось загрузить данные'),
    );
  }, [period]);

  const periods = (
    <div className={s.segmented} role="tablist" aria-label="Период">
      {PERIODS.map((p) => (
        <button
          key={p.label}
          type="button"
          role="tab"
          aria-selected={period === p.days}
          onClick={() => setPeriod(p.days)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );

  if (error || !data)
    return (
      <main className={s.page}>
        <h1>Что работает</h1>
        {periods}
        <p className={s.hint}>{error || 'Загрузка…'}</p>
      </main>
    );

  const enough = (r: WhatWorksRow) => r.orders >= data.minOrders;
  /** Лучшее значение каждой метрики среди всех срезов, где хватает заказов. */
  const rows = SLICES.flatMap((sl) =>
    data.slices[sl.key]
      .filter((r) => enough(r) && r.key !== 'ANY')
      .map((r) => ({ slice: sl, row: r })),
  );
  const highlights = METRICS.flatMap((m) => {
    const best = rows
      .filter((x) => x.row[m.key] !== null)
      .sort((a, b) => (b.row[m.key] ?? 0) - (a.row[m.key] ?? 0))[0];
    return best
      ? [
          {
            title: m.title,
            value: m.show(best.row[m.key]),
            what: `${best.slice.label} · ${label(best.slice.key, best.row.key)}`,
          },
        ]
      : [];
  });
  const audienceCount = (
    activity: string,
    cabinet: (typeof CABINETS)[number],
  ) =>
    data.audience.find((a) => a.activity === activity && a.cabinet === cabinet)
      ?.count ?? 0;
  const flushTitle = `section-title ${s.flush}`;

  return (
    <main className={s.page}>
      <h1>Что работает</h1>
      {periods}

      {highlights.length ? (
        <>
          <h2 className={flushTitle}>Главное</h2>
          <div className={s.tiles}>
            {highlights.map((h) => (
              <div key={h.title} className={s.tile}>
                <span>{h.title}</span>
                <strong>{h.value}</strong>
                <span>{h.what}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className={`${s.hint} ${s.small}`}>
          Пока ни в одном срезе нет {data.minOrders} опубликованных заказов —
          выводы делать рано.
        </p>
      )}

      <h2 className={flushTitle}>Заказы по требованиям</h2>
      <div className={s.chips} role="radiogroup" aria-label="Срез">
        {SLICES.map((sl) => (
          <button
            key={sl.key}
            type="button"
            role="radio"
            aria-checked={slice === sl.key}
            onClick={() => setSlice(sl.key)}
          >
            {sl.label}
          </button>
        ))}
      </div>
      {!data.slices[slice].length ? (
        <p className={s.hint}>Опубликованных заказов за период нет.</p>
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              <th></th>
              <th>Заказов</th>
              <th>Берут</th>
              <th>Просмотры</th>
              <th>Одобряют</th>
            </tr>
          </thead>
          <tbody>
            {data.slices[slice].map((r) => (
              <tr key={r.key} className={enough(r) ? undefined : s.dim}>
                <th scope="row">
                  {label(slice, r.key)}
                  {!enough(r) && <small>мало данных</small>}
                </th>
                <td>{r.orders}</td>
                <td>{percent(r.takeRate)}</td>
                <td>{views(r.avgViews)}</td>
                <td>{percent(r.approveRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className={`${s.hint} ${s.small}`}>
        Берут — креаторов взяли заказ из открывших карточку. Просмотры — в
        среднем у одобренного ролика. Одобряют — из проверенных роликов.
        Длительность — по требованию заказа, а не по ролику. Заказ с несколькими
        площадками считается в каждой.
      </p>

      <h2 className={flushTitle}>Аудитория · новые за период</h2>
      <table className={s.table}>
        <thead>
          <tr>
            <th></th>
            <th>Креатор</th>
            <th>Заказчик</th>
            <th>Не выбрал</th>
          </tr>
        </thead>
        <tbody>
          {ACTIVITIES.map((a) => (
            <tr key={a.key}>
              <th scope="row">{a.label}</th>
              {CABINETS.map((c) => (
                <td key={String(c)}>{audienceCount(a.key, c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`${s.hint} ${s.small}`}>
        Столбец — кабинет, открытый последним; строка — что человек делал на
        самом деле.
      </p>
    </main>
  );
}
