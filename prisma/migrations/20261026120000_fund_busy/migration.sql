-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "fundBusyAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "agreedPayoutMinor" INTEGER;
