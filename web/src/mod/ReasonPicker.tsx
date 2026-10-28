import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import s from '../ui.module.css';

/** Причина отказа: готовые варианты и свой текст. value/onChange — текст причины у родителя. */
export function ReasonPicker({
  value,
  onChange,
  presets,
}: {
  value: string;
  onChange: (v: string) => void;
  presets: string[];
}) {
  const { t } = useTranslation();
  const textarea = useRef<HTMLTextAreaElement>(null);

  /** Готовая причина подставляется в текст — его можно дописать. «Другое» — пишем сами. */
  function pick(preset: string | null) {
    onChange(preset ?? '');
    if (!preset) textarea.current?.focus();
  }

  return (
    <div className={s.field}>
      <span>{t('reasonPicker.title')}</span>
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
      <textarea
        ref={textarea}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={500}
        aria-label={t('reasonPicker.label')}
        placeholder={t('reasonPicker.placeholder')}
      />
    </div>
  );
}
