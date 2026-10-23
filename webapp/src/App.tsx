import { useCallback, useEffect, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Navigate,
  Outlet,
  useLocation,
  useMatches,
  useNavigate,
} from 'react-router';
import s from './App.module.css';
import OnboardingOverlay from './components/OnboardingOverlay';
import RoleSwitch from './components/RoleSwitch';
import TabBar from './components/TabBar';
import { banned as bannedStore, fetchMe } from './api';
import { moderator, role, roleOfPath, setRole } from './role';
import type { RouteHandle } from './router';
import { useStore } from './store';
import { inTelegram, openTelegramLink, webApp } from './telegram';

export default function App() {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const banned = useStore(bannedStore);
  const isModerator = useStore(moderator);
  const matches = useMatches();
  const handle = (matches[matches.length - 1]?.handle ?? {}) as RouteHandle;

  /** Назад по истории; если экран открыли сразу по ссылке (истории нет) — в каталог. */
  const goBack = useCallback(() => {
    if ((window.history.state?.idx ?? 0) > 0) void navigate(-1);
    else void navigate('/');
  }, [navigate]);

  // Внутри Telegram «Назад» — его собственная кнопка в шапке (BackButton), а не наша.
  useEffect(() => {
    if (!inTelegram) return;
    webApp!.BackButton.onClick(goBack);
    return () => webApp!.BackButton.offClick(goBack);
  }, [goBack]);
  useEffect(() => {
    if (!inTelegram) return;
    if (handle.back) webApp!.BackButton.show();
    else webApp!.BackButton.hide();
  }, [handle.back]);

  // Свайп от левого края вправо на подэкранах — «Назад», как привыкли на iPhone.
  // ponytail: без анимации ухода экрана — только сам переход; понадобится — тянуть экран за пальцем.
  useEffect(() => {
    if (!handle.back) return;
    let start: { x: number; y: number } | undefined;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      start =
        e.touches.length === 1 && t.clientX < 24
          ? { x: t.clientX, y: t.clientY }
          : undefined;
    };
    const onEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (
        start &&
        t.clientX - start.x > 80 &&
        Math.abs(t.clientY - start.y) < 60
      )
        goBack();
      start = undefined;
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
    };
  }, [handle.back, goBack]);

  // «⋯ → Настройки» в шапке Telegram ведёт в поддержку — на любом экране, не занимая места.
  useEffect(() => {
    if (!inTelegram) return;
    void fetchMe()
      .then(({ supportUrl, isModerator }) => {
        if (!supportUrl) return;
        // форма в мини-аппе, а не переход в чат: так приложение не сворачивается
        webApp!.SettingsButton.onClick(
          () => void navigate(isModerator ? '/mod/support' : '/support'),
        );
        webApp!.SettingsButton.show();
      })
      .catch(() => {});
  }, []); // один раз на запуск

  // Пришли на экран другого кабинета (ссылка из уведомления, переключатель) — переключаем и вкладки.
  // Роль ещё не выбрана и открыли просто главную — не решаем за человека: спросит выбор роли.
  useLayoutEffect(() => {
    const r = roleOfPath(pathname);
    if (r && (role.get() || pathname !== '/')) setRole(r);
  }, [pathname]);

  // Модератора — в его окно, остальных — из него. Это только навигация:
  // права на каждый /api/mod/* всё равно проверяет бэкенд (ModeratorGuard).
  const inModeration = pathname.startsWith('/mod');
  if (pathname !== '/privacy' && isModerator !== inModeration)
    return <Navigate to={isModerator ? '/mod' : '/'} replace />;

  if (banned)
    return (
      <main className={s.banned}>
        <div className={s.bannedIcon} aria-hidden="true">
          <svg
            width="34"
            height="34"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
            <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
          </svg>
        </div>
        <h1>{t('banned.title')}</h1>
        {banned.reason && (
          <p className={s.bannedReason}>
            {t('banned.reason', { reason: banned.reason })}
          </p>
        )}
        <p className={s.hint}>{t('banned.hint')}</p>
        {banned.supportUrl && (
          <button
            type="button"
            className="main-button"
            onClick={() => openTelegramLink(banned.supportUrl!)}
          >
            {t('banned.write')}
          </button>
        )}
      </main>
    );

  // Сменили язык — перерисовываем всё: так обновятся и тексты, и числа с датами из format.ts.
  // Ключ с адресом — экран открывается заново и при переходе на тот же экран с другим id.
  const lang = i18n.language;
  return (
    <>
      {/* В обычном браузере (dev) шапки Telegram нет — рисуем свою кнопку «Назад». */}
      {!inTelegram && handle.back && (
        <button type="button" className={s.browserBack} onClick={goBack}>
          {t('common.back')}
        </button>
      )}
      {/* на главных экранах вкладок: «Креатор / Заказчик» (role.ts) */}
      {handle.tab && <RoleSwitch key={`role:${lang}`} />}
      <Outlet key={`${lang}:${pathname}`} />
      <TabBar key={`tabs:${lang}`} />
      {!inModeration && pathname !== '/privacy' && <OnboardingOverlay />}
    </>
  );
}
