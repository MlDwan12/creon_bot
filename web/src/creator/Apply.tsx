import { useCallback, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  type AdvertiserAccess,
  APPLIED_EVENT,
  applyAdvertiser,
  errorText,
  fetchMyProfile,
} from '../api';
import { formatDate } from '../format';
import { useSession } from '../session';
import s from '../ui.module.css';

const BADGE: Record<AdvertiserAccess['state'], string> = {
  pending: s.warn,
  rejected: '',
  open: s.success,
  closed: s.danger,
  none: '',
};

/**
 * «Стать заказчиком» — как в мини-аппе (webapp/src/views/AdvertiserApplyView.tsx): слева «Как это
 * работает», справа форма или что с заявкой. Кабинет заказчика открывает команда после созвона.
 */
export function Apply() {
  const { t } = useTranslation();
  const { me, setMe } = useSession();
  const [access, setAccess] = useState<AdvertiserAccess | null>();
  const [loadError, setLoadError] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  // согласие на обработку данных — без него кнопка выключена (152-ФЗ)
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoadError('');
    fetchMyProfile().then(
      (p) => setAccess(p.advertiser),
      (err) => setLoadError(errorText(err, t('profile.loadError'))),
    );
  }, [t]);
  useEffect(load, [load]);

  // кабинет открыли или закрыли, пока сайт был открыт: /api/me ответил по-старому — обновляем меню
  const state = access?.state ?? 'none';
  useEffect(() => {
    if ((state === 'open' || state === 'closed') && me.advertiser !== state)
      setMe({ ...me, advertiser: state });
  }, [state, me, setMe]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await applyAdvertiser(email, phone);
      setAccess({ state: 'pending', retryAt: null });
      window.dispatchEvent(new Event(APPLIED_EVENT));
    } catch (err) {
      setError(errorText(err, t('support.sendError')));
    } finally {
      setBusy(false);
    }
  }

  const steps = t('apply.steps', { returnObjects: true }) as string[];
  const gives = t('apply.gives', { returnObjects: true }) as string[];

  return (
    <div className={s.page}>
      <header>
        <h1>{t('apply.title')}</h1>
        <p className={s.hint}>{t('apply.hint')}</p>
      </header>
      {loadError ? (
        <div className={s.buttons}>
          <p className={s.error}>{loadError}</p>
          <button type="button" className={s.btn} onClick={load}>
            {t('common.retry')}
          </button>
        </div>
      ) : access === undefined ? (
        <p className={s.hint}>{t('common.loading')}</p>
      ) : (
        <div className={`${s.applyGrid} ${s.alignStart}`}>
          <section className={s.card}>
            <h2>{t('apply.howTitle')}</h2>
            <ol className={s.numbered}>
              {steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <h2>{t('apply.givesTitle')}</h2>
            <ul className={s.hint}>
              {gives.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </section>

          {state === 'none' ? (
            <form className={s.card} onSubmit={send}>
              <h2>{t('apply.formTitle')}</h2>
              <label className={s.field}>
                {t('apply.email')}
                <input
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                />
              </label>
              <label className={s.field}>
                {t('apply.phone')}
                <input
                  type="tel"
                  autoComplete="tel"
                  maxLength={30}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+7 900 123-45-67"
                  aria-describedby="apply-phone-hint"
                />
                <small id="apply-phone-hint" className={`${s.hint} ${s.small}`}>
                  {t('apply.phoneHint')}
                </small>
              </label>
              <label className={`${s.check} ${s.small}`}>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  required
                />
                <span>
                  <Trans
                    i18nKey="apply.consent"
                    components={[
                      // страница сайта (собирается вместе с лендингом)
                      <a
                        key="privacy"
                        href="/privacy.html"
                        target="_blank"
                        rel="noreferrer"
                      />,
                    ]}
                  />
                </span>
              </label>
              {error && (
                <p className={s.error} role="alert">
                  {error}
                </p>
              )}
              <button
                type="submit"
                className={`${s.btn} ${s.primary}`}
                disabled={busy || !email.trim() || !consent}
              >
                {busy ? t('common.sending') : t('apply.send')}
              </button>
            </form>
          ) : (
            <section className={s.card} role="status">
              <span className={`${s.badge} ${BADGE[state]} ${s.selfStart}`}>
                {t(`apply.${state}Badge`)}
              </span>
              <h2>{t(`apply.${state}Title`)}</h2>
              <p className={s.hint}>
                {t(`apply.${state}Text`, {
                  date: access?.retryAt ? formatDate(access.retryAt) : '',
                })}
              </p>
              {state === 'open' ? (
                <Link
                  to="/my-orders"
                  className={`${s.btn} ${s.primary} ${s.linkBtn}`}
                >
                  {t('apply.openCabinet')}
                </Link>
              ) : (
                me.supportUrl && (
                  <Link to="/support" className={s.linkButton}>
                    {t('web.writeSupport')} ›
                  </Link>
                )
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
