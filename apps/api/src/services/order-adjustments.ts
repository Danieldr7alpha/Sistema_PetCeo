import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";

const paymentMethods = ["PIX", "CASH", "DEBIT", "CREDIT", "TRANSFER", "VOUCHER", "OTHER"] as const;
const cancellationReasons = ["INCORRECT_ORDER", "DUPLICATE_PAYMENT", "CUSTOMER_WITHDREW", "REFUND", "OPERATIONAL_ERROR", "OTHER"] as const;

export type AdjustmentActor = { id?: string; name?: string };
export type AdjustmentPayment = {
  method: typeof paymentMethods[number]; amount: number; financialPaymentMethodId?: string;
  cardBrand?: string; cardNsu?: string; cardAuthorization?: string; installments?: number;
  pixReference?: string;
};

export function isAdjustmentPaymentMethod(value: string): value is AdjustmentPayment["method"] {
  return (paymentMethods as readonly string[]).includes(value);
}

export function isCancellationReason(value: string): value is typeof cancellationReasons[number] {
  return (cancellationReasons as readonly string[]).includes(value);
}

const configuredToSaleMethod: Record<string, AdjustmentPayment["method"]> = {
  CASH: "CASH", PIX: "PIX", DEBIT_CARD: "DEBIT", CREDIT_CARD: "CREDIT", BANK_TRANSFER: "TRANSFER", OTHER: "OTHER"
};

function cents(value: number) { return Math.round((value + Number.EPSILON) * 100); }
function value(centsValue: number) { return centsValue / 100; }
function paymentSnapshot(payment: any) {
  return {
    id: payment.id, method: payment.method, amount: Number(payment.amount), cardBrand: payment.cardBrand,
    cardNsu: payment.cardNsu, cardAuthorization: payment.cardAuthorization, installments: payment.installments,
    pixReference: payment.pixReference, paymentMethodName: payment.paymentMethodNameSnapshot,
    institutionName: payment.institutionNameSnapshot, paidAt: payment.paidAt
  };
}

async function paymentData(companyId: string, payments: AdjustmentPayment[], cashSessionId: string | null, actor: AdjustmentActor) {
  const ids = [...new Set(payments.map((item) => item.financialPaymentMethodId).filter(Boolean) as string[])];
  const configured = ids.length ? await prisma.financialPaymentMethod.findMany({
    where: { id: { in: ids }, companyId, active: true, destinationAccount: { active: true } },
    include: { destinationAccount: true }
  }) : [];
  if (configured.length !== ids.length) throw Object.assign(new Error("A forma de recebimento selecionada não está ativa."), { statusCode: 400 });
  const byId = new Map(configured.map((item) => [item.id, item]));
  const references = new Set<string>();
  return payments.map((payment) => {
    const method = byId.get(payment.financialPaymentMethodId ?? "");
    if (method && configuredToSaleMethod[method.type] !== payment.method) throw Object.assign(new Error("A forma selecionada não corresponde ao pagamento informado."), { statusCode: 400 });
    if (["DEBIT", "CREDIT"].includes(payment.method) && (!payment.cardBrand?.trim() || !payment.cardNsu?.trim())) {
      throw Object.assign(new Error("Informe bandeira e NSU para pagamentos com cartão."), { statusCode: 400 });
    }
    if (payment.method === "CREDIT" && (!payment.installments || payment.installments < 1 || payment.installments > 24)) {
      throw Object.assign(new Error("Informe a quantidade de parcelas do cartão de crédito."), { statusCode: 400 });
    }
    const reference = [payment.method, payment.cardNsu?.trim(), payment.cardAuthorization?.trim()].filter(Boolean).join("|");
    if (reference !== payment.method && references.has(reference)) throw Object.assign(new Error("Há pagamentos duplicados com a mesma referência."), { statusCode: 400 });
    if (reference !== payment.method) references.add(reference);
    const amount = Number(payment.amount);
    const feePercentage = Number(method?.defaultFeePercentage ?? 0);
    const fixedFee = Number(method?.fixedFee ?? 0);
    const grossCents = cents(amount);
    const feeCents = Math.min(grossCents, Math.round(grossCents * feePercentage / 100) + cents(fixedFee));
    const expectedSettlementDate = method?.type === "CASH" || !method
      ? undefined
      : new Date(Date.now() + Number(method.settlementDays ?? 0) * 86_400_000);
    return {
      companyId, cashSessionId: cashSessionId ?? undefined, method: payment.method, amount,
      cardBrand: payment.cardBrand?.trim() || undefined, cardNsu: payment.cardNsu?.trim() || undefined,
      cardAuthorization: payment.cardAuthorization?.trim() || undefined, installments: payment.installments,
      pixReference: payment.method === "PIX" ? payment.pixReference?.trim() || undefined : undefined,
      cashReceived: payment.method === "CASH" ? amount : undefined, changeAmount: payment.method === "CASH" ? 0 : undefined,
      operatorId: actor.id, operatorName: actor.name,
      financialPaymentMethodId: method?.id, paymentMethodNameSnapshot: method?.name,
      paymentTypeSnapshot: method?.type, institutionNameSnapshot: method?.institutionName,
      destinationAccountId: method?.destinationAccountId, grossAmount: amount, feePercentageSnapshot: feePercentage,
      fixedFeeSnapshot: fixedFee, feeAmount: value(feeCents), netAmount: value(grossCents - feeCents),
      settlementDaysSnapshot: method?.settlementDays, settlementDayTypeSnapshot: method?.settlementDayType,
      settlementContractSnapshot: method?.settlementContract, expectedSettlementDate, cardBrandSnapshot: payment.cardBrand?.trim() || undefined
    };
  });
}

