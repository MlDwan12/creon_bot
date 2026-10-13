-- CreateTable
CREATE TABLE "Conversion" (
    "id" SERIAL NOT NULL,
    "submissionId" INTEGER NOT NULL,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Conversion_submissionId_externalId_key" ON "Conversion"("submissionId", "externalId");

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

