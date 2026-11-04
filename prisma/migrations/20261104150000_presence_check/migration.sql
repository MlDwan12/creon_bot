-- Проверка «публикация на месте» во время холда по API площадки.
-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "goneAt" TIMESTAMP(3),
ADD COLUMN     "presenceCheckedAt" TIMESTAMP(3);