async function executionCashSession(companyId: string, originalSession: any) {
  if (originalSession?.status === "OPEN") return originalSession;
  return prisma.cashSession.findFirst({ where: { companyId, status: "OPEN" }, orderBy: { openedAt: "desc" } });
}

export async function adjustSalePayment(input: { companyId: string; saleId: string; justification: string; payments: AdjustmentPayment[]; actor: AdjustmentActor; idempotencyKey?: string }) {
  const idempotencyKey = input.idempotencyKey || randomUUID();
  return prisma.$transaction(async (tx) => {
    const existing = await tx.saleAdjustment.findUnique({ where: { idempotencyKey } });
    if (existing) return { adjustment: existing, replayed: true };
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-adjust:${input.companyId}:${input.saleId}`}))`;
    const sale = await tx.sale.findFirst({
      where: { id: input.saleId, companyId: input.companyId },
      include: { payments: { orderBy: { paidAt: "asc" } }, cashSession: true, receipt: true }
    });
    if (!sale) throw Object.assign(new Error("Pedido não encontrado."), { statusCode: 404 });
    if (sale.status !== "PAID") throw Object.assign(new Error("Somente pedidos pagos e não cancelados podem ter o pagamento ajustado."), { statusCode: 409 });
    if (!input.payments.length) throw Object.assign(new Error("Informe ao menos uma forma de pagamento."), { statusCode: 400 });
    const totalCents = cents(Number(sale.total));
    const paymentCents = input.payments.reduce((sum, item) => sum + cents(Number(item.amount)), 0);
    if (paymentCents !== totalCents) throw Object.assign(new Error("A soma dos pagamentos deve ser exatamente igual ao total do pedido."), { statusCode: 400 });
    const execution = await executionCashSession(input.companyId, sale.cashSession);
    const data = await paymentData(input.companyId, input.payments, execution?.id ?? sale.cashSessionId, input.actor);
    const previousPayments = sale.payments.map(paymentSnapshot);
    const nextPayments = data.map(paymentSnapshot);
    await tx.salePayment.deleteMany({ where: { saleId: sale.id, companyId: input.companyId } });
    await tx.sale.update({ where: { id: sale.id }, data: {
      paymentMethod: input.payments[0].method, paidAmount: value(paymentCents), pendingAmount: 0,
      payments: { create: data }
    } });
    const adjustment = await tx.saleAdjustment.create({ data: {
      companyId: input.companyId, saleId: sale.id, originalCashSessionId: sale.cashSessionId,
      performedCashSessionId: execution?.id, type: "PAYMENT_ADJUSTMENT", idempotencyKey,
      justification: input.justification, previousPayments, newPayments: nextPayments,
      performedById: input.actor.id, performedByName: input.actor.name
    } });
    return { adjustment, replayed: false, fiscalActionRequired: Boolean(sale.receipt?.fiscalDocumentType) };
  }, { maxWait: 10000, timeout: 20000 });
}

