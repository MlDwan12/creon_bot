import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import {
  categoryLabel,
  claimOrder,
  errorText,
  fetchOrder,
  type OrderDetail,
  PLATFORM_NAMES,
  safeUrl,
} from '../api';
import { supportSearch } from '@fixum/shared';
import { Complaint } from '../components/Complaint';
import { PlatformIcon } from '../components/PlatformIcon';
import {
  budgetViews,
  formatCompact,
  formatDeadline,
  formatMoney,
  formatViews,
  videoFormatParts,
} from '../format';
import { tList } from '../i18n';
import s from '../ui.module.css';

/**
 * Заказ глазами креатора — как в мини-аппе (webapp/src/views/OrderDetailView.tsx): слева задание,
 * справа калькулятор заработка и «Взять».
 */
export function OrderPage() {
  const { t } = useTranslation();
  const id = Number(useParams().id);
  const [order, setOrder] = useState<OrderDetail>();
  const [loadError, setLoadError] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState('');
  const [justClaimed, setJustClaimed] = useState(false);
  // калькулятор: сколько принесёт ролик с таким числом просмотров — от порога заказа и выше
  const [calcViews, setCalcViews] = useState<number>();

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setOrder(await fetchOrder(id));
    } catch (err) {
      setLoadError(errorText(err, t('order.loadError')));
    }
  }, [id, t]);
  useEffect(() => void load(), [load]);

  // остаток бюджета меняется, пока другие креаторы сдают ролики, — обновляем, пока вкладка видна
  useEffect(() => {
    const refresh = setInterval(() => {
      if (document.hidden) return;
      fetchOrder(id).then(setOrder, () => {});
    }, 30_000);
    return () => clearInterval(refresh);
  }, [id]);

  async function claim() {
    setClaiming(true);
    setClaimError('');
    try {
      await claimOrder(id);
      setOrder((o) => o && { ...o, claimed: true });
      setJustClaimed(true);
    } catch (err) {
      setClaimError(errorText(err, t('order.claimError')));
    } finally {
      setClaiming(false);
    }
  }

  if (loadError)
    return (
      <div className={s.buttons}>
        <p className={s.hint}>{loadError}</p>
        <button type="button" className={s.btn} onClick={load}>
          {t('common.retry')}
        </button>
      </div>
    );
  if (!order) return <p className={s.hint}>{t('common.loading')}</p>;

  const min = order.minViews;
  const presets = [...new Set([min, 1_000, 10_000, 50_000])]
    .filter((v) => v >= min)
    .sort((a, b) => a - b);
  const views = calcViews ?? presets[Math.min(2, presets.length - 1)];
  /** Выплата за просмотры по ставке, но не больше свободного остатка бюджета. */
  const earning =
    order.cpm && views
      ? Math.min(
          order.freeUnder ?? order.free,
          Math.round((views / 1000) * order.cpm * 100) / 100,
        )
      : 0;
  const formatParts = videoFormatParts(order);

  return (
    <div className={s.page}>
      <header className={s.page}>
        <div className={s.chips}>
          {order.platforms.map((p) => (
            <span key={p} className={s.badge}>
              <PlatformIcon platform={p} size={16} round /> {PLATFORM_NAMES[p]}
            </span>
          ))}
          {!order.platforms.length && (
            <span className={s.badge}>{t('orderCard.anyPlatform')}</span>
          )}
          <span className={s.badge}>{categoryLabel(order.category)}</span>
        </div>
        <h1>{order.title}</h1>
      </header>

      <div className={s.review}>
        <div className={s.page}>
          <section className={s.rows}>
            <div className={s.row}>
              <span>{t('order.canSubmit')}</span>
              <span>
                {t('order.fromViews', { views: formatViews(order.minViews) })}
              </span>
            </div>
            {order.deadline && (
              <div className={s.row}>
                <span>{t('order.dueBy')}</span>
                <span>{formatDeadline(order.deadline)}</span>
              </div>
            )}
            <div className={s.row}>
              <span>{t('order.payout')}</span>
              <span>{t('order.payoutValue')}</span>
            </div>
          </section>

          <section className={s.card}>
            <h2>{t('order.task')}</h2>
            <div className={s.text}>{order.description}</div>
            {formatParts.length > 0 && (
              <div className={s.chips} aria-label={t('order.requirements')}>
                {formatParts.map((part) => (
                  <span key={part} className={s.badge}>
                    {part}
                  </span>
                ))}
              </div>
            )}
            {safeUrl(order.referenceUrl) && (
              <a
                href={safeUrl(order.referenceUrl)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('order.reference')}
              </a>
            )}
          </section>

          {order.examples.length > 0 && (
            <section className={s.card}>
              <h2>{t('order.examples')}</h2>
              <p className={`${s.hint} ${s.small}`}>
                {t('order.examplesHint')}
              </p>
              <div className={s.chips}>
                {order.examples.map((e, i) => (
                  // редирект Fixum: в ссылке площадки был бы ник автора
                  <a
                    key={e.url}
                    href={safeUrl(e.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${s.btn} ${s.linkBtn}`}
                  >
                    {e.platform !== 'OTHER' && (
                      <PlatformIcon platform={e.platform} size={24} round />
                    )}
                    &nbsp;{t('order.exampleN', { n: i + 1 })}
                  </a>
                ))}
              </div>
            </section>
          )}

          {order.linkInBio && (
            <section className={s.alert}>
              <strong>{t('order.linkInBio')}</strong>
              {t('order.linkInBioText')}
            </section>
          )}

          <section className={s.card}>
            <h2>{t('order.howItWorks')}</h2>
            <ol>
              {tList('order.steps').map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>

          {!order.own && (
            <Complaint
              target="ORDER"
              targetId={order.id}
              label={t('order.report')}
            />
          )}
        </div>

        <aside className={`${s.card} ${s.decision}`}>
          {order.cpm !== null ? (
            <p>
              <strong className={s.amount}>{formatMoney(order.cpm)}</strong>{' '}
              <span className={s.hint}>{t('money.perEveryThousand')}</span>
            </p>
          ) : (
            <p className={s.hint}>{t('order.cpmPending')}</p>
          )}
          <p className={order.budgetLow ? s.flag : s.hint}>
            {order.fundBusy
              ? t('order.fundBusy')
              : (order.freeUnder
                  ? t('order.leftUnder', {
                      amount: formatMoney(order.freeUnder),
                    })
                  : t('order.left', { amount: formatMoney(order.free) }) +
                    (order.cpm
                      ? ` · ${t('order.leftViews', { views: formatViews(budgetViews(order.free, order.cpm)) })}`
                      : '')) + (order.budgetLow ? t('orderCard.hurry') : '')}
          </p>

          {!!order.cpm && (
            <div className={s.field} aria-labelledby="calc-title">
              <span id="calc-title">{t('order.calcTitle')}</span>
              <div
                className={s.chips}
                role="radiogroup"
                aria-label={t('order.calcAria')}
              >
                {presets.map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={views === v}
                    onClick={() => setCalcViews(v)}
                  >
                    {formatCompact(v)}
                  </button>
                ))}
              </div>
              <div className={s.row}>
                <span>
                  {t('order.calcViews', { views: formatViews(views) })}
                </span>
                <span>{formatMoney(earning)}</span>
              </div>
              <p className={`${s.hint} ${s.small}`}>
                {t('order.calcNote', { views: formatViews(order.minViews) })}{' '}
                {t('order.budgetNote')}
              </p>
            </div>
          )}

          {justClaimed && (
            <p className={s.notice} role="status">
              {t('order.claimed')}
            </p>
          )}
          {claimError && (
            <p className={s.error} role="alert">
              {claimError}
            </p>
          )}
          {order.fundBusy && !order.claimed && !order.own && (
            <p className={`${s.hint} ${s.small}`} role="status">
              {t('order.fundBusyNote')}
            </p>
          )}
          {order.own ? (
            <p className={s.hint} role="status">
              {t('order.own')}
            </p>
          ) : order.claimed ? (
            <Link
              to="/submissions"
              className={`${s.btn} ${s.primary} ${s.linkBtn}`}
            >
              {t('order.mySubmissions')}
            </Link>
          ) : (
            <button
              type="button"
              className={`${s.btn} ${s.primary}`}
              disabled={claiming || order.fundBusy}
              onClick={claim}
            >
              {claiming ? t('common.sending') : t('order.claim')}
            </button>
          )}
          <Link
            to={`/support${supportSearch({ orderId: order.id })}`}
            className={s.small}
          >
            {t('order.supportLabel', { id: order.id })}
          </Link>
        </aside>
      </div>
    </div>
  );
}
