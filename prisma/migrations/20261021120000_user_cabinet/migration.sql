-- Кабинет мини-аппа, открытый последним: креатор или заказчик (только вкладки, прав не даёт).
-- CreateEnum
CREATE TYPE "Cabinet" AS ENUM ('CREATOR', 'ADVERTISER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "cabinet" "Cabinet";
