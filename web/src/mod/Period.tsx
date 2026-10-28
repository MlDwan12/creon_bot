import s from '../ui.module.css';

export const PERIODS: { days: number | undefined; label: string }[] = [
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: undefined, label: 'Всё время' },
];

/** Переключатель периода для статистики, «Что работает» и «Я». */
export function Period({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (days: number | undefined) => void;
}) {
  return (
    <div className={s.chips} role="tablist" aria-label="Период">
      {PERIODS.map((p) => (
        <button
          key={p.label}
          type="button"
          role="tab"
          aria-selected={value === p.days}
          onClick={() => onChange(p.days)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
