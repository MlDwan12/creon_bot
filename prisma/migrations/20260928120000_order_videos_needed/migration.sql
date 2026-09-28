-- Сколько видео нужно по заказу; null — без лимита.
ALTER TABLE "Order" ADD COLUMN "videosNeeded" INTEGER;
