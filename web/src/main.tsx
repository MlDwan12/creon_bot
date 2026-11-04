// Общие стили — первыми: стили компонентов (*.module.css) идут после и при равной силе перекрывают их.
import './style.css';
import './i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SharedReport } from './SharedReport';

// Публичный отчёт /share/<токен> открывается без входа — мимо App (экран входа) и меню сайта.
const share = /^\/share\/([\w-]+)\/?$/.exec(location.pathname);

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    {share ? <SharedReport token={share[1]} /> : <App />}
  </StrictMode>,
);
