import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import {
  categoryLabel,
  createOrder,
  errorText,
  fetchMyOrders,
  fetchPriceHint,
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
import { OrderCard } from '../components/OrderCard';
import { PlatformIcon } from '../components/PlatformIcon';
import { approxRub, formatMoney, formatViews } from '../format';
import { locale } from '../i18n';
import s from '../ui.module.css';

// Лимиты — те же, что проверяет бэкенд (src/common/validation.ts); здесь только подсказка браузеру.
const MAX_TITLE = 100;
const MAX_DESCRIPTION = 1000;
const MIN_BUDGET = 10;
const MAX_BUDGET = 100_000;
const MAX_DURATION = 600;
const MIN_EXAMPLES = 3;
const MAX_EXAMPLES = 10;
const ORIENTATIONS: { value: NewOrderInput['orientation']; label: string }[] = [
  { value: 'VERTICAL', label: 'createOrder.vertical' },
  { value: 'HORIZONTAL', label: 'createOrder.horizontal' },
  { value: null, label: 'createOrder.anyOrientation' },
];

/** Что стоит в форме нового заказа, пока заказчик не поменял: любое видео 15–60 сек, порог 250, без срока. */
const DEFAULTS = {
  minViews: '250',
  minDurationSec: '15',
  maxDurationSec: '60',
  orientation: null,
  deadlineDays: null,
} as const;

/** undefined — «не менять» (только при правке), null — без срока. */
const DEADLINES: (number | null | undefined)[] = [3, 7, 14, 30, null];

/**
 * Поля формы — как в мини-аппе (webapp/src/views/CreateOrderView.tsx). Числа — строками из полей
 * ('' — пусто); «Любое» — null, «Любая площадка» — [], категория undefined — ещё не выбрали,
 * срок при правке undefined — «как было».
 */
type Form = {
  title: string;
  description: string;
  exampleUrls: string[];
  referenceUrl: string;
  targetUrl: string;
  linkInBio: boolean;
  budget: string;
  minViews: string;
  minDurationSec: string;
  maxDurationSec: string;
  orientation: NewOrderInput['orientation'];
  platforms: VideoPlatform[];
  category: NewOrderInput['category'] | undefined;
  deadlineDays: number | null | undefined;
};

/** Новый заказ (/my-orders/new, ?from=<id> — по образцу) и правка своего (/my-orders/:id/edit). */
export function OrderForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
    exampleUrls: Array<string>(MIN_EXAMPLES).fill(''),
    referenceUrl: '',
    targetUrl: '',
    linkInBio: false,
    budget: '',
    ...DEFAULTS,
    // при правке срок по умолчанию — «как было», а не «без срока»
    deadlineDays: id === undefined ? DEFAULTS.deadlineDays : undefined,
    platforms: [],
    category: undefined,
  });
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const bind =
    (key: keyof Form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set({ [key]: e.target.value });

  /** Редактируемый заказ — для подсказки, что открытый уйдёт на повторную проверку. */
  const [editing, setEditing] = useState<MyOrder>();
  const deadlines = id ? [undefined, ...DEADLINES] : DEADLINES;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  /** Правка или «по образцу» — подставляем данные заказа в форму. */
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
          // у старых заказов примеров нет — пустые поля до минимума
          exampleUrls: [
            ...source.exampleUrls,
            ...Array<string>(
              Math.max(0, MIN_EXAMPLES - source.exampleUrls.length),
            ).fill(''),
          ],
          referenceUrl: source.referenceUrl ?? '',
          targetUrl: source.targetUrl ?? '',
          linkInBio: source.linkInBio,
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

  const examplesFilled = form.exampleUrls.filter((u) => u.trim()).length;
  // без ссылки на товар ставить в шапку нечего — галочка выключена (и не уйдёт на бэкенд)
  const hasTarget = form.targetUrl.trim() !== '';

  // Подсказка цены по категории — ориентир, на сколько просмотров хватит бюджета
  const [pricePer1000, setPricePer1000] = useState<number | null>(null);
  useEffect(() => {
    setPricePer1000(null);
    if (form.category)
      void fetchPriceHint(form.category)
        .then((r) => setPricePer1000(r.per1000))
        .catch(() => {}); // нет подсказки — форма та же
  }, [form.category]);

  function togglePlatform(p: VideoPlatform) {
    const list = form.platforms;
    set({
      platforms: list.includes(p) ? list.filter((x) => x !== p) : [...list, p],
    });
  }

  /** Требования не трогали — подпись «по умолчанию» и список в проверке перед отправкой. */
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
  // (required, min, max, type="url"), текст — validationMessage браузера.
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
  const [previewing, setPreviewing] = useState(false);
  const previewOrder: OrderSummary = {
    id: 0,
    title: form.title,
    description: form.description,
    referenceUrl: form.referenceUrl || null,
    linkInBio: form.linkInBio && hasTarget,
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
        exampleUrls: form.exampleUrls.map((u) => u.trim()).filter(Boolean),
        referenceUrl: form.referenceUrl.trim() || null,
        targetUrl: form.targetUrl.trim() || null,
        linkInBio: form.linkInBio && hasTarget,
        budget: Number(form.budget),
        minViews: Number(form.minViews),
        minDurationSec: Number(form.minDurationSec),
        maxDurationSec: Number(form.maxDurationSec),
      };
      if (id) await updateOrder(Number(id), input);
      else
        await createOrder({
          ...input,
          deadlineDays: form.deadlineDays ?? null,
        });
      await navigate('/my-orders', { replace: true });
    } catch (err) {
      // тексты ошибок проверки пишет бэкенд
      setError(errorText(err, t('createOrder.sendError')));
    } finally {
      setSending(false);
    }
  }

  const byDefault = (
    <small className={s.muted}> · {t('createOrder.byDefault')}</small>
  );
  const optional = (
    <small className={s.muted}> · {t('createOrder.optional')}</small>
  );
  const fieldError = (msg: string | undefined, elId?: string) =>
    msg && (
      <p id={elId} className={s.error} role="alert">
        {msg}
      </p>
    );
  const budget = Number(form.budget);

  return (
    <div className={s.page}>
      <header>
        <h1>
          {previewing
            ? t('createOrder.preview.title')
            : id
              ? t('createOrder.titleEdit')
              : t('createOrder.titleNew')}
        </h1>
        <p className={s.hint}>
          {previewing
            ? t('createOrder.preview.subtitle')
            : !id && t('createOrder.defaultsNote')}
        </p>
      </header>

      <div className={s.review}>
        <div className={s.page}>
          {/* В проверке форма скрыта, но её поля и правила на месте — отправляет она же. */}
          <form
            id="order-form"
            ref={formEl}
            className={s.page}
            style={previewing ? { display: 'none' } : undefined}
            noValidate
            onSubmit={submit}
          >
            <section className={s.card}>
              <h2>{t('createOrder.blockTask')}</h2>
              <label className={s.field}>
                <span className={s.cardHead}>
                  {t('createOrder.name')}
                  <small className={s.muted}>
                    {form.title.length} / {MAX_TITLE}
                  </small>
                </span>
                <input
                  id="title"
                  value={form.title}
                  onChange={bind('title')}
                  maxLength={MAX_TITLE}
                  required
                  placeholder={t('createOrder.namePlaceholder')}
                />
              </label>
              {fieldError(fieldErrors.title)}

              <label className={s.field}>
                {t('createOrder.task')}
                <textarea
                  id="description"
                  value={form.description}
                  onChange={bind('description')}
                  rows={6}
                  maxLength={MAX_DESCRIPTION}
                  required
                  placeholder={t('createOrder.briefPlaceholder')}
                />
              </label>
              {fieldError(fieldErrors.description)}

              <fieldset className={s.fieldset}>
                <legend className={s.cardHead}>
                  {t('createOrder.examples')}
                  <small className={s.muted}>
                    {t('createOrder.examplesCount', {
                      count: examplesFilled,
                      min: MIN_EXAMPLES,
                    })}
                  </small>
                </legend>
                <span className={`${s.hint} ${s.small}`}>
                  {t('createOrder.examplesHint', { min: MIN_EXAMPLES })}
                </span>
                {form.exampleUrls.map((url, i) => (
                  <div key={i} className={s.inputRow}>
                    <input
                      id={`example-${i}`}
                      value={url}
                      onChange={(e) =>
                        set({
                          exampleUrls: form.exampleUrls.map((u, j) =>
                            j === i ? e.target.value : u,
                          ),
                        })
                      }
                      type="url"
                      maxLength={500}
                      // первые MIN_EXAMPLES — обязательны: та же проверка браузера, что у остальных полей
                      required={i < MIN_EXAMPLES}
                      aria-label={t('createOrder.exampleN', { n: i + 1 })}
                      placeholder={t('createOrder.examplePlaceholder', {
                        n: i + 1,
                      })}
                    />
                    {form.exampleUrls.length > MIN_EXAMPLES && (
                      <button
                        type="button"
                        className={s.btn}
                        aria-label={t('createOrder.removeExample', {
                          n: i + 1,
                        })}
                        onClick={() =>
                          set({
                            exampleUrls: form.exampleUrls.filter(
                              (_, j) => j !== i,
                            ),
                          })
                        }
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {fieldError(
                  form.exampleUrls
                    .map((_, i) => fieldErrors[`example-${i}`])
                    .find(Boolean),
                )}
                {form.exampleUrls.length < MAX_EXAMPLES && (
                  <button
                    type="button"
                    className={s.linkButton}
                    onClick={() =>
                      set({ exampleUrls: [...form.exampleUrls, ''] })
                    }
                  >
                    {t('createOrder.addExample')}
                  </button>
                )}
              </fieldset>

              <label className={s.field}>
                <span>
                  {t('createOrder.reference')}
                  {optional}
                </span>
                <input
                  id="reference"
                  value={form.referenceUrl}
                  onChange={bind('referenceUrl')}
                  type="url"
                  maxLength={500}
                  placeholder={t('createOrder.referencePlaceholder')}
                />
              </label>
              {fieldError(fieldErrors.reference)}

              <label className={s.field}>
                <span>
                  {t('createOrder.target')}
                  {optional}
                </span>
                <input
                  id="target"
                  value={form.targetUrl}
                  onChange={bind('targetUrl')}
                  type="url"
                  maxLength={500}
                  placeholder={t('createOrder.targetPlaceholder')}
                />
              </label>
              {fieldError(fieldErrors.target)}
              <span className={`${s.hint} ${s.small}`}>
                {t('createOrder.targetHint')}
              </span>
              <label className={s.check}>
                <input
                  type="checkbox"
                  checked={form.linkInBio && hasTarget}
                  disabled={!hasTarget}
                  onChange={(e) => set({ linkInBio: e.target.checked })}
                />
                <span>
                  {t('createOrder.linkInBio')}
                  <small className={`${s.hint} ${s.block}`}>
                    {hasTarget
                      ? t('createOrder.linkInBioHint')
                      : t('createOrder.linkInBioNeedsTarget')}
                  </small>
                </span>
              </label>
            </section>

            <section className={s.card}>
              <h2>{t('createOrder.requirements')}</h2>
              <div className={s.field}>
                <span id="orientation-label">
                  {t('createOrder.orientation')}
                  {isDefault.orientation && byDefault}
                </span>
                <div
                  className={s.chips}
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
              <div className={s.inputRow}>
                <label className={s.field}>
                  <span>
                    {t('createOrder.durationFrom')}
                    {isDefault.duration && byDefault}
                  </span>
                  <input
                    id="minDuration"
                    value={form.minDurationSec}
                    onChange={bind('minDurationSec')}
                    type="number"
                    min="1"
                    max={MAX_DURATION}
                    step="1"
                    required
                    placeholder="15"
                  />
                </label>
                <label className={s.field}>
                  {t('createOrder.durationTo')}
                  <input
                    id="maxDuration"
                    value={form.maxDurationSec}
                    onChange={bind('maxDurationSec')}
                    type="number"
                    min="1"
                    max={MAX_DURATION}
                    step="1"
                    required
                    placeholder="60"
                  />
                </label>
              </div>
              {fieldError(fieldErrors.minDuration || fieldErrors.maxDuration)}

              <fieldset className={s.fieldset}>
                <legend>
                  {t('createOrder.platforms')}
                  {isDefault.platforms && byDefault}
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
                      aria-pressed={form.platforms.includes(p)}
                      onClick={() => togglePlatform(p)}
                    >
                      <PlatformIcon
                        platform={p}
                        size={22}
                        round
                        inverse={form.platforms.includes(p)}
                      />
                      {PLATFORM_NAMES[p]}
                    </button>
                  ))}
                </div>
                <span className={`${s.hint} ${s.small}`}>
                  {t('createOrder.platformsHint')}
                </span>
              </fieldset>

              <fieldset
                id="category"
                className={s.fieldset}
                aria-describedby={categoryError ? 'category-error' : undefined}
              >
                <legend>{t('createOrder.category')}</legend>
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
            </section>

            <section className={s.card}>
              <h2>{t('createOrder.blockBudget')}</h2>
              <div className={s.inputRow}>
                <label className={s.field}>
                  {t('createOrder.budget')}
                  <input
                    id="budget"
                    value={form.budget}
                    onChange={bind('budget')}
                    type="number"
                    min={MIN_BUDGET}
                    max={MAX_BUDGET}
                    step="1"
                    required
                    placeholder={t('createOrder.budgetPlaceholder', {
                      min: MIN_BUDGET.toLocaleString(locale()),
                    })}
                  />
                </label>
                <label className={s.field}>
                  <span>
                    {t('createOrder.minViews')}
                    {isDefault.minViews && byDefault}
                  </span>
                  <input
                    id="minViews"
                    value={form.minViews}
                    onChange={bind('minViews')}
                    type="number"
                    min="1"
                    step="1"
                    required
                    placeholder="250"
                  />
                </label>
              </div>
              {fieldError(fieldErrors.budget || fieldErrors.minViews)}
              <div className={s.field}>
                <span id="deadline-label">
                  {t('createOrder.deadline')}
                  {isDefault.deadline && byDefault}
                </span>
                <div
                  className={s.chips}
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
                      {d === undefined
                        ? t('createOrder.keepDeadline')
                        : d === null
                          ? t('createOrder.noDeadline')
                          : t('createOrder.days', { count: d })}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </form>

          {previewing && (
            <>
              <h2>{t('createOrder.preview.card')}</h2>
              <OrderCard order={previewOrder} preview />
              {defaultsLabels.length > 0 && (
                <section className={s.card}>
                  <h2>{t('createOrder.preview.defaults')}</h2>
                  <ul>
                    {defaultsLabels.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        <aside className={`${s.card} ${s.decision}`}>
          <div className={s.row}>
            <span>{t('createOrder.preview.budget')}</span>
            <span>{budget > 0 ? formatMoney(budget) : '—'}</span>
          </div>
          {pricePer1000 !== null && form.category && (
            <p className={`${s.hint} ${s.small}`}>
              {budget > 0
                ? t('createOrder.priceHintViews', {
                    category: categoryLabel(form.category),
                    price: formatMoney(pricePer1000),
                    views: formatViews(
                      Math.floor((budget / pricePer1000) * 10) * 100,
                    ),
                  })
                : t('createOrder.priceHint', {
                    category: categoryLabel(form.category),
                    price: formatMoney(pricePer1000),
                  })}
            </p>
          )}
          {rubPerUsdt && budget > 0 && (
            <p className={`${s.hint} ${s.small}`}>
              {t('createOrder.rate', {
                rub: approxRub(budget, rubPerUsdt),
                rate: rubPerUsdt.toLocaleString(locale()),
              })}
            </p>
          )}
          <p className={`${s.hint} ${s.small}`}>
            {previewing
              ? t('createOrder.preview.moneyNote')
              : t('createOrder.howPay')}
          </p>
          <p className={`${s.hint} ${s.small}`}>
            {editing?.status === 'OPEN'
              ? t('createOrder.editNote')
              : t('createOrder.newNote')}
          </p>
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          <div className={s.buttons}>
            <button
              type="submit"
              form="order-form"
              className={`${s.btn} ${s.primary}`}
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
            {previewing && (
              <button
                type="button"
                className={s.btn}
                onClick={() => setPreviewing(false)}
              >
                {t('createOrder.preview.edit')}
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
