import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import {
  role as roleStore,
  roleLoaded as roleLoadedStore,
  ROLE_HOME,
  setRole,
  type Role,
} from '../role';
import { useStore } from '../store';
import s from './OnboardingOverlay.module.css';

/**
 * Первый вход: выбор кабинета (креатор или заказчик), потом короткие шаги для него и кнопка сразу
 * к делу. Показывается, пока роль не выбрана; дальше её меняет переключатель вверху экранов.
 */
export default function OnboardingOverlay() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const role = useStore(roleStore);
  const roleLoaded = useStore(roleLoadedStore);
  /** Выбрана на первом шаге, но ещё не подтверждена: показываем её шаги. */
  const [picked, setPicked] = useState<Role>();
  const open = roleLoaded && (!role || !!picked);

  // Пока окно открыто, экран под ним не прокручивается: иначе на телефоне два скролла.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  /** Запомнить роль и перейти: заказчика с кнопки действия — сразу в форму заказа. */
  function start(to: string) {
    setRole(picked!);
    setPicked(undefined);
    void navigate(to);
  }

  /** Шаги роли — массив строк из словаря (onboarding.<роль>.steps). */
  const steps = (r: Role) =>
    t(`onboarding.${r}.steps`, { returnObjects: true }) as unknown as string[];

  return (
    <div
      className={s.onboarding}
      role="dialog"
      aria-modal="true"
      aria-label={t('onboarding.aria')}
    >
      {picked ? (
        <>
          <div className={s.top}>
            <button
              type="button"
              className={s.link}
              onClick={() => setPicked(undefined)}
            >
              {t('onboarding.back')}
            </button>
            <button
              type="button"
              className={s.link}
              onClick={() => start(ROLE_HOME[picked])}
            >
              {t('onboarding.skip')}
            </button>
          </div>
          <div className={s.intro}>
            <h1>{t(`onboarding.${picked}.title`)}</h1>
          </div>
          <ol className={s.steps}>
            {steps(picked).map((step, i) => (
              <li key={step}>
                <span className={s.num} aria-hidden="true">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className={s.note}>{t('onboarding.note')}</p>
          <button
            type="button"
            className={`main-button ${s.start}`}
            onClick={() =>
              start(
                picked === 'advertiser' ? '/my-orders/new' : ROLE_HOME.creator,
              )
            }
          >
            {t(`onboarding.${picked}.action`)}
          </button>
        </>
      ) : (
        <>
          <div className={s.brand}>
            <img src="/logo.webp" alt="" width="128" height="128" />
            <span>Fixum</span>
          </div>
          <div className={s.intro}>
            <h1>{t('onboarding.title')}</h1>
            <p>{t('onboarding.intro')}</p>
          </div>

          <button
            type="button"
            className={`${s.role} ${s.advertiser}`}
            onClick={() => setPicked('advertiser')}
          >
            <span className={s.roleHead}>
              <span className={s.roleIcon}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
                </svg>
              </span>
              <span className={s.roleLabel}>
                {t('onboarding.advertiserLabel')}
              </span>
            </span>
            <strong>{t('onboarding.advertiserTitle')}</strong>
            <span className={s.roleText}>{t('onboarding.advertiserText')}</span>
          </button>

          <button
            type="button"
            className={`${s.role} ${s.creator}`}
            onClick={() => setPicked('creator')}
          >
            <span className={s.roleHead}>
              <span className={s.roleIcon}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="5" width="18" height="14" rx="3" />
                  <path d="M10 9.5v5l4.5-2.5z" />
                </svg>
              </span>
              <span className={s.roleLabel}>
                {t('onboarding.creatorLabel')}
              </span>
            </span>
            <strong>{t('onboarding.creatorTitle')}</strong>
            <span className={s.roleText}>{t('onboarding.creatorText')}</span>
          </button>
        </>
      )}
    </div>
  );
}
