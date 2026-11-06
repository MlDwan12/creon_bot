-- CreateTable
CREATE TABLE "WebLogin" (
    "tokenHash" TEXT NOT NULL,
    "userId" INTEGER,
    "codeHash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebLogin_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateIndex
CREATE INDEX "WebLogin_expiresAt_idx" ON "WebLogin"("expiresAt");

-- AddForeignKey
ALTER TABLE "WebLogin" ADD CONSTRAINT "WebLogin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
