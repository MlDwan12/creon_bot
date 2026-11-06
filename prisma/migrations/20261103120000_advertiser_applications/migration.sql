-- Заявки «Стать заказчиком»: кабинет заказчика открывает модератор. Права ни у кого пока нет —
-- в проде заказчиков нет, на деве доступ снимается у всех (заказы остаются).
-- CreateEnum
CREATE TYPE "AdvertiserApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum


ALTER TYPE "ModeratorActionType" ADD VALUE 'ADVERTISER_OPEN';
ALTER TYPE "ModeratorActionType" ADD VALUE 'ADVERTISER_REJECT';
ALTER TYPE "ModeratorActionType" ADD VALUE 'ADVERTISER_CLOSE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "advertiserAt" TIMESTAMP(3),
ADD COLUMN     "advertiserClosedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AdvertiserApplication" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "status" "AdvertiserApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "moderatorId" BIGINT,
    "note" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvertiserApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdvertiserApplication_userId_id_idx" ON "AdvertiserApplication"("userId", "id");

-- CreateIndex
CREATE INDEX "AdvertiserApplication_status_idx" ON "AdvertiserApplication"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AdvertiserApplication_one_pending" ON "AdvertiserApplication"("userId") WHERE ("status" = 'PENDING');

-- AddForeignKey
ALTER TABLE "AdvertiserApplication" ADD CONSTRAINT "AdvertiserApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

