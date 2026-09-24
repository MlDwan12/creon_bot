-- CreateTable
CREATE TABLE "BotSession" (
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "BotSession_pkey" PRIMARY KEY ("key")
);
