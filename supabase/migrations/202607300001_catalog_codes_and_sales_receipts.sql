ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "catalogCode" INTEGER,
  ADD COLUMN IF NOT EXISTS "legacyInternalCode" INTEGER;

ALTER TABLE "Service"
  ADD COLUMN IF NOT EXISTS "catalogCode" INTEGER,
  ADD COLUMN IF NOT EXISTS "legacyInternalCode" INTEGER;

CREATE TABLE IF NOT EXISTS "CatalogItem" (
  "id" TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "Company"("id"),
  "catalogCode" INTEGER NOT NULL,
  "itemType" "SaleItemType" NOT NULL,
  "productId" TEXT UNIQUE REFERENCES "Product"("id"),
  "serviceId" TEXT UNIQUE REFERENCES "Service"("id"),
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "CatalogItem_companyId_catalogCode_key" UNIQUE ("companyId", "catalogCode"),
  CONSTRAINT "CatalogItem_valid_link" CHECK (
    ("itemType" = 'PRODUCT' AND "productId" IS NOT NULL AND "serviceId" IS NULL)
    OR
    ("itemType" = 'SERVICE' AND "serviceId" IS NOT NULL AND "productId" IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS "CatalogItem_companyId_itemType_idx"
  ON "CatalogItem" ("companyId", "itemType");

WITH combined AS (
  SELECT "companyId", "id", 'PRODUCT'::"SaleItemType" AS item_type, "createdAt"
  FROM "Product"
  UNION ALL
  SELECT "companyId", "id", 'SERVICE'::"SaleItemType", "createdAt"
  FROM "Service"
),
ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY "companyId" ORDER BY "createdAt", item_type, "id")::INTEGER AS new_code
  FROM combined
)
UPDATE "Product" p
SET "legacyInternalCode" = COALESCE(p."legacyInternalCode", p."internalCode"),
    "catalogCode" = r.new_code
FROM ranked r
WHERE r.item_type = 'PRODUCT' AND r."id" = p."id" AND p."catalogCode" IS NULL;

WITH combined AS (
  SELECT "companyId", "id", 'PRODUCT'::"SaleItemType" AS item_type, "createdAt"
  FROM "Product"
  UNION ALL
  SELECT "companyId", "id", 'SERVICE'::"SaleItemType", "createdAt"
  FROM "Service"
),
ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY "companyId" ORDER BY "createdAt", item_type, "id")::INTEGER AS new_code
  FROM combined
)
UPDATE "Service" s
SET "legacyInternalCode" = COALESCE(s."legacyInternalCode", s."internalCode"),
    "catalogCode" = r.new_code
FROM ranked r
WHERE r.item_type = 'SERVICE' AND r."id" = s."id" AND s."catalogCode" IS NULL;

INSERT INTO "CatalogItem" ("id", "companyId", "catalogCode", "itemType", "productId", "active", "createdAt", "updatedAt")
SELECT 'catalog-product-' || p."id", p."companyId", p."catalogCode", 'PRODUCT', p."id", p."active", p."createdAt", NOW()
FROM "Product" p
WHERE p."catalogCode" IS NOT NULL
ON CONFLICT ("productId") DO NOTHING;

INSERT INTO "CatalogItem" ("id", "companyId", "catalogCode", "itemType", "serviceId", "active", "createdAt", "updatedAt")
SELECT 'catalog-service-' || s."id", s."companyId", s."catalogCode", 'SERVICE', s."id", s."active", s."createdAt", NOW()
FROM "Service" s
WHERE s."catalogCode" IS NOT NULL
ON CONFLICT ("serviceId") DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS "Product_companyId_catalogCode_key" ON "Product" ("companyId", "catalogCode");
CREATE UNIQUE INDEX IF NOT EXISTS "Service_companyId_catalogCode_key" ON "Service" ("companyId", "catalogCode");

INSERT INTO "InternalCodeCounter" ("id", "companyId", "kind", "nextValue", "createdAt", "updatedAt")
SELECT 'counter-catalog-' || c."id", c."id", 'CATALOG_ITEM', COALESCE(MAX(ci."catalogCode"), 0) + 1, NOW(), NOW()
FROM "Company" c
LEFT JOIN "CatalogItem" ci ON ci."companyId" = c."id"
GROUP BY c."id"
ON CONFLICT ("companyId", "kind") DO UPDATE
SET "nextValue" = GREATEST("InternalCodeCounter"."nextValue", EXCLUDED."nextValue"),
    "updatedAt" = NOW();

CREATE TABLE IF NOT EXISTS "SalesReceipt" (
  "id" TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "Company"("id"),
  "receiptCode" INTEGER NOT NULL,
  "saleId" TEXT NOT NULL UNIQUE REFERENCES "Sale"("id"),
  "customerId" TEXT,
  "petId" TEXT,
  "cashSessionId" TEXT,
  "operatorId" TEXT,
  "companyNameSnapshot" TEXT NOT NULL,
  "companyDocumentSnapshot" TEXT,
  "companyAddressSnapshot" TEXT,
  "customerCodeSnapshot" INTEGER,
  "customerNameSnapshot" TEXT,
  "petNameSnapshot" TEXT,
  "operatorNameSnapshot" TEXT,
  "itemsSnapshot" JSONB NOT NULL,
  "paymentsSnapshot" JSONB NOT NULL,
  "subtotal" DECIMAL(10,2) NOT NULL,
  "discount" DECIMAL(10,2) NOT NULL,
  "total" DECIMAL(10,2) NOT NULL,
  "paidAmount" DECIMAL(10,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "issuedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "fiscalDocumentType" TEXT,
  "fiscalNumber" TEXT,
  "fiscalSeries" TEXT,
  "fiscalAccessKey" TEXT,
  "fiscalStatus" TEXT,
  "fiscalAuthorizedAt" TIMESTAMPTZ,
  "fiscalXmlUrl" TEXT,
  "fiscalPdfUrl" TEXT,
  CONSTRAINT "SalesReceipt_companyId_receiptCode_key" UNIQUE ("companyId", "receiptCode")
);

CREATE INDEX IF NOT EXISTS "SalesReceipt_companyId_issuedAt_idx"
  ON "SalesReceipt" ("companyId", "issuedAt");
