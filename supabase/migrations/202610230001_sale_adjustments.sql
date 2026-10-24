-- Audit trail for changes made after an order has been finalized.  The table
-- is deliberately append-only: an adjustment never replaces the original sale.
DO $$ BEGIN
  CREATE TYPE "SaleAdjustmentType" AS ENUM ('PAYMENT_ADJUSTMENT', 'CANCELLATION', 'REFUND_CONFIRMATION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RefundStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'CONFIRMED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SaleAdjustment" (
  "id" TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE,
  "saleId" TEXT NOT NULL REFERENCES "Sale"("id") ON DELETE RESTRICT,
  "originalCashSessionId" TEXT,
  "performedCashSessionId" TEXT,
  "type" "SaleAdjustmentType" NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "justification" TEXT NOT NULL,
  "cancellationReason" TEXT,
  "previousPayments" JSONB,
  "newPayments" JSONB,
  "refundStatus" "RefundStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
  "refundAmount" DECIMAL(10,2),
  "refundMethod" "PaymentMethod",
  "refundDate" TIMESTAMPTZ,
  "refundResponsibleId" TEXT,
  "refundResponsibleName" TEXT,
  "proofPath" TEXT,
  "proofFileName" TEXT,
  "proofMimeType" TEXT,
  "performedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "performedByName" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "SaleAdjustment_proof_type_check" CHECK ("proofMimeType" IS NULL OR "proofMimeType" IN ('application/pdf', 'image/jpeg', 'image/png')),
  CONSTRAINT "SaleAdjustment_refund_amount_check" CHECK ("refundAmount" IS NULL OR "refundAmount" >= 0)
);

CREATE INDEX IF NOT EXISTS "SaleAdjustment_companyId_saleId_createdAt_idx" ON "SaleAdjustment"("companyId", "saleId", "createdAt");
CREATE INDEX IF NOT EXISTS "SaleAdjustment_companyId_originalCashSessionId_createdAt_idx" ON "SaleAdjustment"("companyId", "originalCashSessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "SaleAdjustment_companyId_performedCashSessionId_createdAt_idx" ON "SaleAdjustment"("companyId", "performedCashSessionId", "createdAt");

-- Application code has no update/delete path.  This trigger also protects the
-- ledger if a future endpoint accidentally attempts to mutate the audit row.
CREATE OR REPLACE FUNCTION prevent_sale_adjustment_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sale adjustments are immutable';
END;
$$;

DROP TRIGGER IF EXISTS sale_adjustment_immutable ON "SaleAdjustment";
CREATE TRIGGER sale_adjustment_immutable
  BEFORE UPDATE OR DELETE ON "SaleAdjustment"
  FOR EACH ROW EXECUTE FUNCTION prevent_sale_adjustment_mutation();

-- The API uploads through the service role; objects are never public and a
-- stored path is only exposed in the authorized order history.
INSERT INTO storage.buckets (id, name, public)
VALUES ('order-refund-proofs', 'order-refund-proofs', false)
ON CONFLICT (id) DO UPDATE SET public = false;
