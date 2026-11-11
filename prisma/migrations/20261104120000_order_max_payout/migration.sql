-- Лимит выплаты за один ролик (по желанию заказчика); у старых заказов лимита нет.
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "maxPayoutMinor" INTEGER;
