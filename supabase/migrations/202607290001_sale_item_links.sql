-- Normaliza somente o tipo que pode ser inferido sem inventar vínculos.
UPDATE "SaleItem"
SET "itemType" = 'SERVICE'
WHERE "productId" IS NULL
  AND "serviceId" IS NOT NULL
  AND "itemType" <> 'SERVICE';

UPDATE "SaleItem"
SET "itemType" = 'PRODUCT'
WHERE "serviceId" IS NULL
  AND "productId" IS NOT NULL
  AND "itemType" <> 'PRODUCT';

DO $$
DECLARE
  inconsistent_count integer;
BEGIN
  SELECT count(*) INTO inconsistent_count
  FROM "SaleItem"
  WHERE ("productId" IS NULL AND "serviceId" IS NULL)
     OR ("productId" IS NOT NULL AND "serviceId" IS NOT NULL);

  IF inconsistent_count > 0 THEN
    RAISE WARNING 'Existem % SaleItem(s) inconsistentes sem vínculo único; os registros foram preservados para revisão administrativa.', inconsistent_count;
  END IF;
END $$;

ALTER TABLE "SaleItem"
  DROP CONSTRAINT IF EXISTS "SaleItem_valid_item_link";

-- NOT VALID preserva registros legados inconsistentes, mas bloqueia novos dados inválidos.
ALTER TABLE "SaleItem"
  ADD CONSTRAINT "SaleItem_valid_item_link"
  CHECK (
    ("itemType" = 'PRODUCT' AND "productId" IS NOT NULL AND "serviceId" IS NULL)
    OR
    ("itemType" = 'SERVICE' AND "serviceId" IS NOT NULL AND "productId" IS NULL)
  ) NOT VALID;
