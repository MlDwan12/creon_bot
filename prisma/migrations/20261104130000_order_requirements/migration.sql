-- Требования к ролику отдельными пунктами; у старых заказов — пусто.
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "requirements" TEXT[] DEFAULT ARRAY[]::TEXT[];
