-- Очередь уведомлений в Postgres вместо очереди в памяти процесса: переживает рестарт, повторяет при 429.
-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "chatId" BIGINT NOT NULL,
    "text" TEXT NOT NULL,
    "html" BOOLEAN NOT NULL DEFAULT false,
    "path" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sendAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_priority_sendAfter_idx" ON "Notification"("priority", "sendAfter");

