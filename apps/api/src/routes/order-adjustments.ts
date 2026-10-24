import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { companyId, requirePermission } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { adjustSalePayment, cancelSale, isAdjustmentPaymentMethod, isCancellationReason, saleAdjustmentHistory } from "../services/order-adjustments.js";

export const orderAdjustmentsRouter = Router();
const paymentMethod = z.string().refine(isAdjustmentPaymentMethod, "Forma de pagamento inválida.");
const paymentSchema = z.object({
  method: paymentMethod, amount: z.coerce.number().positive(), financialPaymentMethodId: z.string().trim().min(1).optional(),
  cardBrand: z.string().trim().optional(), cardNsu: z.string().trim().optional(), cardAuthorization: z.string().trim().optional(),
  installments: z.coerce.number().int().min(1).max(24).optional(), pixReference: z.string().trim().optional()
});
const refundSchema = z.object({
  status: z.enum(["NOT_APPLICABLE", "PENDING", "CONFIRMED"]), amount: z.coerce.number().nonnegative().optional(), method: paymentMethod.optional(),
  date: z.string().date().optional(), responsibleName: z.string().trim().min(2).optional(), proofPath: z.string().trim().min(1).optional(),
  proofFileName: z.string().trim().min(1).optional(), proofMimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]).optional()
});

const proofSchema = z.object({ fileName: z.string().trim().min(1).max(180), mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]), data: z.string().min(1) });

async function actor(req: import("express").Request) {
  if (!req.user?.userId) return {};
  return (await prisma.user.findFirst({ where: { id: req.user.userId, companyId: companyId(req) }, select: { id: true, name: true } })) ?? {};
}

const saleInclude = {
  customer: { select: { internalCode: true, name: true, phone: true } }, pet: { select: { name: true } },
  items: { select: { id: true, itemType: true, description: true, quantity: true, unitPrice: true, total: true, coveredByMembership: true }, orderBy: { createdAt: "asc" as const } },
  cashSession: { include: { cashRegister: { select: { name: true, code: true } } } },
  payments: { orderBy: { paidAt: "asc" as const } }, receipt: { select: { fiscalDocumentType: true, fiscalStatus: true } }
};

orderAdjustmentsRouter.post("/proof", requirePermission("orders:confirm-refund"), async (req, res) => {
  try {
    const body = proofSchema.parse(req.body);
    const content = body.data.replace(/^data:[^;]+;base64,/, "");
    const bytes = Buffer.from(content, "base64");
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) return res.status(400).json({ message: "O comprovante deve ter no máximo 8 MB." });
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return res.status(503).json({ message: "O armazenamento privado de comprovantes não está configurado." });
    const extension = body.mimeType === "application/pdf" ? "pdf" : body.mimeType === "image/png" ? "png" : "jpg";
    const path = `${companyId(req)}/${randomUUID()}.${extension}`;
    const response = await fetch(`${url.replace(/\/$/, "")}/storage/v1/object/order-refund-proofs/${path}`, {
      method: "POST", body: bytes,
      headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": body.mimeType, "x-upsert": "false" }
    });
    if (!response.ok) throw new Error(`Storage respondeu ${response.status}`);
    res.status(201).json({ path, fileName: body.fileName, mimeType: body.mimeType });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Não foi possível armazenar o comprovante." });
  }
});

orderAdjustmentsRouter.get("/search", requirePermission("orders:history"), async (req, res) => {
  const cid = companyId(req); const code = Number(req.query.code);
  if (!Number.isInteger(code) || code < 1) return res.status(400).json({ message: "Informe um número de pedido válido." });
  const sale = await prisma.sale.findFirst({ where: { companyId: cid, internalCode: code }, include: saleInclude });
  if (!sale) return res.status(404).json({ message: "Pedido não encontrado nesta empresa." });
  res.json(sale);
});

// Mantém a escolha de modalidade idêntica à tela de recebimento do Caixa,
// sem exigir que o operador tenha acesso ao módulo Financeiro.
orderAdjustmentsRouter.get("/payment-methods", requirePermission("orders:history"), async (req, res) => {
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

orderAdjustmentsRouter.get("/:id", requirePermission("orders:history"), async (req, res) => {
  const sale = await prisma.sale.findFirst({ where: { id: req.params.id, companyId: companyId(req) }, include: saleInclude });
  if (!sale) return res.status(404).json({ message: "Pedido não encontrado." });
  res.json(sale);
});

orderAdjustmentsRouter.get("/:id/history", requirePermission("orders:history"), async (req, res) => {
  const cid = companyId(req);
  const sale = await prisma.sale.findFirst({ where: { id: req.params.id, companyId: cid }, select: { id: true } });
  if (!sale) return res.status(404).json({ message: "Pedido não encontrado." });
  res.json(await saleAdjustmentHistory(cid, sale.id));
});

orderAdjustmentsRouter.patch("/:id/payment", requirePermission("orders:adjust-payment"), async (req, res) => {
  try {
    const body = z.object({ justification: z.string().trim().min(3), payments: z.array(paymentSchema).min(1) }).parse(req.body);
    const result = await adjustSalePayment({ companyId: companyId(req), saleId: req.params.id, ...body, actor: await actor(req), idempotencyKey: req.header("Idempotency-Key") ?? undefined });
    res.json(result);
  } catch (error) {
    const status = typeof error === "object" && error && "statusCode" in error ? Number((error as { statusCode: number }).statusCode) : 500;
    res.status(status).json({ message: error instanceof Error ? error.message : "Não foi possível ajustar o pagamento." });
  }
});

orderAdjustmentsRouter.patch("/:id/cancel", requirePermission("orders:cancel"), async (req, res) => {
  try {
    const body = z.object({
      justification: z.string().trim().min(3), reason: z.string().refine(isCancellationReason, "Motivo inválido."),
      reasonDescription: z.string().trim().min(3).optional(), refund: refundSchema
    }).superRefine((value, context) => {
      if (value.reason === "OTHER" && !value.reasonDescription) context.addIssue({ code: z.ZodIssueCode.custom, path: ["reasonDescription"], message: "Descreva o outro motivo." });
    }).parse(req.body);
    const result = await cancelSale({ companyId: companyId(req), saleId: req.params.id, ...body, reason: body.reason as never, actor: await actor(req), idempotencyKey: req.header("Idempotency-Key") ?? undefined });
    res.json(result);
  } catch (error) {
    const status = typeof error === "object" && error && "statusCode" in error ? Number((error as { statusCode: number }).statusCode) : 500;
    res.status(status).json({ message: error instanceof Error ? error.message : "Não foi possível cancelar o pedido." });
  }
});
