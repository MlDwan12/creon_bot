-- Примеры роликов и ссылка в шапке профиля. Старые заказы — без примеров и без ссылки в шапке:
-- правило «минимум 3 примера» проверяется только при создании и правке (order-input).
ALTER TABLE "Order" ADD COLUMN     "exampleUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "linkInBio" BOOLEAN NOT NULL DEFAULT false;
