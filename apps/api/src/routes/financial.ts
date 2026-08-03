import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { companyId, requireAdmin } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

export const financialRouter = Router();

async function ensureCashPaymentMethod(cid: string) {
  const existing = await prisma.financialPaymentMethod.findFirst({ where: { companyId: cid, type: "CASH" } });
  if (existing) {
    if (!existing.active) await prisma.financialPaymentMethod.update({ where: { id: existing.id }, data: { active: true } });
    return;
  }
  let account = await prisma.financialAccount.findFirst({ where: { companyId: cid, type: "CASH_DRAWER" }, orderBy: { createdAt: "asc" } });
  if (!account) account = await prisma.financialAccount.create({ data: { companyId: cid, name: "Caixa físico", type: "CASH_DRAWER", openingBalanceDate: new Date(), isPrimary: true } });
  await prisma.financialPaymentMethod.create({ data: { companyId: cid, name: "Dinheiro", type: "CASH", destinationAccountId: account.id, active: true } });
}

const accountSchema = z.object({
  name: z.string().trim().min(2),
  type: z.enum(["CASH_DRAWER", "CHECKING_ACCOUNT", "SAVINGS_ACCOUNT", "DIGITAL_ACCOUNT", "PAYMENT_WALLET", "OTHER"]),
  institutionName: z.string().trim().optional(),
  agency: z.string().trim().optional(),
  accountNumber: z.string().trim().optional(),
  internalIdentifier: z.string().trim().optional(),
  openingBalance: z.coerce.number().finite().default(0),
  openingBalanceDate: z.string().date(),
  isPrimary: z.boolean().default(false),
  active: z.boolean().default(true),
  notes: z.string().trim().optional()
});

const paymentMethodSchema = z.object({
  name: z.string().trim().min(2),
  type: z.enum(["CASH", "PIX", "DEBIT_CARD", "CREDIT_CARD", "BANK_TRANSFER", "OTHER"]),
  institutionName: z.string().trim().optional(),
  destinationAccountId: z.string().min(1),
  defaultFeePercentage: z.coerce.number().min(0).max(100).default(0),
  fixedFee: z.coerce.number().min(0).default(0),
  allowsAnticipation: z.boolean().default(false),
  anticipationFeePercentage: z.coerce.number().min(0).max(100).default(0),
  settlementDays: z.coerce.number().int().min(0).max(365).default(0),
  settlementDayType: z.enum(["CALENDAR", "BUSINESS"]).default("CALENDAR"),
  settlementContract: z.enum(["SCHEDULED", "SAME_DAY"]).default("SCHEDULED"),
  maxInstallments: z.coerce.number().int().min(1).max(24).default(1),
  requiresNsu: z.boolean().default(false),
  requiresReceiptCode: z.boolean().default(false),
  active: z.boolean().default(true),
  notes: z.string().trim().optional(),
  brands: z.array(z.string().trim().min(1)).default([])
});

const feeRuleSchema = z.object({
  cardBrandId: z.string().optional(),
  installments: z.coerce.number().int().min(1).max(24).optional(),
  feePercentage: z.coerce.number().min(0).max(100),
  fixedFee: z.coerce.number().min(0).default(0),
  allowsAnticipation: z.boolean().default(false),
  anticipationFeePercentage: z.coerce.number().min(0).max(100).default(0),
  settlementDays: z.coerce.number().int().min(0).max(365).default(0),
  settlementDayType: z.enum(["CALENDAR", "BUSINESS"]).default("CALENDAR"),
  settlementContract: z.enum(["SCHEDULED", "SAME_DAY"]).default("SCHEDULED"),
  effectiveFrom: z.string().date(),
  effectiveUntil: z.string().date().optional(),
  active: z.boolean().default(true)
});

const payableCategories = ["RENT", "WATER", "ELECTRICITY", "INTERNET_PHONE", "PAYROLL", "TAXES", "PRODUCT_PURCHASE", "GROOMING_SUPPLIES", "CLEANING_SUPPLIES", "MAINTENANCE", "MARKETING", "SOFTWARE", "BANK_FEES", "FREIGHT", "PROFESSIONAL_SERVICES", "OTHER"] as const;
const payableSchema = z.object({
  description: z.string().trim().min(2),
  category: z.enum(payableCategories),
  expenseType: z.enum(["FIXED", "VARIABLE"]),
  supplierName: z.string().trim().optional(),
  documentNumber: z.string().trim().optional(),
  amount: z.coerce.number().positive(),
  dueDate: z.string().date(),
  competenceMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  recurring: z.boolean().default(false),
  repeatMonths: z.coerce.number().int().min(1).max(60).default(1),
  notes: z.string().trim().optional()
});

