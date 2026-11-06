-- История просмотров ролика: снимки при сдаче, одобрении, проверках во время холда и итоге —
-- модератору сигналы накрутки. У старых роликов истории нет.
-- CreateEnum
CREATE TYPE "ViewSnapshotSource" AS ENUM ('SUBMIT', 'APPROVE', 'CHECK', 'FINAL');

-- CreateTable
CREATE TABLE "ViewSnapshot" (
    "id" SERIAL NOT NULL,
    "submissionId" INTEGER NOT NULL,
    "views" INTEGER NOT NULL,
    "likes" INTEGER,
    "source" "ViewSnapshotSource" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViewSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ViewSnapshot_submissionId_at_idx" ON "ViewSnapshot"("submissionId", "at");

-- AddForeignKey
ALTER TABLE "ViewSnapshot" ADD CONSTRAINT "ViewSnapshot_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
