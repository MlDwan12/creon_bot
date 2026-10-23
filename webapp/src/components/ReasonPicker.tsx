import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import s from './ReasonPicker.module.css';

/** Причина отказа: готовые варианты и свой текст. value/onChange — текст причины у родителя. */
export default function ReasonPicker({
  value,
  onChange,
  presets,
  title,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  presets: string[];
  title?: string;
  id?: string;
}) {
  const { t } = useTranslation();
  const textarea = useRef<HTMLTextAreaElement>(null);

  /** Готовая причина подставляется в текст — его можно дописать перед отправкой. «Другое» — пишем сами. */
  function pick(preset: string | null) {
    onChange(preset ?? '');
    if (!preset) textarea.current?.focus();
  }

  return (
    <section id={id} className={s.reasons}>
      <h2 className="section-title">{title ?? t('reasonPicker.title')}</h2>
      <div className={s.chips}>
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={value === p}
            onClick={() => pick(p)}
          >
            {p}
          </button>
        ))}
        <button type="button" aria-pressed={false} onClick={() => pick(null)}>
          {t('reasonPicker.other')}
        </button>
      </div>
      <label className="visually-hidden" htmlFor="reason">
        {t('reasonPicker.label')}
      </label>
      <textarea
        id="reason"
        ref={textarea}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder={t('reasonPicker.placeholder')}
      />
    </section>
  );
}
