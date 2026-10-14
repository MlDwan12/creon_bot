// Подписанные initData для нагрузочного теста: каждый виртуальный пользователь k6 — свой
// пользователь (лимит запросов считается по пользователю, а не по IP).
//   node load/users.mjs 500 > load/users.json
// Подпись — BOT_TOKEN из .env, действует 24 часа (src/auth/init-data.guard.ts). users.json в git
// не попадает. Telegram ID — от 990 000 000 000: с настоящими не пересекутся, load/cleanup.sql
// удаляет их по этому порогу.
import { createHmac } from 'node:crypto';

process.loadEnvFile();
const token = process.env.BOT_TOKEN;
if (!token) throw new Error('BOT_TOKEN не задан в .env');
const count = Number(process.argv[2] ?? 500);
const secret = createHmac('sha256', 'WebAppData').update(token).digest();

const users = [];
for (let i = 1; i <= count; i++) {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({
      id: 990_000_000_000 + i,
      first_name: `Нагрузка ${i}`,
    }),
  };
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  users.push(new URLSearchParams({ ...fields, hash }).toString());
}
console.log(JSON.stringify(users));
