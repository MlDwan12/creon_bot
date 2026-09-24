-- Цена за видео — целые рубли вместо свободного текста (под будущую оплату через площадку).
-- Переносим только строки из одних цифр от 1 до 1 000 000 (как MAX_PRICE в коде; пробелы внутри
-- допустимы: «5 000»). Остальное — «5к», «от 3 до 7 тысяч», 0, больше лимита — NULL, «договорная»:
-- лучше без цены, чем с молча изменённой.
ALTER TABLE "Order" ALTER COLUMN "price" TYPE INTEGER USING (
  CASE
    WHEN regexp_replace("price", '\s', '', 'g') ~ '^[0-9]{1,7}$'
      AND regexp_replace("price", '\s', '', 'g')::integer BETWEEN 1 AND 1000000
      THEN regexp_replace("price", '\s', '', 'g')::integer
    ELSE NULL
  END
);
