-- Один ролик — одна оплата: ключ ссылки и запрет сдать тот же ролик второй раз.
-- У старых откликов ключа нет (NULL) — индекс их не сравнивает.
ALTER TABLE "Submission" ADD COLUMN "videoKey" TEXT;

CREATE UNIQUE INDEX "Submission_video_once" ON "Submission"("videoKey") WHERE ("status" IN ('SUBMITTED', 'MODERATOR_APPROVED'));
