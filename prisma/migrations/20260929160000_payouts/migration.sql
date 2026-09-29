-- Заявки креаторов на вывод начисленного за ролики.
CREATE TYPE "PayoutStatus" AS ENUM ('REQUESTED', 'PAID', 'REJECTED');

CREATE TABLE "Payout" (
    "id" SERIAL NOT NULL,
    "creatorId" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'RUB',
    "amountMinor" INTEGER NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "comment" TEXT,
    "moderatorId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Payout_creatorId_idx" ON "Payout"("creatorId");
CREATE INDEX "Payout_status_createdAt_idx" ON "Payout"("status", "createdAt");
-- Одна открытая заявка на креатора: вторую (двойной тап) не пустит сама база.
CREATE UNIQUE INDEX "Payout_one_requested" ON "Payout"("creatorId") WHERE ("status" = 'REQUESTED');

ALTER TABLE "Payout" ADD CONSTRAINT "Payout_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
