import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import './style.css';
import { webApp } from './telegram';

webApp?.ready(); // убирает экран загрузки Telegram
webApp?.expand(); // открывает мини-апп на всю высоту

createApp(App).use(router).mount('#app');
