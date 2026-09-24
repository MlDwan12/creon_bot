-- Напоминание креаторам о близком сроке — один раз на каждый срок.
ALTER TABLE "Order" ADD COLUMN "deadlineReminderSentAt" TIMESTAMP(3);
