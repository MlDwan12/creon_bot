-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "targetUrl" TEXT;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "clicks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trackCode" TEXT;

-- Коды для уже существующих откликов: новым код ставит SubmissionsService.claim.
UPDATE "Submission" SET "trackCode" = substr(md5(random()::text || id::text), 1, 12);

-- CreateIndex
CREATE UNIQUE INDEX "Submission_trackCode_key" ON "Submission"("trackCode");

