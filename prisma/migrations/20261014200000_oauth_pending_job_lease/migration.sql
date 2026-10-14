-- CreateTable
CREATE TABLE "OAuthPending" (
    "state" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "verifier" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthPending_pkey" PRIMARY KEY ("state")
);

-- CreateTable
CREATE TABLE "JobLease" (
    "name" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLease_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "OAuthPending_expiresAt_idx" ON "OAuthPending"("expiresAt");

-- AddForeignKey
ALTER TABLE "OAuthPending" ADD CONSTRAINT "OAuthPending_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
