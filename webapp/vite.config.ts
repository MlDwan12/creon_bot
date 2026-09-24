import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  // В dev фронт живёт на :5173, а API — в Nest на :3000. Прокси делает их одним адресом,
  // как будет в проде, где Nest раздаёт и API, и собранный фронт.
  server: {
    proxy: { '/api': 'http://localhost:3000' },
    // Telegram открывает мини-апп только по HTTPS — в dev это туннель ngrok на :5173.
    // Vite по умолчанию отвечает только на localhost, домены туннеля разрешаем явно.
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev'],
  },
});
