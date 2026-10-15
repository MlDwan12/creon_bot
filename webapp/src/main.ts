import I18NextVue from 'i18next-vue';
import { createApp } from 'vue';
import App from './App.vue';
import { i18next } from './i18n';
import { initMonitoring } from './monitoring';
import { router } from './router';
import './style.css';
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
webApp?.ready(); // убирает экран загрузки Telegram
webApp?.expand(); // открывает мини-апп на всю высоту

const app = createApp(App).use(router).use(I18NextVue, { i18next });
// ошибки у пользователей — в Sentry (без VITE_SENTRY_DSN выключено)
initMonitoring(app);
app.mount('#app');