function payableDate(value: string) {
  return new Date(`${value}T12:00:00-03:00`);
}

function addPayableMonths(date: Date, months: number) {
  const next = new Date(date);
  const desiredDay = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(desiredDay, lastDay));
  return next;
}

function addCompetenceMonths(value: string, months: number) {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

financialRouter.get("/payment-methods/active", async (req, res) => {
  await ensureCashPaymentMethod(companyId(req));
  const methods = await prisma.financialPaymentMethod.findMany({
    where: { companyId: companyId(req), active: true, destinationAccount: { active: true } },
    include: {
      destinationAccount: { select: { id: true, name: true, type: true } },
      brands: { where: { active: true }, orderBy: { brandName: "asc" } },
      feeRules: { where: { active: true }, orderBy: { installments: "asc" } }
    },
    orderBy: { name: "asc" }
  });
  res.json(methods);
});

financialRouter.use(requireAdmin);

financialRouter.get("/overview", async (req, res) => {
  const cid = companyId(req);
  const now = new Date();
  const [futureInstallments, legacyFuturePayments, pendingSales, fees] = await Promise.all([
    prisma.salePaymentInstallment.aggregate({
      where: { expectedSettlementDate: { gt: now }, salePayment: { companyId: cid } },
      _sum: { netAmount: true }
    }),
    prisma.salePayment.aggregate({
      where: { companyId: cid, expectedSettlementDate: { gt: now }, settlementInstallments: { none: {} } },
      _sum: { netAmount: true }
    }),
    prisma.sale.aggregate({
      where: { companyId: cid, status: { in: ["PENDING", "PARTIALLY_PAID"] } },
      _sum: { pendingAmount: true }
    }),
    prisma.salePayment.aggregate({ where: { companyId: cid }, _sum: { feeAmount: true } })
  ]);
  const receivable = Number(futureInstallments._sum.netAmount ?? 0) + Number(legacyFuturePayments._sum.netAmount ?? 0) + Number(pendingSales._sum.pendingAmount ?? 0);
  const payable = await prisma.financialPayable.aggregate({ where: { companyId: cid, status: "OPEN" }, _sum: { amount: true } });
  res.json({ payable: Number(payable._sum.amount ?? 0), receivable, fees: Number(fees._sum.feeAmount ?? 0) });
});

financialRouter.get("/payables", async (req, res) => {
  const cid = companyId(req);
  const status = String(req.query.status ?? "OPEN");
  const where: any = { companyId: cid };
  if (["OPEN", "PAID", "CANCELLED"].includes(status)) where.status = status;
  const items = await prisma.financialPayable.findMany({ where, include: { paidFromAccount: { select: { id: true, name: true } } }, orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }] });
  res.json(items);
});

financialRouter.post("/payables", async (req, res) => {
  const cid = companyId(req);
  const body = payableSchema.parse(req.body);
  const total = body.recurring ? body.repeatMonths : 1;
  const groupId = total > 1 ? randomUUID() : null;
  const firstDueDate = payableDate(body.dueDate);
  const created = await prisma.$transaction(Array.from({ length: total }, (_, index) => prisma.financialPayable.create({ data: {
    companyId: cid, description: body.description, category: body.category, expenseType: body.expenseType,
    supplierName: body.supplierName || null, documentNumber: body.documentNumber || null, amount: body.amount,
    dueDate: addPayableMonths(firstDueDate, index), competenceMonth: body.competenceMonth ? addCompetenceMonths(body.competenceMonth, index) : null,
    installmentNumber: index + 1, installmentTotal: total, recurrenceGroupId: groupId,
    notes: body.notes || null, createdById: req.user?.userId, updatedById: req.user?.userId
  } })));
  res.status(201).json(created);
});

