import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  // В dev фронт живёт на :5173, а API — в Nest на :3000. Прокси делает их одним адресом,
  // как будет в проде, где Nest раздаёт и API, и собранный фронт.
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
