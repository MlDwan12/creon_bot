-- Когда кошелёк сменили на другой — модератору у заявки на вывод (src/moderation, payouts)
ALTER TABLE "User" ADD COLUMN "walletChangedAt" TIMESTAMP(3);
