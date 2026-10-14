-- AlterEnum
ALTER TYPE "SocialPlatform" ADD VALUE 'INSTAGRAM';

-- DropIndex
DROP INDEX "SocialAccount_userId_platform_key";

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "label" TEXT;

-- CreateIndex
CREATE INDEX "SocialAccount_userId_platform_idx" ON "SocialAccount"("userId", "platform");