financialRouter.patch("/payables/:id", async (req, res) => {
  const cid = companyId(req);
  const body = payableSchema.partial().omit({ recurring: true, repeatMonths: true }).parse(req.body);
  const existing = await prisma.financialPayable.findFirst({ where: { id: req.params.id, companyId: cid } });
  if (!existing) return res.status(404).json({ message: "Conta a pagar não encontrada." });
  if (existing.status !== "OPEN") return res.status(400).json({ message: "Somente contas em aberto podem ser editadas." });
  res.json(await prisma.financialPayable.update({ where: { id: existing.id }, data: { ...body, dueDate: body.dueDate ? payableDate(body.dueDate) : undefined, updatedById: req.user?.userId } }));
});

financialRouter.post("/payables/:id/pay", async (req, res) => {
  const cid = companyId(req);
  const body = z.object({ paidAmount: z.coerce.number().positive(), paidAt: z.string().date(), paidFromAccountId: z.string().min(1), paymentMethod: z.string().trim().min(1) }).parse(req.body);
  const existing = await prisma.financialPayable.findFirst({ where: { id: req.params.id, companyId: cid, status: "OPEN" } });
  if (!existing) return res.status(404).json({ message: "Conta em aberto não encontrada." });
  const account = await prisma.financialAccount.findFirst({ where: { id: body.paidFromAccountId, companyId: cid, active: true } });
  if (!account) return res.status(400).json({ message: "Selecione uma conta ativa para registrar o pagamento." });
  res.json(await prisma.financialPayable.update({ where: { id: existing.id }, data: { status: "PAID", paidAmount: body.paidAmount, paidAt: payableDate(body.paidAt), paidFromAccountId: account.id, paymentMethod: body.paymentMethod, updatedById: req.user?.userId } }));
});

financialRouter.delete("/payables/:id", async (req, res) => {
  const cid = companyId(req);
  const existing = await prisma.financialPayable.findFirst({ where: { id: req.params.id, companyId: cid, status: "OPEN" } });
  if (!existing) return res.status(404).json({ message: "Conta em aberto não encontrada." });
  await prisma.financialPayable.update({ where: { id: existing.id }, data: { status: "CANCELLED", updatedById: req.user?.userId } });
  res.json({ deleted: true });
});

financialRouter.get("/accounts", async (req, res) => {
  const cid = companyId(req);
  const accounts = await prisma.financialAccount.findMany({ where: { companyId: cid, active: true }, orderBy: { name: "asc" } });
  const legacyTotals = await prisma.salePayment.groupBy({
    by: ["destinationAccountId"],
    where: { companyId: cid, destinationAccountId: { not: null }, expectedSettlementDate: { lte: new Date() }, settlementInstallments: { none: {} } },
    _sum: { netAmount: true }
  });
  const dueInstallments = await prisma.salePaymentInstallment.findMany({
    where: { expectedSettlementDate: { lte: new Date() }, salePayment: { companyId: cid, destinationAccountId: { not: null } } },
    select: { netAmount: true, salePayment: { select: { destinationAccountId: true } } }
  });
  const receivedByAccount = new Map(legacyTotals.map((item) => [item.destinationAccountId, Number(item._sum.netAmount ?? 0)]));
  for (const installment of dueInstallments) {
    const accountId = installment.salePayment.destinationAccountId;
    if (accountId) receivedByAccount.set(accountId, (receivedByAccount.get(accountId) ?? 0) + Number(installment.netAmount));
  }
  const paidPayables = await prisma.financialPayable.groupBy({
    by: ["paidFromAccountId"],
    where: { companyId: cid, status: "PAID", paidFromAccountId: { not: null } },
    _sum: { paidAmount: true }
  });
  const paidByAccount = new Map(paidPayables.map((item) => [item.paidFromAccountId, Number(item._sum.paidAmount ?? 0)]));
  res.json(accounts.map((account) => ({
    ...account,
    calculatedBalance: Number(account.openingBalance) + (receivedByAccount.get(account.id) ?? 0) - (paidByAccount.get(account.id) ?? 0)
  })));
});

