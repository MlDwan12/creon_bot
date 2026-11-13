-- AlterEnum
ALTER TYPE "ModeratorActionType" ADD VALUE 'USER_ERASE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "erasedAt" TIMESTAMP(3);
