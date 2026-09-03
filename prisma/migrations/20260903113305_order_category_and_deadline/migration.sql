-- CreateEnum
CREATE TYPE "OrderCategory" AS ENUM ('PRODUCT_REVIEW', 'BEAUTY', 'FOOD', 'FASHION', 'GAMING', 'FITNESS', 'ENTERTAINMENT', 'TECH', 'OTHER');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "category" "OrderCategory" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "deadline" TIMESTAMP(3);
