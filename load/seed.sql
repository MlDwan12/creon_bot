-- 300 открытых заказов для нагрузочного теста — только в локальной базе, не в проде.
--   docker compose exec -T db psql -U creon -d creon_bot < load/seed.sql
-- Убрать: load/cleanup.sql.
WITH adv AS (
  INSERT INTO "User" ("telegramId", "firstName")
  VALUES (990000000000, 'Нагрузка: рекламодатель')
  ON CONFLICT ("telegramId") DO UPDATE SET "firstName" = EXCLUDED."firstName"
  RETURNING id
)
INSERT INTO "Order" (
  "advertiserId", title, description, "budgetMinor", "feePercent", "cpmMinor",
  status, category, platforms
)
SELECT
  adv.id,
  'Нагрузка #' || g,
  'Тестовый заказ для нагрузочного теста: снять короткий ролик с товаром',
  5000000, 20, 10000, 'OPEN',
  (ARRAY['FOOD', 'TECH', 'BEAUTY', 'OTHER'])[1 + g % 4]::"OrderCategory",
  CASE WHEN g % 3 = 0 THEN ARRAY['TIKTOK']::"VideoPlatform"[] ELSE ARRAY[]::"VideoPlatform"[] END
FROM adv, generate_series(1, 300) g;
