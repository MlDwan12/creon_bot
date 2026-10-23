// Общие стили — первыми: стили компонентов (*.module.css) идут после и при равной силе перекрывают их.
import './style.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import './i18n';
import { initMonitoring } from './monitoring';
import { role, roleReady, ROLE_HOME } from './role';
import { router } from './router';
import { applyTheme, inTelegram, openExternalLink, webApp } from './telegram';

applyTheme();
webApp?.onEvent('themeChanged', () => applyTheme());
// Внешние ссылки (target="_blank") внутри Telegram — только через openLink: обычная новая вкладка
// из мини-аппа наследует ограничения его фрейма, и сайты вроде Instagram её блокируют
// (ERR_BLOCKED_BY_RESPONSE). Один перехват на всё приложение — href у ссылок остаётся.
if (inTelegram)
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[target="_blank"]');
    const href = a?.getAttribute('href');
    if (!href || !/^https?:\/\//i.test(href)) return;
    e.preventDefault();
    openExternalLink(href);
  });
// Telegram открывает мини-апп с #tgWebAppData=… — это подписанный initData, им авторизуется API.
// SDK уже прочитал его (при перезагрузке берёт из sessionStorage), а в адресе он попал бы в отчёты
// об ошибках, в «скопировать ссылку» и т.п. — убираем до запуска роутера.
if (location.hash.includes('tgWebApp'))
  history.replaceState(history.state, '', location.pathname + location.search);
webApp?.ready(); // убирает экран загрузки Telegram
webApp?.expand(); // открывает мини-апп на всю высоту

// ошибки у пользователей — в Sentry (без VITE_SENTRY_DSN выключено)
initMonitoring();

// Первый экран рисуем, когда известно, модератор ли это и в каком он кабинете, — до этого видна
// заставка из index.html: иначе модератор мельком увидит каталог, а заказчик — чужие вкладки.
void roleReady.then(() => {
  // Запуск с главной (кнопка меню, /start) — в кабинет, где пользователь был в прошлый раз.
  if (location.pathname === '/' && role.get() === 'advertiser')
    void router.navigate(ROLE_HOME.advertiser, { replace: true });
  createRoot(document.getElementById('app')!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
});
