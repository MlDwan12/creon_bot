import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import './style.css';
import { applyTheme, webApp } from './telegram';

applyTheme();
webApp?.onEvent('themeChanged', () => applyTheme());
webApp?.ready(); // убирает экран загрузки Telegram
webApp?.expand(); // открывает мини-апп на всю высоту

createApp(App).use(router).mount('#app');
