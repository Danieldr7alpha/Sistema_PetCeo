ALTER TABLE "Sale"
ADD COLUMN IF NOT EXISTS "pendingSince" TIMESTAMP(3);

UPDATE "Sale"
SET "pendingSince" = COALESCE("updatedAt", "createdAt")
WHERE "pendingSince" IS NULL
  AND "status" IN ('WAITING_PAYMENT', 'PENDING', 'PARTIALLY_PAID');

CREATE INDEX IF NOT EXISTS "Sale_companyId_status_pendingSince_idx"
ON "Sale" ("companyId", "status", "pendingSince");

CREATE INDEX IF NOT EXISTS "Sale_companyId_expectedPaymentDate_idx"
ON "Sale" ("companyId", "expectedPaymentDate");

CREATE INDEX IF NOT EXISTS "Sale_companyId_customerId_idx"
ON "Sale" ("companyId", "customerId");

CREATE INDEX IF NOT EXISTS "Sale_companyId_petId_idx"
ON "Sale" ("companyId", "petId");
