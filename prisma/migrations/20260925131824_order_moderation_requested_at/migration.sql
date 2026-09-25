-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "moderationRequestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- У существующих заказов на проверку их отправили при создании.
UPDATE "Order" SET "moderationRequestedAt" = "createdAt";