financialRouter.post("/accounts", async (req, res) => {
  const cid = companyId(req);
  const body = accountSchema.parse(req.body);
  const account = await prisma.$transaction(async (tx) => {
    if (body.isPrimary) await tx.financialAccount.updateMany({ where: { companyId: cid, isPrimary: true }, data: { isPrimary: false } });
    return tx.financialAccount.create({
      data: {
        ...body,
        companyId: cid,
        institutionName: body.type === "CASH_DRAWER" ? null : body.institutionName,
        openingBalanceDate: new Date(`${body.openingBalanceDate}T12:00:00-03:00`),
        createdById: req.user?.userId,
        updatedById: req.user?.userId
      }
    });
  });
  res.status(201).json(account);
});

financialRouter.patch("/accounts/:id", async (req, res) => {
  const cid = companyId(req);
  const body = accountSchema.partial().parse(req.body);
  const existing = await prisma.financialAccount.findFirst({ where: { id: req.params.id, companyId: cid } });
  if (!existing) return res.status(404).json({ message: "Conta financeira não encontrada." });
  const account = await prisma.$transaction(async (tx) => {
    if (body.isPrimary) await tx.financialAccount.updateMany({ where: { companyId: cid, isPrimary: true, id: { not: existing.id } }, data: { isPrimary: false } });
    return tx.financialAccount.update({
      where: { id: existing.id },
      data: {
        ...body,
        openingBalanceDate: body.openingBalanceDate ? new Date(`${body.openingBalanceDate}T12:00:00-03:00`) : undefined,
        institutionName: body.type === "CASH_DRAWER" ? null : body.institutionName,
        updatedById: req.user?.userId
      }
    });
  });
  res.json(account);
});

financialRouter.delete("/accounts/:id", async (req, res) => {
  const cid = companyId(req);
  const existing = await prisma.financialAccount.findFirst({ where: { id: req.params.id, companyId: cid } });
  if (!existing) return res.status(404).json({ message: "Banco não encontrado." });
  if (existing.type === "CASH_DRAWER") return res.status(400).json({ message: "O Caixa físico é padrão do sistema e não pode ser excluído." });
  await prisma.$transaction([
    prisma.financialPaymentMethod.updateMany({ where: { companyId: cid, destinationAccountId: existing.id }, data: { active: false } }),
    prisma.financialAccount.update({ where: { id: existing.id }, data: { active: false, isPrimary: false, updatedById: req.user?.userId } })
  ]);
  return res.json({ deleted: true, historyPreserved: true });
});

financialRouter.get("/payment-methods", async (req, res) => {
  await ensureCashPaymentMethod(companyId(req));
  const methods = await prisma.financialPaymentMethod.findMany({
    where: { companyId: companyId(req), active: true },
    include: { destinationAccount: true, brands: { orderBy: { brandName: "asc" } }, feeRules: { orderBy: { effectiveFrom: "desc" } } },
    orderBy: [{ active: "desc" }, { name: "asc" }]
  });
  res.json(methods);
});

financialRouter.post("/payment-methods", async (req, res) => {
  const cid = companyId(req);
  const body = paymentMethodSchema.parse(req.body);
  const account = await prisma.financialAccount.findFirst({ where: { id: body.destinationAccountId, companyId: cid, active: true } });
  if (!account) return res.status(400).json({ message: "Selecione uma conta financeira ativa da empresa." });
  if (body.type === "CASH" && account.type !== "CASH_DRAWER") return res.status(400).json({ message: "Dinheiro deve ser destinado a um caixa físico." });
  if (body.type !== "CASH" && account.type === "CASH_DRAWER") return res.status(400).json({ message: "PIX e cartões devem ser destinados a uma conta bancária, não ao Caixa físico." });
  if (body.type === "CASH" && await prisma.financialPaymentMethod.findFirst({ where: { companyId: cid, type: "CASH" } })) return res.status(409).json({ message: "A forma Dinheiro já existe e é padrão do sistema." });
  const { brands, ...methodData } = body;
  const method = await prisma.financialPaymentMethod.create({
    data: {
      ...methodData,
      companyId: cid,
      defaultFeePercentage: body.type === "CASH" ? 0 : body.defaultFeePercentage,
      fixedFee: body.type === "CASH" ? 0 : body.fixedFee,
      allowsAnticipation: body.type === "CASH" ? false : body.allowsAnticipation,
      anticipationFeePercentage: body.type === "CASH" ? 0 : body.anticipationFeePercentage,
      settlementDays: body.type === "CASH" ? 0 : body.settlementDays,
      maxInstallments: body.type === "CREDIT_CARD" ? body.maxInstallments : 1,
      brands: { create: [...new Set(brands.map((brand) => brand.trim()).filter(Boolean))].map((brandName) => ({ companyId: cid, brandName })) }
    },
    include: { destinationAccount: true, brands: true, feeRules: true }
  });
  res.status(201).json(method);
});

