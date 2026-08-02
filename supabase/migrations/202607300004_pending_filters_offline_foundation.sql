ALTER TABLE "Sale"
  ADD COLUMN IF NOT EXISTS "expectedPaymentDate" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Sale_companyId_expectedPaymentDate_idx"
  ON "Sale" ("companyId", "expectedPaymentDate");

UPDATE "Sale"
SET "expectedPaymentDate" = TO_TIMESTAMP(
  (REGEXP_MATCH("pendingNotes", 'Previsão de pagamento:\s*(\d{2}/\d{2}/\d{4})'))[1],
  'DD/MM/YYYY'
)
WHERE "expectedPaymentDate" IS NULL
  AND "pendingNotes" ~ 'Previsão de pagamento:\s*\d{2}/\d{2}/\d{4}';

CREATE TABLE IF NOT EXISTS "SyncOperation" (
  "id" TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROCESSING',
  "result" JSONB,
  "errorCode" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "SyncOperation_companyId_idempotencyKey_key" UNIQUE ("companyId", "idempotencyKey")
);

CREATE INDEX IF NOT EXISTS "SyncOperation_companyId_status_receivedAt_idx"
  ON "SyncOperation" ("companyId", "status", "receivedAt");
