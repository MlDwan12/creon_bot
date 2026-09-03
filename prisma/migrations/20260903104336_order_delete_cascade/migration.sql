-- DropForeignKey
ALTER TABLE "Submission" DROP CONSTRAINT "Submission_orderId_fkey";

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
