DO $$ BEGIN
  CREATE TYPE "FinancialAccountType" AS ENUM ('CASH_DRAWER','CHECKING_ACCOUNT','SAVINGS_ACCOUNT','DIGITAL_ACCOUNT','PAYMENT_WALLET','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "FinancialPaymentType" AS ENUM ('CASH','PIX','DEBIT_CARD','CREDIT_CARD','BANK_TRANSFER','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "SettlementDayType" AS ENUM ('CALENDAR','BUSINESS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "FinancialAccount" (
  "id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "type" "FinancialAccountType" NOT NULL, "institutionName" TEXT, "agency" TEXT,
  "accountNumber" TEXT, "internalIdentifier" TEXT,
  "openingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0, "openingBalanceDate" TIMESTAMP(3) NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false, "active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT, "createdById" TEXT, "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FinancialAccount_companyId_name_key" ON "FinancialAccount"("companyId","name");
CREATE INDEX IF NOT EXISTS "FinancialAccount_companyId_active_idx" ON "FinancialAccount"("companyId","active");

CREATE TABLE IF NOT EXISTS "FinancialPaymentMethod" (
  "id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "type" "FinancialPaymentType" NOT NULL, "institutionName" TEXT, "destinationAccountId" TEXT NOT NULL,
  "defaultFeePercentage" DECIMAL(7,4) NOT NULL DEFAULT 0, "fixedFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "settlementDays" INTEGER NOT NULL DEFAULT 0, "settlementDayType" "SettlementDayType" NOT NULL DEFAULT 'CALENDAR',
  "maxInstallments" INTEGER NOT NULL DEFAULT 1, "requiresNsu" BOOLEAN NOT NULL DEFAULT false,
  "requiresReceiptCode" BOOLEAN NOT NULL DEFAULT false, "active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialPaymentMethod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id"),
  CONSTRAINT "FinancialPaymentMethod_destinationAccountId_fkey" FOREIGN KEY ("destinationAccountId") REFERENCES "FinancialAccount"("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FinancialPaymentMethod_companyId_name_key" ON "FinancialPaymentMethod"("companyId","name");
CREATE INDEX IF NOT EXISTS "FinancialPaymentMethod_companyId_active_type_idx" ON "FinancialPaymentMethod"("companyId","active","type");

CREATE TABLE IF NOT EXISTS "PaymentMethodBrand" (
  "id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "paymentMethodId" TEXT NOT NULL,
  "brandName" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "PaymentMethodBrand_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id"),
  CONSTRAINT "PaymentMethodBrand_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "FinancialPaymentMethod"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentMethodBrand_paymentMethodId_brandName_key" ON "PaymentMethodBrand"("paymentMethodId","brandName");
CREATE INDEX IF NOT EXISTS "PaymentMethodBrand_companyId_paymentMethodId_idx" ON "PaymentMethodBrand"("companyId","paymentMethodId");

CREATE TABLE IF NOT EXISTS "PaymentFeeRule" (
  "id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "paymentMethodId" TEXT NOT NULL, "cardBrandId" TEXT,
  "installments" INTEGER, "feePercentage" DECIMAL(7,4) NOT NULL DEFAULT 0, "fixedFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "settlementDays" INTEGER NOT NULL DEFAULT 0, "settlementDayType" "SettlementDayType" NOT NULL DEFAULT 'CALENDAR',
  "effectiveFrom" TIMESTAMP(3) NOT NULL, "effectiveUntil" TIMESTAMP(3), "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentFeeRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id"),
  CONSTRAINT "PaymentFeeRule_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "FinancialPaymentMethod"("id") ON DELETE CASCADE,
  CONSTRAINT "PaymentFeeRule_cardBrandId_fkey" FOREIGN KEY ("cardBrandId") REFERENCES "PaymentMethodBrand"("id")
);
CREATE INDEX IF NOT EXISTS "PaymentFeeRule_companyId_paymentMethodId_active_idx" ON "PaymentFeeRule"("companyId","paymentMethodId","active");
CREATE INDEX IF NOT EXISTS "PaymentFeeRule_paymentMethodId_installments_effectiveFrom_idx" ON "PaymentFeeRule"("paymentMethodId","installments","effectiveFrom");

ALTER TABLE "SalePayment" ADD COLUMN IF NOT EXISTS "financialPaymentMethodId" TEXT;
ALTER TABLE "SalePayment" ADD COLUMN IF NOT EXISTS "paymentMethodNameSnapshot" TEXT;
ALTER TABLE "SalePayment" ADD COLUMN IF NOT EXISTS "paymentTypeSnapshot" TEXT;
ALTER TABLE "SalePayment" ADD COLUMN IF NOT EXISTS "institutionNameSnapshot" TEXT;
ALTER TABLE "SalePayment" ADD COLUMN IF NOT EXISTS "destinationAccountId" TEXT;
ALTER TABLE "SalePayment" ADD COLUMN IF NOT EXISTS "grossAmount" DECIMAL(10,2);
ALTER TABLE "SalePayment" ADD COLUMN IF NOT EXISTS "feePercentageSnapshot" DECIMAL(7,4);
ALTER TABLE "SalePayment" ADD COLUMN IF NOT EXISTS "fixedFeeSnapshot" DECIMAL(10,2);
ALTER TABLE "SalePayment" ADD COLUMN IF NOT EXISTS "feeAmount" DECIMAL(10,2);
ALTER TABLE "SalePayment" ADD COLUMN IF NOT EXISTS "netAmount" DECIMAL(10,2);
ALTER TABLE "SalePayment" ADD COLUMN IF NOT EXISTS "settlementDaysSnapshot" INTEGER;
ALTER TABLE "SalePayment" ADD COLUMN IF NOT EXISTS "expectedSettlementDate" TIMESTAMP(3);
ALTER TABLE "SalePayment" ADD COLUMN IF NOT EXISTS "cardBrandSnapshot" TEXT;

DO $$ BEGIN ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_financialPaymentMethodId_fkey" FOREIGN KEY ("financialPaymentMethodId") REFERENCES "FinancialPaymentMethod"("id"); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_destinationAccountId_fkey" FOREIGN KEY ("destinationAccountId") REFERENCES "FinancialAccount"("id"); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "SalePayment_companyId_expectedSettlementDate_idx" ON "SalePayment"("companyId","expectedSettlementDate");
CREATE INDEX IF NOT EXISTS "SalePayment_companyId_destinationAccountId_idx" ON "SalePayment"("companyId","destinationAccountId");
