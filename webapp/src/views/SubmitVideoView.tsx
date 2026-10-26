import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import {
  ApiError,
  fetchMySubmissions,
  type MySubmission,
  PLATFORM_NAMES,
  submitVideo,
} from '../api';
import LoadState from '../components/LoadState';
import PlatformIcon from '../components/PlatformIcon';
import {
  describeVideoUrl,
  formatCpm,
  formatDeadline,
  formatMoney,
  formatViews,
  videoFormatParts,
} from '../format';
import { tList } from '../i18n';
import s from './SubmitVideoView.module.css';

export default function SubmitVideoView() {
  const { t } = useTranslation();
  // id отклика — из адреса /submissions/:id/video
  const id = Number(useParams().id);

  const [submission, setSubmission] = useState<MySubmission>();
  const [loadError, setLoadError] = useState('');
  /** Ролик уже сдан или отклик не найден — повторять загрузку незачем. */
  const [alreadySent, setAlreadySent] = useState(false);
  const [url, setUrl] = useState('');
  // строка из поля: '' — пусто
  const [views, setViews] = useState('');
  const [checked, setChecked] = useState(new Set<string>());
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sent, setSent] = useState(false);
  /** Просмотры вышли за рамки бюджета (409 OVER_BUDGET): сколько оплатим, если креатор согласится. */
  const [over, setOver] = useState<{ payout: number; paidViews: number }>();
  const urlInput = useRef<HTMLInputElement>(null);
  /** «Изменить» сбросил ссылку — после перерисовки ставим курсор в поле. */
  const [focusUrl, setFocusUrl] = useState(false);
  useEffect(() => {
    if (focusUrl) urlInput.current?.focus();
    setFocusUrl(false);
  }, [focusUrl]);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const found = (await fetchMySubmissions()).find((sub) => sub.id === id);
      if (found?.status === 'IN_PROGRESS') setSubmission(found);
      else setAlreadySent(true);
    } catch {
      setLoadError(t('submit.loadError'));
    }
  }, [id, t]);
  useEffect(() => void load(), [load]);

  const order = submission?.order;
  const viewsNum = Number(views);
  /** Сколько примерно начислят за указанные просмотры — если ставка уже есть. */
  const estimate =
    order?.cpm && viewsNum
      ? formatMoney(Math.floor((viewsNum * order.cpm) / 10) / 100)
      : '';
  /** Резерв при сдаче — оплата за порог просмотров заказа (не за заявленные). */
  const reserve = order?.cpm
    ? formatMoney(Math.floor((order.minViews * order.cpm) / 10) / 100)
    : '';

  /**
   * Самопроверка перед сдачей: требования этого заказа (площадки, ориентация, длительность) и общие
   * пункты. Пока не отмечено всё — отправить нельзя: ролики не по требованиям модератор отклоняет.
   */
  const checks = order
    ? [...videoFormatParts(order), ...tList('submit.check')]
    : [];
  const allChecked = checks.every((c) => checked.has(c));
  function toggleCheck(item: string) {
    const next = new Set(checked);
    if (!next.delete(item)) next.add(item);
    setChecked(next);
  }

  /** Распознанная ссылка — вместо длинного адреса показываем карточку ролика. */
  const described = describeVideoUrl(url);
  const video = described && described.platform !== 'OTHER' ? described : null;

  /** «Изменить» в карточке — снова поле ввода, с курсором в нём. */
  function editUrl() {
    setUrl('');
    setFocusUrl(true);
  }

  /** «Вставить ссылку»: из буфера, если Telegram разрешит; нет — курсор в поле, вставят сами. */
  async function pasteUrl() {
    try {
      setUrl((await navigator.clipboard.readText()).trim());
    } catch {
      urlInput.current?.focus();
    }
  }

  /** `accept` — креатор согласился на остаток фонда из окна «за рамками бюджета». */
  async function send(accept?: number) {
    // Enter в поле отправляет форму в обход кнопки — та же проверка и здесь
    if (!allChecked) return;
    setSending(true);
    setSendError('');
    try {
      await submitVideo(id, url, viewsNum, accept);
      setSent(true);
    } catch (err) {
      // Не влезли в остаток (или он успел уменьшиться) — спрашиваем согласие на новую сумму.
      if (err instanceof ApiError && err.data?.code === 'OVER_BUDGET') {
        setOver({
          payout: Number(err.data.payout),
          paidViews: Number(err.data.paidViews),
        });
        return;
      }
      setOver(undefined);
      // Проверку ссылки делает бэкенд — те же правила и тексты ошибок, что в боте.
      setSendError(
        err instanceof ApiError ? err.userMessage : t('submit.sendError'),
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <main className={s.page}>
      <h1>{t('submit.title')}</h1>

      {alreadySent ? (
        <p className={s.hint}>
          {t('submit.alreadySent')}{' '}
          <Link to="/submissions">{t('submit.toSubmissions')}</Link>
        </p>
      ) : loadError || !submission || !order ? (
        <LoadState error={loadError} onRetry={load} />
      ) : sent ? (
        <>
          <p className={s.notice} role="status">
            {t('submit.sent')}
          </p>
          <div className="bottom-bar">
            <Link to="/submissions" className="main-button">
              {t('submit.toSubmissions')}
            </Link>
          </div>
        </>
      ) : (
        <>
          <div className={s.order}>
            <div className={s.title}>{order.title}</div>
            <div className={s.hint}>
              {formatCpm(order.cpm)}
              {submission.dueAt &&
                t('submit.dueAt', { date: formatDeadline(submission.dueAt) })}
            </div>
          </div>

          {submission.fundPaused && (
            <p className={s.busy} role="status">
              {t('submit.fundBusy')}
            </p>
          )}

          {/* onSubmit — отправка формы без перезагрузки страницы (Enter на клавиатуре тоже работает). */}
          <form
            id="video-form"
            className={s.field}
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label htmlFor="video-url" className="section-title">
              {t('submit.urlLabel')}
            </label>
            {video ? (
              <div className={s.videoCard}>
                <PlatformIcon platform={video.platform} size={48} />
                <span className={s.videoText}>
                  <strong>
                    {t('submit.videoIn', {
                      platform: PLATFORM_NAMES[video.platform],
                    })}
                  </strong>
                  <span>{video.short}</span>
                </span>
                <button type="button" className={s.videoEdit} onClick={editUrl}>
                  {t('submit.edit')}
                </button>
              </div>
            ) : (
              <>
                <input
                  id="video-url"
                  ref={urlInput}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  type="url"
                  inputMode="url"
                  placeholder="https://…"
                  autoComplete="off"
                  required
                />
                {!url && (
                  <button type="button" className={s.paste} onClick={pasteUrl}>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="6" y="4" width="12" height="17" rx="2.5" />
                      <path d="M9 4.5V3h6v1.5" />
                    </svg>
                    {t('submit.paste')}
                  </button>
                )}
              </>
            )}
            <p className={`${s.hint} ${s.help}`}>{t('submit.urlHelp')}</p>
            <label htmlFor="views" className="section-title">
              {t('submit.viewsLabel')}
            </label>
            <input
              id="views"
              value={views}
              onChange={(e) => setViews(e.target.value)}
              type="number"
              inputMode="numeric"
              min={order.minViews}
              step="1"
              placeholder={t('submit.viewsPlaceholder', {
                views: formatViews(order.minViews),
              })}
              required
            />
            <p className={`${s.hint} ${s.help}`}>
              {t('submit.viewsHelp', { views: formatViews(order.minViews) })}
            </p>
            {reserve && (
              <div className={s.reserve}>
                <strong>{t('submit.reserve', { amount: reserve })}</strong>
                <span>
                  {t('submit.reserveNote', {
                    views: formatViews(order.minViews),
                  })}
                  {estimate &&
                    t('submit.reserveEstimate', { amount: estimate })}
                </span>
              </div>
            )}
            {sendError && (
              <p className={s.error} role="alert">
                {sendError}
              </p>
            )}
          </form>

          {over && (
            <section
              className={s.over}
              role="alertdialog"
              aria-labelledby="over-title"
            >
              <h2 id="over-title">
                {t('submit.overTitle', { views: formatViews(viewsNum) })}
              </h2>
              <p>
                {t('submit.overText', {
                  amount: formatMoney(over.payout),
                  paidViews: formatViews(over.paidViews),
                })}
              </p>
              <div className={s.overActions}>
                <button
                  type="button"
                  className="main-button"
                  disabled={sending}
                  onClick={() => void send(over.payout)}
                >
                  {sending
                    ? t('common.sending')
                    : t('submit.overAgree', {
                        amount: formatMoney(over.payout),
                      })}
                </button>
                <button
                  type="button"
                  className={s.overCancel}
                  disabled={sending}
                  onClick={() => setOver(undefined)}
                >
                  {t('submit.overCancel')}
                </button>
              </div>
            </section>
          )}

          <fieldset className={s.checks}>
            <legend className={s.checksHead}>
              <span>{t('submit.checkTitle')}</span>
              <span className={s.hint}>
                {t('submit.checkCount', {
                  done: checked.size,
                  total: checks.length,
                })}
              </span>
            </legend>
            {checks.map((c) => (
              <label key={c} className={s.check}>
                <input
                  type="checkbox"
                  checked={checked.has(c)}
                  onChange={() => toggleCheck(c)}
                />
                <span>{c}</span>
              </label>
            ))}
            {!allChecked && (
              <p className={`${s.hint} ${s.help}`}>{t('submit.checkHint')}</p>
            )}
          </fieldset>

          <div className="bottom-bar">
            <button
              type="submit"
              form="video-form"
              className="main-button"
              disabled={
                sending ||
                !url.trim() ||
                !viewsNum ||
                !allChecked ||
                submission.fundPaused ||
                !!over
              }
            >
              {sending ? t('common.sending') : t('submit.submit')}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
