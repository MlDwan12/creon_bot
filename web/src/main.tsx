// Общие стили — первыми: стили компонентов (*.module.css) идут после и при равной силе перекрывают их.
import './style.css';
import './i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SharedReport } from './SharedReport';

// После выкатки старых файлов страниц на сервере нет, а открытая вкладка просит их по старым именам —
// перезагружаемся за новой сборкой. Не чаще раза в минуту: если файла нет и в новой, не зациклиться.
window.addEventListener('vite:preloadError', (event) => {
  const last = Number(sessionStorage.getItem('fx_reload_at'));
  if (Date.now() - last < 60_000) return;
  event.preventDefault();
  sessionStorage.setItem('fx_reload_at', String(Date.now()));
  location.reload();
});

// Публичный отчёт /share/<токен> открывается без входа — мимо App (экран входа) и меню сайта.
const share = /^\/share\/([\w-]+)\/?$/.exec(location.pathname);

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    {share ? <SharedReport token={share[1]} /> : <App />}
  </StrictMode>,
);
