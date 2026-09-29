-- Требования к ролику в заказе: длительность в секундах и ориентация; null — любая.
CREATE TYPE "VideoOrientation" AS ENUM ('VERTICAL', 'HORIZONTAL');

ALTER TABLE "Order" ADD COLUMN "minDurationSec" INTEGER,
ADD COLUMN "maxDurationSec" INTEGER,
ADD COLUMN "orientation" "VideoOrientation";
