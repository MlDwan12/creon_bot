-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'PENDING_MODERATION';
ALTER TYPE "OrderStatus" ADD VALUE 'REJECTED';

-- AlterEnum
ALTER TYPE "SubmissionStatus" ADD VALUE 'IN_PROGRESS';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "moderatorComment" TEXT,
ADD COLUMN     "moderatorId" BIGINT,
ALTER COLUMN "status" SET DEFAULT 'PENDING_MODERATION';

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "submittedAt" TIMESTAMP(3),
ALTER COLUMN "videoUrl" DROP NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'IN_PROGRESS';
