-- Бюджет, одобренный модератором: повышение при правке он подтверждает отдельно.
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "approvedBudgetMinor" INTEGER;

-- Уже одобренные (ставка назначена) — истории нет, считаем одобренным текущий бюджет
UPDATE "Order" SET "approvedBudgetMinor" = "budgetMinor" WHERE "cpmMinor" IS NOT NULL;
