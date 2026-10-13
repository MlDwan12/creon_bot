-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "insightsSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OrderView" (
    "orderId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderView_pkey" PRIMARY KEY ("orderId","userId")
);

-- AddForeignKey
ALTER TABLE "OrderView" ADD CONSTRAINT "OrderView_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderView" ADD CONSTRAINT "OrderView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

