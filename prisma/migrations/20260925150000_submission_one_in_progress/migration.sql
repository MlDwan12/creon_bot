-- Один отклик «в работе» на креатора и заказ: дубль (двойной тап) отсекает база, а не Serializable.
-- CreateIndex
CREATE UNIQUE INDEX "Submission_one_in_progress" ON "Submission"("orderId", "creatorId") WHERE ("status" = 'IN_PROGRESS');
