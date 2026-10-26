import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ApiError,
  categoryLabel,
  createOrder,
  fetchMyOrders,
  fetchRate,
  type MyOrder,
  type NewOrderInput,
  ORDER_CATEGORIES,
  type OrderSummary,
  PLATFORM_NAMES,
  updateOrder,
  VIDEO_PLATFORMS,
  type VideoPlatform,
} from '../api';
import OrderCard from '../components/OrderCard';
import PlatformIcon from '../components/PlatformIcon';
import { approxRub, formatMoney } from '../format';
import { i18next, locale } from '../i18n';
import s from './CreateOrderView.module.css';

// Лимиты — те же, что проверяет бэкенд (src/common/validation.ts); здесь только подсказка браузеру.
const MAX_TITLE = 100;
const MAX_DESCRIPTION = 1000;
const MIN_BUDGET = 10;
const MAX_BUDGET = 100_000;
const MAX_DURATION = 600;
const ORIENTATIONS: { value: NewOrderInput['orientation']; label: string }[] = [
  { value: 'VERTICAL', label: 'createOrder.vertical' },
  { value: 'HORIZONTAL', label: 'createOrder.horizontal' },
  { value: null, label: 'createOrder.anyOrientation' },
];

/** Что стоит в форме нового заказа, пока рекламодатель не поменял: любое видео 15–60 сек, порог 250, без срока. */
const DEFAULTS = {
  minViews: '250',
  minDurationSec: '15',
  maxDurationSec: '60',
  orientation: null,
  deadlineDays: null,
} as const;

/** undefined — «не менять» (только при правке), null — без срока. */
const DEADLINES: (number | null | undefined)[] = [3, 7, 14, 30, null];
/** Подпись варианта срока: «7 дн», «нет», при правке — «как было». */
function deadlineLabel(days: number | null | undefined): string {
  if (days === undefined) return i18next.t('createOrder.keepDeadline');
  if (days === null) return i18next.t('createOrder.noDeadline');
  return i18next.t('createOrder.days', { count: days });
}

/**
 * Поля формы. Числа — строками из полей ('' — пусто). Обязательно всё, кроме ссылки на товар.
 * Требования к ролику и срок заполнены по умолчанию (DEFAULTS) — не трогал, они и уйдут; тексты,
 * категорию и бюджет рекламодатель задаёт сам. «Любое» — null, «Любая площадка» — [], категория
 * undefined — ещё не выбрали. У срока при правке undefined — «как было».
 */
type Form = {
  title: string;
  description: string;
  referenceUrl: string;
  targetUrl: string;
  budget: string;
  minViews: string;
  minDurationSec: string;
  maxDurationSec: string;
  orientation: NewOrderInput['orientation'];
  platforms: VideoPlatform[];
  category: NewOrderInput['category'] | undefined;
  deadlineDays: number | null | undefined;
};

