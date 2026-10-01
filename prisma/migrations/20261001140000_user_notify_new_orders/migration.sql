-- Переключатель сообщений о новых заказах; по умолчанию включено.
ALTER TABLE "User" ADD COLUMN "notifyNewOrders" BOOLEAN NOT NULL DEFAULT true;