export async function cancelSale(input: {
  companyId: string; saleId: string; justification: string; reason: typeof cancellationReasons[number]; reasonDescription?: string;
  refund: { status: "NOT_APPLICABLE" | "PENDING" | "CONFIRMED"; amount?: number; method?: AdjustmentPayment["method"]; date?: string; responsibleName?: string; proofPath?: string; proofFileName?: string; proofMimeType?: string };
  actor: AdjustmentActor; idempotencyKey?: string;
}) {
  const idempotencyKey = input.idempotencyKey || randomUUID();
  return prisma.$transaction(async (tx) => {
    const existing = await tx.saleAdjustment.findUnique({ where: { idempotencyKey } });
    if (existing) return { adjustment: existing, replayed: true };
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-cancel:${input.companyId}:${input.saleId}`}))`;
    const sale = await tx.sale.findFirst({
      where: { id: input.saleId, companyId: input.companyId },
      include: { payments: true, items: true, cashSession: true, receipt: true, appointment: true }
    });
    if (!sale) throw Object.assign(new Error("Pedido não encontrado."), { statusCode: 404 });
    if (["CANCELLED", "REFUNDED"].includes(sale.status)) throw Object.assign(new Error("Este pedido já foi cancelado ou estornado."), { statusCode: 409 });
    const paid = Number(sale.paidAmount);
    const refundAmount = Number(input.refund.amount ?? 0);
    if (input.refund.status === "CONFIRMED" && (!input.refund.method || refundAmount <= 0 || refundAmount > paid)) {
      throw Object.assign(new Error("Informe valor e modalidade válidos para confirmar o reembolso."), { statusCode: 400 });
    }
    if (input.refund.proofMimeType && !["application/pdf", "image/jpeg", "image/png"].includes(input.refund.proofMimeType)) {
      throw Object.assign(new Error("O comprovante deve ser PDF, JPG ou PNG."), { statusCode: 400 });
    }
    const execution = await executionCashSession(input.companyId, sale.cashSession);
    if (input.refund.status === "CONFIRMED" && input.refund.method === "CASH") {
      if (!execution) throw Object.assign(new Error("Abra um caixa para registrar um reembolso em dinheiro."), { statusCode: 409 });
      await tx.cashMovement.create({ data: {
        companyId: input.companyId, cashSessionId: execution.id, type: "CASH_OUT", amount: refundAmount,
        reason: `Reembolso do pedido PD-${String(sale.internalCode ?? 0).padStart(5, "0")}`,
        notes: input.justification, operatorId: input.actor.id, operatorName: input.actor.name
      } });
    }
    for (const item of sale.items) {
      if (item.itemType === "PRODUCT" && item.productId) {
        await tx.product.updateMany({ where: { id: item.productId, companyId: input.companyId }, data: { stock: { increment: item.quantity } } });
      }
    }
    await tx.sale.update({ where: { id: sale.id }, data: {
      status: "CANCELLED", paymentStatus: "CANCELLED", cancelReason: input.reason === "OTHER" ? input.reasonDescription : input.reason,
      cancelledAt: new Date()
    } });
    if (sale.appointmentId) await tx.appointment.updateMany({ where: { id: sale.appointmentId, companyId: input.companyId }, data: { paymentStatus: "CANCELLED" } });
    const adjustment = await tx.saleAdjustment.create({ data: {
      companyId: input.companyId, saleId: sale.id, originalCashSessionId: sale.cashSessionId,
      performedCashSessionId: execution?.id, type: "CANCELLATION", idempotencyKey,
      justification: input.justification, cancellationReason: input.reason === "OTHER" ? input.reasonDescription : input.reason,
      previousPayments: sale.payments.map(paymentSnapshot), refundStatus: input.refund.status,
      refundAmount: input.refund.status === "NOT_APPLICABLE" ? undefined : refundAmount,
      refundMethod: input.refund.method, refundDate: input.refund.date ? new Date(`${input.refund.date}T12:00:00-03:00`) : input.refund.status === "CONFIRMED" ? new Date() : undefined,
      refundResponsibleId: input.actor.id, refundResponsibleName: input.refund.responsibleName?.trim() || input.actor.name,
      proofPath: input.refund.proofPath, proofFileName: input.refund.proofFileName, proofMimeType: input.refund.proofMimeType,
      performedById: input.actor.id, performedByName: input.actor.name
    } });
    return { adjustment, replayed: false, fiscalActionRequired: Boolean(sale.receipt?.fiscalDocumentType) };
  }, { maxWait: 10000, timeout: 20000 });
}

export async function saleAdjustmentHistory(companyId: string, saleId: string) {
  return prisma.saleAdjustment.findMany({
    where: { companyId, saleId }, orderBy: { createdAt: "asc" },
    select: { id: true, type: true, justification: true, cancellationReason: true, previousPayments: true, newPayments: true, refundStatus: true, refundAmount: true, refundMethod: true, refundDate: true, refundResponsibleName: true, proofPath: true, proofFileName: true, performedByName: true, originalCashSessionId: true, performedCashSessionId: true, createdAt: true }
  });
}
