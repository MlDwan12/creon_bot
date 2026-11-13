import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Сайт Fixum (site.fixumapp.com) — отдельно от мини-аппа: своя сборка и выкатка, общий только API
// и packages/shared. Настройки — как у webapp/vite.config.ts.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // без node:url — в Docker нет @types/node; decode — на случай пробелов и кириллицы в пути
      '@fixum/shared': decodeURIComponent(
        new URL('../packages/shared/src/index.ts', import.meta.url).pathname,
      ),
    },
  },
  css: { modules: { localsConvention: 'camelCaseOnly' } },
  // две страницы: кабинеты (index.html) и лендинг (landing.html — тело дорисовывает scripts/prerender.mjs)
  build: {
    rollupOptions: {
      input: {
        main: decodeURIComponent(
          new URL('index.html', import.meta.url).pathname,
        ),
        landing: decodeURIComponent(
          new URL('landing.html', import.meta.url).pathname,
        ),
      },
    },
  },
  // В dev сайт на :5174 (мини-апп — на :5173), API — Nest на :3000, через прокси — один адрес, как в проде.
  // Вход через Telegram на localhost не работает (домен задаётся боту в BotFather) — проверять на дев-стенде.
  server: {
    port: 5174,
    proxy: { '/api': 'http://localhost:3000' },
    // словари i18n/*.json и packages/shared лежат в корне репозитория
    fs: { allow: ['..'] },
  },
});
