-- Пункт «Прочитать урок» чек-листа «Старт» — на сервере, общий для мини-аппа и сайта.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lessonSeenAt" TIMESTAMP(3);
