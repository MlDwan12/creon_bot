-- Учёт продаж на сайтах рекламодателей убран: метрики — только по данным площадки.
-- DropForeignKey
ALTER TABLE "Conversion" DROP CONSTRAINT "Conversion_submissionId_fkey";

-- DropTable
DROP TABLE "Conversion";

