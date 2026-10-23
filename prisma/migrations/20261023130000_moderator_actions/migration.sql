-- CreateEnum
CREATE TYPE "ModeratorActionType" AS ENUM ('ORDER_APPROVE', 'ORDER_REJECT', 'VIDEO_APPROVE', 'VIDEO_REJECT', 'HOLD_FINALIZE', 'PUBLICATION_DELETED', 'REVIEW_APPROVE', 'REVIEW_REMOVE', 'REPORT_ACTION', 'REPORT_DISMISS', 'PAYOUT_PAID', 'PAYOUT_REJECT', 'USER_BAN', 'USER_UNBAN');

-- CreateTable
CREATE TABLE "ModeratorAction" (
    "id" SERIAL NOT NULL,
    "moderatorId" BIGINT NOT NULL,
    "type" "ModeratorActionType" NOT NULL,
    "objectId" INTEGER NOT NULL,
    "reportTarget" "ReportTarget",
    "amountMinor" INTEGER,
    "waitedSec" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModeratorAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModeratorAction_moderatorId_createdAt_idx" ON "ModeratorAction"("moderatorId", "createdAt");

-- CreateIndex
CREATE INDEX "ModeratorAction_createdAt_idx" ON "ModeratorAction"("createdAt");

-- Перенос решений, которые уже записаны в самих объектах. Сохранилось только последнее решение
-- по каждому объекту; итоги холда и проверка отзывов раньше не записывались вовсе.
INSERT INTO "ModeratorAction" ("moderatorId", "type", "objectId", "amountMinor", "waitedSec", "createdAt")
SELECT "moderatorId",
       CASE WHEN "status" IN ('REJECTED', 'EDIT_REJECTED') THEN 'ORDER_REJECT' ELSE 'ORDER_APPROVE' END::"ModeratorActionType",
       "id", "budgetMinor",
       CASE WHEN "decidedAt" >= "moderationRequestedAt"
            THEN EXTRACT(EPOCH FROM "decidedAt" - "moderationRequestedAt")::int END,
       "decidedAt"
FROM "Order"
WHERE "moderatorId" IS NOT NULL AND "decidedAt" IS NOT NULL;

INSERT INTO "ModeratorAction" ("moderatorId", "type", "objectId", "amountMinor", "waitedSec", "createdAt")
SELECT "moderatorId",
       CASE WHEN "status" = 'MODERATOR_APPROVED' THEN 'VIDEO_APPROVE' ELSE 'VIDEO_REJECT' END::"ModeratorActionType",
       "id",
       CASE WHEN "status" = 'MODERATOR_APPROVED' THEN "payoutMinor" END,
       CASE WHEN "submittedAt" IS NOT NULL AND "decidedAt" >= "submittedAt"
            THEN EXTRACT(EPOCH FROM "decidedAt" - "submittedAt")::int END,
       "decidedAt"
FROM "Submission"
WHERE "moderatorId" IS NOT NULL AND "decidedAt" IS NOT NULL
  AND "status" IN ('MODERATOR_APPROVED', 'MODERATOR_REJECTED');

-- жалобы на один объект решаются разом — одна строка на решение
INSERT INTO "ModeratorAction" ("moderatorId", "type", "objectId", "reportTarget", "waitedSec", "createdAt")
SELECT "moderatorId",
       CASE WHEN "status" = 'ACTIONED' THEN 'REPORT_ACTION' ELSE 'REPORT_DISMISS' END::"ModeratorActionType",
       "targetId", "target",
       EXTRACT(EPOCH FROM "decidedAt" - MIN("createdAt"))::int,
       "decidedAt"
FROM "Report"
WHERE "moderatorId" IS NOT NULL AND "decidedAt" IS NOT NULL
GROUP BY "moderatorId", "status", "target", "targetId", "decidedAt";

INSERT INTO "ModeratorAction" ("moderatorId", "type", "objectId", "amountMinor", "waitedSec", "createdAt")
SELECT "moderatorId",
       CASE WHEN "status" = 'PAID' THEN 'PAYOUT_PAID' ELSE 'PAYOUT_REJECT' END::"ModeratorActionType",
       "id", "amountMinor",
       EXTRACT(EPOCH FROM "decidedAt" - "createdAt")::int,
       "decidedAt"
FROM "Payout"
WHERE "moderatorId" IS NOT NULL AND "decidedAt" IS NOT NULL AND "status" IN ('PAID', 'REJECTED');
