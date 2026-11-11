-- Подтверждение аккаунтов соцсетей кодом в описании: креатор добавляет код, модератор сверяет.
-- CreateEnum
CREATE TYPE "LinkVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'NO_CODE');

-- AlterEnum

ALTER TYPE "ModeratorActionType" ADD VALUE 'LINK_VERIFY';
ALTER TYPE "ModeratorActionType" ADD VALUE 'LINK_NO_CODE';

-- CreateTable
CREATE TABLE "LinkVerification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "LinkVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "moderatorId" BIGINT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LinkVerification_userId_idx" ON "LinkVerification"("userId");

-- CreateIndex
CREATE INDEX "LinkVerification_status_idx" ON "LinkVerification"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LinkVerification_one_pending" ON "LinkVerification"("userId", "url") WHERE ("status" = 'PENDING');

-- AddForeignKey
ALTER TABLE "LinkVerification" ADD CONSTRAINT "LinkVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

