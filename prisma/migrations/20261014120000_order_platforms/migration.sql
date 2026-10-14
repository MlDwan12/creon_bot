-- CreateEnum
CREATE TYPE "VideoPlatform" AS ENUM ('TIKTOK', 'YOUTUBE', 'VK', 'INSTAGRAM', 'X');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "platforms" "VideoPlatform"[] DEFAULT ARRAY[]::"VideoPlatform"[];
