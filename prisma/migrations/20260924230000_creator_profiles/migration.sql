-- Профили креаторов: ссылки на соцсети, оценка и отзыв рекламодателя при приёмке видео, согласие на портфолио.
ALTER TABLE "User" ADD COLUMN "tiktokUrl" TEXT;
ALTER TABLE "User" ADD COLUMN "youtubeUrl" TEXT;
ALTER TABLE "User" ADD COLUMN "vkUrl" TEXT;

ALTER TABLE "Submission" ADD COLUMN "rating" INTEGER;
ALTER TABLE "Submission" ADD COLUMN "review" TEXT;
ALTER TABLE "Submission" ADD COLUMN "portfolioAllowed" BOOLEAN NOT NULL DEFAULT false;
