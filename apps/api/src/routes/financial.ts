import { Router } from "express";
import { z } from "zod";
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
  settlementDays: z.coerce.number().int().min(0).max(365).default(0),
  settlementDayType: z.enum(["CALENDAR", "BUSINESS"]).default("CALENDAR"),
  effectiveFrom: z.string().date(),
  effectiveUntil: z.string().date().optional(),
  active: z.boolean().default(true)
});

financialRouter.get("/payment-methods/active", async (req, res) => {
  await ensureCashPaymentMethod(companyId(req));
  const methods = await prisma.financialPaymentMethod.findMany({
    where: { companyId: companyId(req), active: true, destinationAccount: { active: true } },
    include: {
      destinationAccount: { select: { id: true, name: true, type: true } },
      brands: { where: { active: true }, orderBy: { brandName: "asc" } }
    },
    orderBy: { name: "asc" }
  });
  res.json(methods);
});

financialRouter.use(requireAdmin);

financialRouter.get("/accounts", async (req, res) => {
  const cid = companyId(req);
  const accounts = await prisma.financialAccount.findMany({ where: { companyId: cid }, orderBy: [{ active: "desc" }, { name: "asc" }] });
  const totals = await prisma.salePayment.groupBy({
    by: ["destinationAccountId"],
    where: { companyId: cid, destinationAccountId: { not: null }, expectedSettlementDate: { lte: new Date() } },
    _sum: { netAmount: true }
  });
  const receivedByAccount = new Map(totals.map((item) => [item.destinationAccountId, Number(item._sum.netAmount ?? 0)]));
  res.json(accounts.map((account) => ({
    ...account,
    calculatedBalance: Number(account.openingBalance) + (receivedByAccount.get(account.id) ?? 0)
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

financialRouter.get("/payment-methods", async (req, res) => {
  await ensureCashPaymentMethod(companyId(req));
  const methods = await prisma.financialPaymentMethod.findMany({
    where: { companyId: companyId(req) },
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
  const body = paymentMethodSchema.partial().omit({ brands: true }).parse(req.body);
  const existing = await prisma.financialPaymentMethod.findFirst({ where: { id: req.params.id, companyId: cid } });
  if (!existing) return res.status(404).json({ message: "Forma de recebimento não encontrada." });
  if (existing.type === "CASH" && (body.active === false || (body.type && body.type !== "CASH"))) return res.status(400).json({ message: "Dinheiro é uma forma padrão do sistema e não pode ser desativada ou alterada." });
  if (body.destinationAccountId) {
    const account = await prisma.financialAccount.findFirst({ where: { id: body.destinationAccountId, companyId: cid, active: true } });
    if (!account) return res.status(400).json({ message: "Conta financeira de destino inválida." });
  }
  res.json(await prisma.financialPaymentMethod.update({ where: { id: existing.id }, data: body, include: { destinationAccount: true, brands: true, feeRules: true } }));
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