financialRouter.patch("/payment-methods/:id", async (req, res) => {
  const cid = companyId(req);
  const body = paymentMethodSchema.partial().parse(req.body);
  const existing = await prisma.financialPaymentMethod.findFirst({ where: { id: req.params.id, companyId: cid } });
  if (!existing) return res.status(404).json({ message: "Forma de recebimento não encontrada." });
  if (existing.type === "CASH" && (body.active === false || (body.type && body.type !== "CASH"))) return res.status(400).json({ message: "Dinheiro é uma forma padrão do sistema e não pode ser desativada ou alterada." });
  if (body.destinationAccountId) {
    const account = await prisma.financialAccount.findFirst({ where: { id: body.destinationAccountId, companyId: cid, active: true } });
    if (!account) return res.status(400).json({ message: "Conta financeira de destino inválida." });
    const resultingType = body.type ?? existing.type;
    if (resultingType === "CASH" && account.type !== "CASH_DRAWER") return res.status(400).json({ message: "Dinheiro deve ser destinado ao Caixa físico." });
    if (resultingType !== "CASH" && account.type === "CASH_DRAWER") return res.status(400).json({ message: "Selecione um banco para receber PIX e cartões." });
  }
  const { brands, ...methodData } = body;
  const updated = await prisma.$transaction(async (tx) => {
    if (brands) {
      const normalized = [...new Set(brands.map((brand) => brand.trim()).filter(Boolean))];
      await tx.paymentMethodBrand.updateMany({ where: { paymentMethodId: existing.id }, data: { active: false } });
      for (const brandName of normalized) {
        await tx.paymentMethodBrand.upsert({
          where: { paymentMethodId_brandName: { paymentMethodId: existing.id, brandName } },
          update: { active: true },
          create: { companyId: cid, paymentMethodId: existing.id, brandName, active: true }
        });
      }
    }
    return tx.financialPaymentMethod.update({ where: { id: existing.id }, data: methodData, include: { destinationAccount: true, brands: true, feeRules: true } });
  });
  res.json(updated);
});

financialRouter.delete("/payment-methods/:id", async (req, res) => {
  const cid = companyId(req);
  const existing = await prisma.financialPaymentMethod.findFirst({ where: { id: req.params.id, companyId: cid } });
  if (!existing) return res.status(404).json({ message: "Forma de recebimento não encontrada." });
  if (existing.type === "CASH") return res.status(400).json({ message: "Dinheiro é padrão do sistema e não pode ser excluído." });
  await prisma.financialPaymentMethod.update({ where: { id: existing.id }, data: { active: false } });
  return res.json({ deleted: true, historyPreserved: true });
});

financialRouter.post("/payment-methods/:id/fee-rules", async (req, res) => {
  const cid = companyId(req);
  const body = feeRuleSchema.parse(req.body);
  const method = await prisma.financialPaymentMethod.findFirst({ where: { id: req.params.id, companyId: cid } });
  if (!method) return res.status(404).json({ message: "Forma de recebimento não encontrada." });
  const effectiveFrom = new Date(`${body.effectiveFrom}T00:00:00-03:00`);
  const rule = await prisma.$transaction(async (tx) => {
    await tx.paymentFeeRule.updateMany({
      where: { companyId: cid, paymentMethodId: method.id, cardBrandId: body.cardBrandId ?? null, installments: body.installments ?? null, active: true },
      data: { active: false, effectiveUntil: new Date(effectiveFrom.getTime() - 1) }
    });
    return tx.paymentFeeRule.create({
      data: {
        ...body,
        companyId: cid,
        paymentMethodId: method.id,
        effectiveFrom,
        effectiveUntil: body.effectiveUntil ? new Date(`${body.effectiveUntil}T23:59:59.999-03:00`) : null
      }
    });
  });
  res.status(201).json(rule);
});