export default function CreateOrderView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // С `id` (/my-orders/:id/edit) — правка своего заказа, без — новый.
  const { id } = useParams();
  const [query] = useSearchParams();

  // курс — только подсказка «≈ … ₽», не загрузился — не показываем
  const [rubPerUsdt, setRubPerUsdt] = useState<number | null>(null);
  useEffect(() => {
    void fetchRate().then(setRubPerUsdt);
  }, []);

  const [form, setForm] = useState<Form>({
    title: '',
    description: '',
    referenceUrl: '',
    targetUrl: '',
    budget: '',
    ...DEFAULTS,
    // при правке срок по умолчанию — «как было», а не «без срока»
    deadlineDays: id === undefined ? DEFAULTS.deadlineDays : undefined,
    platforms: [],
    category: undefined,
  });
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  /** Обработчик поля ввода: имя поля формы → значение. */
  const bind =
    (key: keyof Form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set({ [key]: e.target.value });

  /** Редактируемый заказ — для подсказки, что открытый уйдёт на повторную проверку. */
  const [editing, setEditing] = useState<MyOrder>();
  const deadlines = id ? [undefined, ...DEADLINES] : DEADLINES;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  /**
   * Правка (/my-orders/:id/edit) или «Исправить и отправить снова» (/my-orders/new?from=<id>) —
   * подставляем данные заказа в форму.
   */
  useEffect(() => {
    const fromId = Number(id ?? query.get('from'));
    if (!fromId) return;
    void fetchMyOrders()
      .catch(() => [])
      .then((list) => {
        const source = list.find((o) => o.id === fromId);
        if (!source) return;
        if (id) setEditing(source);
        set({
          title: source.title,
          description: source.description,
          referenceUrl: source.referenceUrl ?? '',
          targetUrl: source.targetUrl ?? '',
          budget: String(source.budget),
          minViews: String(source.minViews),
          minDurationSec: String(source.minDurationSec ?? ''),
          maxDurationSec: String(source.maxDurationSec ?? ''),
          orientation: source.orientation,
          platforms: [...source.platforms],
          category: source.category,
        });
      });
  }, []); // один раз при открытии

  /** Отметить площадку или снять отметку; «Любая» — пустой список. */
  function togglePlatform(p: VideoPlatform) {
    const list = form.platforms;
    set({
      platforms: list.includes(p) ? list.filter((x) => x !== p) : [...list, p],
    });
  }

  /** Требования не трогали — подпись «по умолчанию» у поля (и список в проверке перед отправкой). */
  const isDefault = {
    orientation: form.orientation === DEFAULTS.orientation,
    duration:
      form.minDurationSec === DEFAULTS.minDurationSec &&
      form.maxDurationSec === DEFAULTS.maxDurationSec,
    platforms: form.platforms.length === 0,
    minViews: form.minViews === DEFAULTS.minViews,
    deadline: !id && form.deadlineDays === DEFAULTS.deadlineDays,
  };

  // Ошибки — под полем, а не всплывающей подсказкой браузера: noValidate у формы, правила те же
  // (required, min, max, type="url"), текст — validationMessage браузера на языке телефона.
  const formEl = useRef<HTMLFormElement>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [categoryError, setCategoryError] = useState('');
  function validate(): boolean {
    const invalid = [...formEl.current!.elements]
      .filter(
        (el): el is HTMLInputElement =>
          el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement,
      )
      .filter((el) => !el.checkValidity());
    setFieldErrors(
      Object.fromEntries(invalid.map((el) => [el.id, el.validationMessage])),
    );
    const catError =
      form.category === undefined ? t('errors.chooseCategory') : '';
    setCategoryError(catError);
    const first =
      invalid[0] ?? (catError ? document.getElementById('category') : null);
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (invalid[0]) invalid[0].focus({ preventScroll: true });
    return !invalid.length && !catError;
  }

  // Проверка перед отправкой нового заказа: карточка, как её увидят креаторы, и бюджет.
  // Комиссию площадки пока не показываем — её размер не решён.
  const [previewing, setPreviewing] = useState(false);
  const previewOrder: OrderSummary = {
    id: 0,
    title: form.title,
    description: form.description,
    referenceUrl: form.referenceUrl || null,
    cpm: null,
    minViews: Number(form.minViews),
    // остаток в предпросмотре не показываем (OrderCard preview): по нему видна комиссия
    free: Number(form.budget),
    freeUnder: null,
    budgetLow: false,
    fundBusy: false,
    category: form.category!,
    deadline: null,
    createdAt: new Date().toISOString(),
    minDurationSec: Number(form.minDurationSec) || null,
    maxDurationSec: Number(form.maxDurationSec) || null,
    orientation: form.orientation,
    platforms: form.platforms,
  };
  const defaultsLabels = [
    isDefault.orientation && t('createOrder.preview.anyOrientation'),
    isDefault.duration &&
      t('format.secRange', {
        min: DEFAULTS.minDurationSec,
        max: DEFAULTS.maxDurationSec,
      }),
    isDefault.platforms && t('orderCard.anyPlatform'),
    isDefault.minViews && t('orderCard.minViews', { views: DEFAULTS.minViews }),
    isDefault.deadline && t('createOrder.preview.noDeadline'),
  ].filter((l): l is string => Boolean(l));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!validate()) return;
    const category = form.category!;
    // новый заказ — сначала проверка; правку отправляем сразу
    if (!id && !previewing) {
      setPreviewing(true);
      window.scrollTo({ top: 0 });
      return;
    }
    setSending(true);
    try {
      const input = {
        ...form,
        category,
        referenceUrl: form.referenceUrl.trim() || null,
        targetUrl: form.targetUrl.trim() || null,
        budget: Number(form.budget),
        minViews: Number(form.minViews),
        minDurationSec: Number(form.minDurationSec),
        maxDurationSec: Number(form.maxDurationSec),
      };
      if (id) await updateOrder(Number(id), input);
      // при создании «как было» не бывает — срок по умолчанию null
      else
        await createOrder({
          ...input,
          deadlineDays: form.deadlineDays ?? null,
        });
      await navigate('/my-orders', { replace: true });
    } catch (err) {
      // Тексты ошибок проверки пишет бэкенд.
      setError(
        err instanceof ApiError ? err.userMessage : t('createOrder.sendError'),
      );
    } finally {
      setSending(false);
    }
  }

  const byDefault = (
    <small className={s.default}>{t('createOrder.byDefault')}</small>
  );
  const fieldError = (msg: string | undefined, elId?: string) =>
    msg && (
      <p id={elId} className={s.fieldError} role="alert">
        {msg}
      </p>
    );

  return (
    <main className={s.page}>
      {!previewing && (
        <h1>{id ? t('createOrder.titleEdit') : t('createOrder.titleNew')}</h1>
      )}
      {!previewing && !id && (
        <p className={s.lead}>{t('createOrder.defaultsNote')}</p>
      )}

      {/* В проверке перед отправкой форма скрыта, но её поля и правила на месте — отправляет она же. */}
      <form
        id="order-form"
        ref={formEl}
        className={s.form}
        style={previewing ? { display: 'none' } : undefined}
        noValidate
        onSubmit={submit}
      >
        <h2 className={s.blockTitle}>{t('createOrder.blockTask')}</h2>
        <div className={s.field}>
          <div className={s.labelRow}>
            <label htmlFor="title" className="section-title">
              {t('createOrder.name')}
            </label>
            <span className={s.counter}>
              {form.title.length} / {MAX_TITLE}
            </span>
          </div>
          <input
            id="title"
            value={form.title}
            onChange={bind('title')}
            maxLength={MAX_TITLE}
            required
            placeholder={t('createOrder.namePlaceholder')}
          />
          {fieldError(fieldErrors.title)}
        </div>

        <div className={s.field}>
          <label htmlFor="description" className="section-title">
            {t('createOrder.task')}
          </label>
          <textarea
            id="description"
            value={form.description}
            onChange={bind('description')}
            rows={5}
            maxLength={MAX_DESCRIPTION}
            required
            placeholder={t('createOrder.briefPlaceholder')}
          />
          {fieldError(fieldErrors.description)}
        </div>

        <div className={s.field}>
          <label htmlFor="reference" className="section-title">
            {t('createOrder.reference')}
          </label>
          <input
            id="reference"
            value={form.referenceUrl}
            onChange={bind('referenceUrl')}
            type="url"
            inputMode="url"
            maxLength={500}
            required
            placeholder={t('createOrder.referencePlaceholder')}
          />
          {fieldError(fieldErrors.reference)}
        </div>

        <div className={s.field}>
          <label htmlFor="target" className="section-title">
            {t('createOrder.target')}{' '}
            <small className={s.optional}>{t('createOrder.optional')}</small>
          </label>
          <input
            id="target"
            value={form.targetUrl}
            onChange={bind('targetUrl')}
            type="url"
            inputMode="url"
            maxLength={500}
            placeholder={t('createOrder.targetPlaceholder')}
          />
          {fieldError(fieldErrors.target)}
          <span className={s.hint}>{t('createOrder.targetHint')}</span>
        </div>

        <h2 className={s.blockTitle}>{t('createOrder.requirements')}</h2>
        <div className={s.field}>
          <div className={s.group}>
            <div className={`${s.row} ${s.column}`}>
              <span id="orientation-label">
                {t('createOrder.orientation')}{' '}
                {isDefault.orientation && byDefault}
              </span>
              <div
                className={s.segmented}
                role="radiogroup"
                aria-labelledby="orientation-label"
              >
                {ORIENTATIONS.map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    role="radio"
                    aria-checked={form.orientation === o.value}
                    onClick={() => set({ orientation: o.value })}
                  >
                    {t(o.label)}
                  </button>
                ))}
              </div>
            </div>
            <label className={`${s.row} ${s.bordered}`}>
              <span>
                {t('createOrder.durationFrom')}{' '}
                {isDefault.duration && byDefault}
              </span>
              <input
                id="minDuration"
                value={form.minDurationSec}
                onChange={bind('minDurationSec')}
                type="number"
                inputMode="numeric"
                min="1"
                max={MAX_DURATION}
                step="1"
                required
                placeholder="15"
              />
            </label>
            <label className={`${s.row} ${s.bordered}`}>
              {t('createOrder.durationTo')}
              <input
                id="maxDuration"
                value={form.maxDurationSec}
                onChange={bind('maxDurationSec')}
                type="number"
                inputMode="numeric"
                min="1"
                max={MAX_DURATION}
                step="1"
                required
                placeholder="60"
              />
            </label>
          </div>
          {fieldError(fieldErrors.minDuration || fieldErrors.maxDuration)}
        </div>

        <fieldset className={s.field}>
          <legend className="section-title">
            {t('createOrder.platforms')} {isDefault.platforms && byDefault}
          </legend>
          <div className={s.chips}>
            <button
              type="button"
              aria-pressed={form.platforms.length === 0}
              onClick={() => set({ platforms: [] })}
            >
              {t('createOrder.anyPlatform')}
            </button>
            {VIDEO_PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                className={s.withIcon}
                aria-pressed={form.platforms.includes(p)}
                onClick={() => togglePlatform(p)}
              >
                <PlatformIcon
                  platform={p}
                  size={26}
                  round
                  inverse={form.platforms.includes(p)}
                />
                {PLATFORM_NAMES[p]}
              </button>
            ))}
          </div>
          <span className={s.hint}>{t('createOrder.platformsHint')}</span>
        </fieldset>

        <fieldset
          id="category"
          className={s.field}
          aria-describedby={categoryError ? 'category-error' : undefined}
        >
          <legend className="section-title">{t('createOrder.category')}</legend>
          <div className={s.chips}>
            {ORDER_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={form.category === c}
                onClick={() => set({ category: c })}
              >
                {categoryLabel(c)}
              </button>
            ))}
          </div>
          {fieldError(categoryError, 'category-error')}
        </fieldset>

        <h2 className={s.blockTitle}>{t('createOrder.blockBudget')}</h2>

        <div className={s.group}>
          <label className={s.row}>
            {t('createOrder.budget')}
            <input
              id="budget"
              value={form.budget}
              onChange={bind('budget')}
              type="number"
              inputMode="numeric"
              min={MIN_BUDGET}
              max={MAX_BUDGET}
              step="1"
              required
              placeholder={t('createOrder.budgetPlaceholder', {
                min: MIN_BUDGET.toLocaleString(locale()),
              })}
            />
          </label>
          <label className={`${s.row} ${s.bordered}`}>
            <span>
              {t('createOrder.minViews')} {isDefault.minViews && byDefault}
            </span>
            <input
              id="minViews"
              value={form.minViews}
              onChange={bind('minViews')}
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              required
              placeholder="250"
            />
          </label>
          <div className={`${s.row} ${s.column}`}>
            <span id="deadline-label">
              {t('createOrder.deadline')} {isDefault.deadline && byDefault}
            </span>
            <div
              className={s.segmented}
              role="radiogroup"
              aria-labelledby="deadline-label"
            >
              {deadlines.map((d) => (
                <button
                  key={String(d)}
                  type="button"
                  role="radio"
                  aria-checked={form.deadlineDays === d}
                  onClick={() => set({ deadlineDays: d })}
                >
                  {deadlineLabel(d)}
                </button>
              ))}
            </div>
          </div>
        </div>
        {fieldError(fieldErrors.budget || fieldErrors.minViews)}

        {rubPerUsdt && Number(form.budget) > 0 && (
          <p className={s.hint}>
            {t('createOrder.rate', {
              rub: approxRub(Number(form.budget), rubPerUsdt),
              rate: rubPerUsdt.toLocaleString(locale()),
            })}
          </p>
        )}
        <p className={s.hint}>{t('createOrder.howPay')}</p>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
      </form>

      {previewing && (
        <>
          <header className={s.previewHead}>
            <h1>{t('createOrder.preview.title')}</h1>
            <p className={s.lead}>{t('createOrder.preview.subtitle')}</p>
          </header>
          <h2 className={s.blockTitle}>{t('createOrder.preview.card')}</h2>
          <OrderCard order={previewOrder} preview />

          <h2 className={s.blockTitle}>{t('createOrder.preview.money')}</h2>
          <div className={s.group}>
            <div className={s.row}>
              <span>{t('createOrder.preview.budget')}</span>
              <strong>{formatMoney(Number(form.budget))}</strong>
            </div>
          </div>
          <p className={s.lead}>{t('createOrder.preview.moneyNote')}</p>

          {defaultsLabels.length > 0 && (
            <>
              <h2 className={s.blockTitle}>
                {t('createOrder.preview.defaults')}
              </h2>
              <ul className={s.defaults}>
                {defaultsLabels.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </>
          )}
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
        </>
      )}

      <div className="bottom-bar">
        <p className={s.note}>
          {editing?.status === 'OPEN'
            ? t('createOrder.editNote')
            : t('createOrder.newNote')}
        </p>
        <div className={previewing ? s.two : undefined}>
          {previewing && (
            <button
              type="button"
              className={s.secondaryButton}
              onClick={() => setPreviewing(false)}
            >
              {t('createOrder.preview.edit')}
            </button>
          )}
          <button
            type="submit"
            form="order-form"
            className="main-button"
            disabled={sending}
          >
            {sending
              ? t('common.sending')
              : id
                ? t('createOrder.saveAndSend')
                : previewing
                  ? t('createOrder.send')
                  : t('createOrder.check')}
          </button>
        </div>
      </div>
    </main>
  );
}
