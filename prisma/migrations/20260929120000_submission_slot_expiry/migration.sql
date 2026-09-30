-- Слот сгорел: видео не прислали за SLOT_DAYS дней после отклика.
ALTER TYPE "SubmissionStatus" ADD VALUE 'SLOT_EXPIRED';

-- Когда креатору напомнили, что слот скоро сгорит.
ALTER TABLE "Submission" ADD COLUMN "slotReminderSentAt" TIMESTAMP(3);
