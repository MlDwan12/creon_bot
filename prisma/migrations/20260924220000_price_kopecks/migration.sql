-- Деньги храним в копейках: у комиссий и выплат будут дробные рубли. В API — по-прежнему рубли.
ALTER TABLE "Order" RENAME COLUMN "price" TO "priceKopecks";
UPDATE "Order" SET "priceKopecks" = "priceKopecks" * 100 WHERE "priceKopecks" IS NOT NULL;
