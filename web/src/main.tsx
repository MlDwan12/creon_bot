// Общие стили — первыми: стили компонентов (*.module.css) идут после и при равной силе перекрывают их.
import './style.css';
import './i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
