-- Заказ, закрытый по истечении срока (отдельно от ручного CLOSED: его можно продлить).
ALTER TYPE "OrderStatus" ADD VALUE 'EXPIRED';
