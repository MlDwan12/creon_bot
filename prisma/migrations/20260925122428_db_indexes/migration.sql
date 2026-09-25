-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_advertiserId_idx" ON "Order"("advertiserId");

-- CreateIndex
CREATE INDEX "Submission_orderId_idx" ON "Submission"("orderId");

-- CreateIndex
CREATE INDEX "Submission_creatorId_idx" ON "Submission"("creatorId");

-- CreateIndex
CREATE INDEX "Submission_status_submittedAt_idx" ON "Submission"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "User_supportTopicId_idx" ON "User"("supportTopicId");
