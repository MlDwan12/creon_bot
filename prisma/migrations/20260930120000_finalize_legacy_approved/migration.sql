-- Ролики, одобренные до оплаты за просмотры (заказ без ставки), попали в MODERATOR_APPROVED без
-- finalizedAt — очередь «Итоги» считала бы их ждущими добора. Доплачивать по ним нечего: итог — сейчас.
UPDATE "Submission" s SET "finalizedAt" = COALESCE(s."decidedAt", NOW())
FROM "Order" o
WHERE s."orderId" = o."id"
  AND o."cpmMinor" IS NULL
  AND s."status" = 'MODERATOR_APPROVED'
  AND s."finalizedAt" IS NULL;
