import { useState } from 'react';
import {
  categoryLabel,
  fetchWhatWorks,
  type OrderCategory,
  type Platform,
  PLATFORM_NAMES,
  type WhatWorks as WhatWorksData,
  type WhatWorksRow,
  type WhatWorksSlice,
} from '../api';
import s from '../ui.module.css';
import { Period } from './Period';
import { useLatest } from './useLatest';

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
  key: WhatWorksData['audience'][number]['activity'];
  label: string;
}[] = [
  { key: 'both', label: 'Заказы и ролики' },
  { key: 'orders', label: 'Размещали заказы' },
  { key: 'videos', label: 'Сдавали ролики' },
  { key: 'none', label: 'Только смотрели' },
];
const CABINETS = ['CREATOR', 'ADVERTISER', null] as const;
/** Заголовки колонок аудитории — в том же порядке, что CABINETS; на телефоне — подписи в карточках. */
const AUDIENCE_HEADS = ['Креатор', 'Заказчик', 'Не выбрал'];

/** «Что работает» — как в мини-аппе (webapp/src/views/mod/ModWhatWorksView.tsx). */
export function WhatWorks() {
  const [period, setPeriod] = useState<number | undefined>(30);
  const [slice, setSlice] = useState<WhatWorksSlice>('category');
  const { data, error } = useLatest(fetchWhatWorks, period);

  if (error || !data)
    return (
      <div className={s.page}>
        <h1>Что работает</h1>
        <Period value={period} onChange={setPeriod} />
        <p className={s.hint}>
          {error ? 'Не удалось загрузить данные' : 'Загрузка…'}
        </p>
      </div>
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

  return (
    <div className={s.page}>
      <h1>Что работает</h1>
      <Period value={period} onChange={setPeriod} />

      {highlights.length ? (
        <>
          <h2>Главное</h2>
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

      <h2>Заказы по требованиям</h2>
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
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th></th>
                <th className={s.num}>Заказов</th>
                <th className={s.num}>Берут</th>
                <th className={s.num}>Просмотры</th>
                <th className={s.num}>Одобряют</th>
              </tr>
            </thead>
            <tbody>
              {data.slices[slice].map((r) => (
                <tr key={r.key} className={enough(r) ? undefined : s.dim}>
                  <th scope="row">
                    {label(slice, r.key)}
                    {!enough(r) && <small>мало данных</small>}
                  </th>
                  <td className={s.num} data-label="Заказов">
                    {r.orders}
                  </td>
                  <td className={s.num} data-label="Берут">
                    {percent(r.takeRate)}
                  </td>
                  <td className={s.num} data-label="Просмотры">
                    {views(r.avgViews)}
                  </td>
                  <td className={s.num} data-label="Одобряют">
                    {percent(r.approveRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={`${s.hint} ${s.small}`}>
        Берут — креаторов взяли заказ из открывших карточку. Просмотры — в
        среднем у одобренного ролика. Одобряют — из проверенных роликов.
        Длительность — по требованию заказа, а не по ролику. Заказ с несколькими
        площадками считается в каждой.
      </p>

      <h2>Аудитория · новые за период</h2>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th></th>
              {AUDIENCE_HEADS.map((h) => (
                <th key={h} className={s.num}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ACTIVITIES.map((a) => (
              <tr key={a.key}>
                <th scope="row">{a.label}</th>
                {CABINETS.map((c, i) => (
                  <td
                    key={String(c)}
                    className={s.num}
                    data-label={AUDIENCE_HEADS[i]}
                  >
                    {audienceCount(a.key, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`${s.hint} ${s.small}`}>
        Столбец — кабинет, открытый последним; строка — что человек делал на
        самом деле.
      </p>
    </div>
  );
}
