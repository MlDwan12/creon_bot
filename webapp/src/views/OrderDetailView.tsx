import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import {
  ApiError,
  categoryLabel,
  claimOrder,
  fetchOrder,
  type OrderDetail,
  PLATFORM_NAMES,
} from '../api';
import LoadState from '../components/LoadState';
import PlatformIcon from '../components/PlatformIcon';
import SupportLink from '../components/SupportLink';
import {
  budgetViews,
  formatCompact,
  formatDeadline,
  formatMoney,
  formatViews,
  videoFormatParts,
} from '../format';
import { tList } from '../i18n';
import { safeUrl } from '../telegram';
import s from './OrderDetailView.module.css';

export default function OrderDetailView() {
  const { t } = useTranslation();
  // id — из адреса /orders/:id
  const id = Number(useParams().id);

  const [order, setOrder] = useState<OrderDetail>();
  const [loadError, setLoadError] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState('');
  const [justClaimed, setJustClaimed] = useState(false);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setOrder(await fetchOrder(id));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.userMessage : t('order.loadError'),
      );
    }
  }, [id, t]);
  useEffect(() => void load(), [load]);

  // Остаток бюджета меняется, пока другие креаторы сдают ролики, — обновляем, пока экран открыт
  // и виден. Сбой обновления не показываем: на экране остаются последние данные.
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
      setClaimError(
        err instanceof ApiError ? err.userMessage : t('order.claimError'),
      );
    } finally {
      setClaiming(false);
    }
  }

  // Калькулятор: сколько принесёт ролик с таким числом просмотров — от порога заказа и выше.
  const [calcViews, setCalcViews] = useState<number>();

  if (loadError || !order)
    return (
      <main className={s.detail}>
        <LoadState error={loadError} onRetry={load} />
      </main>
    );

  const min = order.minViews;
  const presets = [...new Set([min, 1_000, 10_000, 50_000])]
    .filter((v) => v >= min)
    .sort((a, b) => a - b);
  const views = calcViews ?? presets[Math.min(2, presets.length - 1)];
  /** Выплата за просмотры по ставке, но не больше свободного остатка бюджета. */
  const earning =
    order.cpm && views
      ? // остаток округлён вниз (меньше 100 — freeUnder): не обещаем больше, чем точно есть
        Math.min(
          order.freeUnder ?? order.free,
          Math.round((views / 1000) * order.cpm * 100) / 100,
        )
      : 0;
  const formatParts = videoFormatParts(order);

  return (
    <main className={s.detail}>
      {/* Главное о заказе — в одном ярком блоке: площадки, название, ставка, остаток. */}
      <header className={s.hero}>
        <div className={s.tags}>
          {order.platforms.map((p) => (
            <span key={p} className={`${s.tag} ${s.platform}`}>
              <PlatformIcon platform={p} size={18} round inverse />
              {PLATFORM_NAMES[p]}
            </span>
          ))}
          {!order.platforms.length && (
            <span className={s.tag}>{t('orderCard.anyPlatform')}</span>
          )}
          <span className={s.tag}>{categoryLabel(order.category)}</span>
        </div>
        <h1>{order.title}</h1>
        {order.cpm !== null ? (
          <div className={s.price}>
            <span className={`money ${s.cpm}`}>{formatMoney(order.cpm)}</span>
            <span>{t('money.perEveryThousand')}</span>
          </div>
        ) : (
          <span>{t('order.cpmPending')}</span>
        )}
        <span className={order.budgetLow ? `${s.free} ${s.low}` : s.free}>
          {order.freeUnder
            ? t('order.leftUnder', { amount: formatMoney(order.freeUnder) })
            : t('order.left', { amount: formatMoney(order.free) }) +
              (order.cpm
                ? ` · ${t('order.leftViews', { views: formatViews(budgetViews(order.free, order.cpm)) })}`
                : '')}
          {order.budgetLow && t('orderCard.hurry')}
        </span>
      </header>

      {!!order.cpm && (
        <section className={s.calc} aria-labelledby="calc-title">
          <h2 id="calc-title">{t('order.calcTitle')}</h2>
          <div
            className={s.presets}
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
          <div className={s.result}>
            <span>{t('order.calcViews', { views: formatViews(views) })}</span>
            <span className="money">{formatMoney(earning)}</span>
          </div>
          <p className={s.note}>
            {t('order.calcNote', { views: formatViews(order.minViews) })}
          </p>
          <p className={s.note}>{t('order.budgetNote')}</p>
        </section>
      )}

      <section className={s.rows}>
        <div className={s.row}>
          <span>{t('order.canSubmit')}</span>
          <span className={s.value}>
            {t('order.fromViews', { views: formatViews(order.minViews) })}
          </span>
        </div>
        {order.deadline && (
          <div className={s.row}>
            <span>{t('order.dueBy')}</span>
            <span className={s.value}>{formatDeadline(order.deadline)}</span>
          </div>
        )}
        <div className={s.row}>
          <span>{t('order.payout')}</span>
          <span className={s.value}>{t('order.payoutValue')}</span>
        </div>
      </section>

      <section className={s.block}>
        <h2 className="section-title">{t('order.task')}</h2>
        <div className={s.text}>{order.description}</div>
        {formatParts.length > 0 && (
          <ul className={s.req} aria-label={t('order.requirements')}>
            {formatParts.map((part) => (
              <li key={part}>{part}</li>
            ))}
          </ul>
        )}
        {safeUrl(order.referenceUrl) && (
          <a
            href={safeUrl(order.referenceUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className={s.reference}
          >
            {t('order.reference')}
          </a>
        )}
      </section>

      <section className={s.block}>
        <h2 className="section-title">{t('order.howItWorks')}</h2>
        <ol className={s.steps}>
          {tList('order.steps').map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      {!order.own && (
        <Link
          to={`/report?${new URLSearchParams({ target: 'ORDER', id: String(order.id), title: order.title })}`}
          className="quiet-link"
        >
          {t('order.report')}
        </Link>
      )}
      <SupportLink
        label={t('order.supportLabel', { id: order.id })}
        about={t('order.supportAbout', { id: order.id, title: order.title })}
      />

      {justClaimed && (
        <p className={`${s.notice} ${s.success}`} role="status">
          {t('order.claimed')}
        </p>
      )}
      {claimError && (
        <p className={`${s.notice} ${s.error}`} role="alert">
          {claimError}
        </p>
      )}

      {order.own ? (
        <p className={s.notice} role="status">
          {t('order.own')}
        </p>
      ) : (
        <div className="bottom-bar">
          {order.claimed ? (
            <Link to="/submissions" className="main-button">
              {t('order.mySubmissions')}
            </Link>
          ) : (
            <button
              type="button"
              className="main-button"
              disabled={claiming}
              onClick={claim}
            >
              {claiming ? t('common.sending') : t('order.claim')}
            </button>
          )}
        </div>
      )}
    </main>
  );
}
