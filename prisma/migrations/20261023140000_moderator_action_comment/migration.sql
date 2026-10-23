-- AlterTable
ALTER TABLE "ModeratorAction" ADD COLUMN "comment" TEXT;

-- Текущие блокировки — в историю пользователя: кто банил раньше, уже не узнать (moderatorId 0),
-- но когда и за что — видно.
INSERT INTO "ModeratorAction" ("moderatorId", "type", "objectId", "comment", "createdAt")
SELECT 0, 'USER_BAN', "id", "banReason", "bannedAt"
FROM "User"
WHERE "bannedAt" IS NOT NULL;
