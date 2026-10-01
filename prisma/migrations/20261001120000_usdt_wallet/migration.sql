-- Деньги площадки — в USDT, выплаты — на кошелёк TRC20 из профиля.
ALTER TABLE "User" ADD COLUMN "payoutWallet" TEXT;
ALTER TABLE "Payout" ADD COLUMN "wallet" TEXT;
ALTER TABLE "Order" ALTER COLUMN "currency" SET DEFAULT 'USDT';
ALTER TABLE "Payout" ALTER COLUMN "currency" SET DEFAULT 'USDT';
