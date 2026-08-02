ALTER TABLE "SalePayment"
  ADD COLUMN IF NOT EXISTS "pixReference" TEXT,
  ADD COLUMN IF NOT EXISTS "cashReceived" DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS "changeAmount" DECIMAL(10, 2);

UPDATE "SalePayment"
SET "pixReference" = "cardNsu"
WHERE "method" = 'PIX'
  AND "pixReference" IS NULL
  AND "cardNsu" IS NOT NULL;

ALTER TABLE "SalePayment"
  DROP CONSTRAINT IF EXISTS "SalePayment_card_receipt_required";

ALTER TABLE "SalePayment"
  ADD CONSTRAINT "SalePayment_card_receipt_required"
  CHECK (
    "method" NOT IN ('DEBIT', 'CREDIT')
    OR (
      NULLIF(BTRIM("cardBrand"), '') IS NOT NULL
      AND NULLIF(BTRIM("cardNsu"), '') IS NOT NULL
      AND ("method" <> 'CREDIT' OR "installments" BETWEEN 1 AND 12)
    )
  ) NOT VALID;
