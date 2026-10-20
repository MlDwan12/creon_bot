-- Заморозка опубликованного заказа на время правки: отклонённая правка, начало правки, прежние условия.
-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'EDIT_REJECTED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "prevTerms" JSONB;

-- Изменённые опубликованные заказы, уже ждущие модератора, — заморожены с момента правки
UPDATE "Order" SET "editedAt" = "moderationRequestedAt"
WHERE "status" = 'PENDING_MODERATION' AND "cpmMinor" IS NOT NULL;
