// Нагрузочный тест (k6): креаторы листают каталог, открывают заказы, откликаются, смотрят свои
// ролики — то, что делают все разом при наплыве. Только на локальной копии, не на проде: сервер
// общий с другими проектами.
//
//   docker compose --profile app up -d --build            # бот как в проде: один контейнер
//   docker compose exec -T db psql -U creon -d creon_bot < load/seed.sql
//   node load/users.mjs 500 > load/users.json
//   docker run --rm --network creon_bot_default -v "$PWD/load:/load" -e BASE_URL=http://api:3000 \
//     grafana/k6:0.54.0 run /load/creators.js            # пик: добавить -e PEAK=1500
//   docker compose exec -T db psql -U creon -d creon_bot < load/cleanup.sql
//
// Смотреть: http_req_duration p(95), http_req_failed и «запросы по эндпоинтам» в итоге; во время
// теста — docker stats (CPU и память контейнера api).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
// Пиковое число одновременных пользователей; каждый — свой initData из users.json.
const PEAK = Number(__ENV.PEAK || 500);
const users = new SharedArray('users', () => JSON.parse(open('./users.json')));
if (users.length < PEAK)
  throw new Error(`В users.json ${users.length} пользователей, нужно ${PEAK}: node load/users.mjs ${PEAK} > load/users.json`);

export const options = {
  scenarios: {
    creators: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: Math.round(PEAK / 5) }, // разогрев
        { duration: '2m', target: PEAK }, // наплыв
        { duration: '3m', target: PEAK }, // держим пик
        { duration: '1m', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
  },
};

const CATEGORIES = ['FOOD', 'TECH', 'BEAUTY', 'OTHER'];

export default function () {
  const headers = { Authorization: `tma ${users[__VU - 1]}` };
  const get = (path, name) => http.get(`${BASE}${path}`, { headers, tags: { name } });

  // открыл мини-апп
  check(get('/api/me', 'me'), { me: (r) => r.status === 200 });
  const list = get('/api/orders', 'catalog');
  check(list, { catalog: (r) => r.status === 200 });
  sleep(1 + Math.random() * 2);

  // переключил категорию и площадку
  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  get(`/api/orders?category=${category}&platform=TIKTOK`, 'catalog filtered');
  sleep(1 + Math.random() * 2);

  // открыл пару заказов
  const items = list.status === 200 ? list.json('items') : [];
  for (let i = 0; i < 2 && items.length; i++) {
    const order = items[Math.floor(Math.random() * items.length)];
    check(get(`/api/orders/${order.id}`, 'order'), { order: (r) => r.status === 200 });
    sleep(2 + Math.random() * 3);
  }

  // иногда откликается — запись под блокировкой заказа; 403 «уже в работе» — нормальный ответ
  if (items.length && Math.random() < 0.2) {
    const order = items[Math.floor(Math.random() * items.length)];
    const r = http.post(`${BASE}/api/orders/${order.id}/claim`, null, {
      headers,
      tags: { name: 'claim' },
      // 403 — бизнес-отказ, а не сбой: в http_req_failed не считаем
      responseCallback: http.expectedStatuses(201, 403),
    });
    check(r, { claim: (res) => res.status === 201 || res.status === 403 });
  }

  check(get('/api/submissions', 'my submissions'), { submissions: (r) => r.status === 200 });
  sleep(3 + Math.random() * 5);
}
