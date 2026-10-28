import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import {
  ApiError,
  errorText,
  fetchMySubmissions,
  type MySubmission,
  PLATFORM_NAMES,
  submitVideo,
} from '../api';
import { PlatformIcon } from '../components/PlatformIcon';
import {
  describeVideoUrl,
  formatCpm,
  formatDeadline,
  formatMoney,
  formatViews,
  videoFormatParts,
} from '../format';
import { tList } from '../i18n';
import s from '../ui.module.css';

/**
 * Сдача ролика — как в мини-аппе (webapp/src/views/SubmitVideoView.tsx): слева ссылка и просмотры,
 * справа самопроверка и отправка.
 */
export function SubmitVideo() {
  const { t } = useTranslation();
  const id = Number(useParams().id);
  const [submission, setSubmission] = useState<MySubmission>();
  const [loadError, setLoadError] = useState(false);
  /** Ролик уже сдан или отклик не найден — повторять загрузку незачем. */
  const [alreadySent, setAlreadySent] = useState(false);
  const [url, setUrl] = useState('');
  const [views, setViews] = useState('');
  const [checked, setChecked] = useState(new Set<string>());
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sent, setSent] = useState(false);
  /** Просмотры вышли за рамки бюджета (409 OVER_BUDGET): сколько оплатим, если креатор согласится. */
  const [over, setOver] = useState<{ payout: number; paidViews: number }>();

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const found = (await fetchMySubmissions()).find((sub) => sub.id === id);
      if (found?.status === 'IN_PROGRESS') setSubmission(found);
      else setAlreadySent(true);
    } catch {
      setLoadError(true);
    }
  }, [id]);
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

  // ссылка в шапке профиля — тоже пункт самопроверки: без отметки бэкенд ролик не примет
  const checks = order
    ? [
        ...videoFormatParts(order),
        ...(order.linkInBio ? [t('submit.checkLinkInBio')] : []),
        ...tList('submit.check'),
      ]
    : [];
  const allChecked = checks.every((c) => checked.has(c));
  function toggleCheck(item: string) {
    const next = new Set(checked);
    if (!next.delete(item)) next.add(item);
    setChecked(next);
  }

  /** Распознанная ссылка — подпись площадки под полем. */
  const described = describeVideoUrl(url);
  const video = described && described.platform !== 'OTHER' ? described : null;

  /** `accept` — креатор согласился на остаток фонда из окна «за рамками бюджета». */
  async function send(accept?: number) {
    // Enter в поле отправляет форму в обход кнопки — та же проверка и здесь
    if (!allChecked) return;
    setSending(true);
    setSendError('');
    try {
      await submitVideo(id, url, viewsNum, accept, order?.linkInBio);
      setSent(true);
    } catch (err) {
      // не влезли в остаток (или он успел уменьшиться) — спрашиваем согласие на новую сумму
      if (err instanceof ApiError && err.data?.code === 'OVER_BUDGET') {
        setOver({
          payout: Number(err.data.payout),
          paidViews: Number(err.data.paidViews),
        });
        return;
      }
      setOver(undefined);
      // проверку ссылки делает бэкенд — те же правила и тексты ошибок, что в боте
      setSendError(errorText(err, t('submit.sendError')));
    } finally {
      setSending(false);
    }
  }

  if (alreadySent)
    return (
      <div className={s.page}>
        <h1>{t('submit.title')}</h1>
        <p className={s.hint}>
          {t('submit.alreadySent')}{' '}
          <Link to="/submissions">{t('submit.toSubmissions')}</Link>
        </p>
      </div>
    );
  if (loadError)
    return (
      <div className={s.buttons}>
        <p className={s.hint}>{t('submit.loadError')}</p>
        <button type="button" className={s.btn} onClick={load}>
          {t('common.retry')}
        </button>
      </div>
    );
  if (!submission || !order)
    return <p className={s.hint}>{t('common.loading')}</p>;
  if (sent)
    return (
      <div className={s.page}>
        <h1>{t('submit.title')}</h1>
        <p className={s.notice} role="status">
          {t('submit.sent')}
        </p>
        <Link
          to="/submissions"
          className={`${s.btn} ${s.primary} ${s.linkBtn} ${s.more}`}
        >
          {t('submit.toSubmissions')}
        </Link>
      </div>
    );

  return (
    <div className={s.page}>
      <header>
        <h1>{t('submit.title')}</h1>
        <p className={s.hint}>
          <strong>{order.title}</strong> · {formatCpm(order.cpm)}
          {submission.dueAt &&
            t('submit.dueAt', { date: formatDeadline(submission.dueAt) })}
        </p>
      </header>
      {submission.fundPaused && (
        <p className={s.alert} role="status">
          {t('submit.fundBusy')}
        </p>
      )}

      <div className={s.review}>
        <div className={s.page}>
          <form
            id="video-form"
            className={s.card}
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className={s.field}>
              {t('submit.urlLabel')}
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                type="url"
                placeholder="https://…"
                autoComplete="off"
                required
              />
            </label>
            {video && (
              <p className={s.check}>
                <PlatformIcon platform={video.platform} size={24} round />
                {t('submit.videoIn', {
                  platform: PLATFORM_NAMES[video.platform],
                })}{' '}
                · {video.short}
              </p>
            )}
            <p className={`${s.hint} ${s.small}`}>{t('submit.urlHelp')}</p>
            <label className={s.field}>
              {t('submit.viewsLabel')}
              <input
                value={views}
                onChange={(e) => setViews(e.target.value)}
                type="number"
                min={order.minViews}
                step="1"
                placeholder={t('submit.viewsPlaceholder', {
                  views: formatViews(order.minViews),
                })}
                required
              />
            </label>
            <p className={`${s.hint} ${s.small}`}>
              {t('submit.viewsHelp', { views: formatViews(order.minViews) })}
            </p>
            {reserve && (
              <p className={s.alert}>
                <strong>{t('submit.reserve', { amount: reserve })}</strong>
                {t('submit.reserveNote', {
                  views: formatViews(order.minViews),
                })}
                {estimate && t('submit.reserveEstimate', { amount: estimate })}
              </p>
            )}
          </form>

          {over && (
            <section
              className={s.alert}
              role="alertdialog"
              aria-labelledby="over-title"
            >
              <strong id="over-title">
                {t('submit.overTitle', { views: formatViews(viewsNum) })}
              </strong>
              <p>
                {t('submit.overText', {
                  amount: formatMoney(over.payout),
                  paidViews: formatViews(over.paidViews),
                })}
              </p>
              <div className={s.buttons}>
                <button
                  type="button"
                  className={`${s.btn} ${s.primary}`}
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
                  className={s.btn}
                  disabled={sending}
                  onClick={() => setOver(undefined)}
                >
                  {t('submit.overCancel')}
                </button>
              </div>
            </section>
          )}
        </div>

        <aside className={`${s.card} ${s.decision}`}>
          <fieldset className={s.fieldset}>
            <legend className={s.cardHead}>
              {t('submit.checkTitle')}
              <small className={s.muted}>
                {t('submit.checkCount', {
                  done: checked.size,
                  total: checks.length,
                })}
              </small>
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
              <p className={`${s.hint} ${s.small}`}>{t('submit.checkHint')}</p>
            )}
          </fieldset>
          {sendError && (
            <p className={s.error} role="alert">
              {sendError}
            </p>
          )}
          <button
            type="submit"
            form="video-form"
            className={`${s.btn} ${s.primary}`}
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
        </aside>
      </div>
    </div>
  );
}
