// Печатает подписанный initData, чтобы открывать мини-апп в обычном браузере при разработке:
//   node scripts/dev-init-data.mjs > webapp/.env.local
// Действует 24 часа (срок в src/api/init-data.guard.ts), потом запустить заново.
// Подписывается BOT_TOKEN из .env — webapp/.env.local в git не попадает.
import { createHmac } from 'node:crypto';

process.loadEnvFile();
const token = process.env.BOT_TOKEN;
if (!token) throw new Error('BOT_TOKEN не задан в .env');

const fields = {
  auth_date: String(Math.floor(Date.now() / 1000)),
  // Вымышленный Telegram ID: в локальной базе появится пользователь «Dev».
  user: JSON.stringify({ id: 1, first_name: 'Dev' }),
};
const dataCheckString = Object.keys(fields)
  .sort()
  .map((k) => `${k}=${fields[k]}`)
  .join('\n');
const secret = createHmac('sha256', 'WebAppData').update(token).digest();
const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');

console.log(
  `VITE_DEV_INIT_DATA="${new URLSearchParams({ ...fields, hash })}"`,
);
