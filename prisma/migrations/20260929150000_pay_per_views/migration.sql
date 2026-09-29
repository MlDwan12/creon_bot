-- Переход на оплату за просмотры: бюджет и CPM вместо цены за видео, решение по ролику — за модератором.

CREATE TYPE "Currency" AS ENUM ('RUB', 'USD', 'USDT');

-- Старые заказы с ценой за видео не дорабатываются: активные закрываем, бюджета у них нет (0).
UPDATE "Order" SET "status" = 'CLOSED', "closedAt" = NOW()
WHERE "status" IN ('PENDING_MODERATION', 'OPEN');

ALTER TABLE "Order" DROP COLUMN "priceKopecks",
DROP COLUMN "videosNeeded",
ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'RUB',
ADD COLUMN "budgetMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "feePercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "cpmMinor" INTEGER,
ADD COLUMN "minViews" INTEGER NOT NULL DEFAULT 250;
ALTER TABLE "Order" ALTER COLUMN "budgetMinor" DROP DEFAULT,
ALTER COLUMN "feePercent" DROP DEFAULT;

-- Приёмки рекламодателем больше нет: принятое им — одобрено, отклонённое им — отклонено.
-- Работа по старым заказам, которая ещё не решена, снимается.
UPDATE "Submission" SET "status" = 'MODERATOR_APPROVED' WHERE "status" = 'ADVERTISER_APPROVED';
UPDATE "Submission" SET "status" = 'MODERATOR_REJECTED', "moderatorComment" = COALESCE("advertiserComment", 'Отклонено рекламодателем')
WHERE "status" = 'ADVERTISER_REJECTED';
UPDATE "Submission" SET "status" = 'MODERATOR_REJECTED', "moderatorComment" = 'Заказ закрыт: площадка перешла на оплату за просмотры', "decidedAt" = NOW()
WHERE "status" IN ('IN_PROGRESS', 'SUBMITTED');

ALTER TABLE "Submission" DROP COLUMN "advertiserComment",
ADD COLUMN "views" INTEGER,
ADD COLUMN "payoutMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "finalizedAt" TIMESTAMP(3);

-- Убрать ADVERTISER_* из SubmissionStatus: Postgres не удаляет значения enum — пересоздаём тип.
-- Частичный индекс сравнивает status со старым типом — снимаем его и создаём заново.
DROP INDEX "Submission_one_in_progress";
CREATE TYPE "SubmissionStatus_new" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'MODERATOR_APPROVED', 'MODERATOR_REJECTED', 'SLOT_EXPIRED');
ALTER TABLE "Submission" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Submission" ALTER COLUMN "status" TYPE "SubmissionStatus_new" USING ("status"::text::"SubmissionStatus_new");
ALTER TYPE "SubmissionStatus" RENAME TO "SubmissionStatus_old";
ALTER TYPE "SubmissionStatus_new" RENAME TO "SubmissionStatus";
DROP TYPE "SubmissionStatus_old";
ALTER TABLE "Submission" ALTER COLUMN "status" SET DEFAULT 'IN_PROGRESS';
CREATE UNIQUE INDEX "Submission_one_in_progress" ON "Submission"("orderId", "creatorId") WHERE ("status" = 'IN_PROGRESS');
