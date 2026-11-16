-- CreateIndex
CREATE INDEX "ErrorItem_userId_subjectId_createdAt_idx" ON "ErrorItem"("userId", "subjectId", "createdAt");
