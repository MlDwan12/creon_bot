-- Публичный отчёт заказчика по ссылке, которую можно отозвать.
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shareToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_shareToken_key" ON "Order"("shareToken");
