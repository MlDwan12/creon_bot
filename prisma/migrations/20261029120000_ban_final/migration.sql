-- Бан без права обжалования. Прежние баны — обычные (с обжалованием через поддержку).
ALTER TABLE "User" ADD COLUMN     "banFinal" BOOLEAN NOT NULL DEFAULT false;
