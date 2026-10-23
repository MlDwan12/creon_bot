-- Условия заказа при сдаче ролика: по ним проверяют и оплачивают, сколько бы раз заказ ни правили
ALTER TABLE "Submission" ADD COLUMN "terms" JSONB;

-- Сданные до правки — снимок до неё (как раньше считал videoTerms): следующая правка его больше не затрёт
UPDATE "Submission" s
SET "terms" = o."prevTerms"
FROM "Order" o
WHERE s."orderId" = o.id
  AND o."prevTerms" IS NOT NULL
  AND o."editedAt" IS NOT NULL
  AND s."submittedAt" < o."editedAt";

-- Группа поддержки, в которой создана тема пользователя: номер темы уникален только внутри группы.
-- Существующие темы привязывает к текущему SUPPORT_CHAT_ID SupportService при старте.
ALTER TABLE "User" ADD COLUMN "supportChatId" TEXT;

DROP INDEX "User_supportTopicId_idx";
CREATE INDEX "User_supportChatId_supportTopicId_idx" ON "User"("supportChatId", "supportTopicId");
