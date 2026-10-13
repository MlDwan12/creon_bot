-- Премодерация отзывов: отзыв с текстом виден в профиле креатора только после проверки модератором.
-- Уже опубликованные отзывы остаются (reviewQueuedAt = NULL).
-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "reviewQueuedAt" TIMESTAMP(3);
