-- Убрать всё, что создал нагрузочный тест: его пользователей (Telegram ID от 990 000 000 000),
-- их отклики и тестовые заказы (просмотры заказов удалятся каскадом).
--   docker compose exec -T db psql -U creon -d creon_bot < load/cleanup.sql
BEGIN;
DELETE FROM "Submission" WHERE "creatorId" IN (SELECT id FROM "User" WHERE "telegramId" >= 990000000000);
DELETE FROM "Order" WHERE "advertiserId" IN (SELECT id FROM "User" WHERE "telegramId" >= 990000000000);
DELETE FROM "User" WHERE "telegramId" >= 990000000000;
COMMIT;
