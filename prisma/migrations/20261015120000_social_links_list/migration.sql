-- Ссылки на соцсети: вместо поля на каждую площадку — список (несколько аккаунтов на площадке).
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "socialLinks" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Перенос уже указанных ссылок в список, пустые — пропускаем
UPDATE "User" SET "socialLinks" = array_remove(
  ARRAY["tiktokUrl", "youtubeUrl", "vkUrl", "instagramUrl", "xUrl"], NULL
);

-- AlterTable
ALTER TABLE "User" DROP COLUMN "instagramUrl",
DROP COLUMN "tiktokUrl",
DROP COLUMN "vkUrl",
DROP COLUMN "xUrl",
DROP COLUMN "youtubeUrl";
