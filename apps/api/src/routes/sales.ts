import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { companyId } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { saleItemSchema, type SaleItemInput } from "../schemas/sale.js";

export const salesRouter = Router();
const checkoutInProgress = new Set<string>();

const paymentMethods = ["PIX", "CASH", "DEBIT", "CREDIT", "TRANSFER", "VOUCHER", "OTHER"] as const;
const saleStatuses = ["WAITING_PAYMENT", "PARTIALLY_PAID", "PENDING", "PAID", "CANCELLED", "REFUNDED"] as const;
const pendingReasons = ["PIX_LATER", "PAY_ON_PICKUP", "OWED", "CARD_PROBLEM", "PARTIAL_PAYMENT", "OTHER"] as const;
const receivableStatuses = ["WAITING_PAYMENT", "PENDING", "PARTIALLY_PAID"] as const;

const salePaymentSchema = z.object({
  method: z.enum(paymentMethods),
  financialPaymentMethodId: z.string().optional(),
  amount: z.coerce.number().positive(),
  cardBrand: z.string().optional(),
  cardNsu: z.string().optional(),
  cardAuthorization: z.string().optional(),
  installments: z.coerce.number().int().positive().optional(),
  pixReference: z.string().optional(),
  cashReceived: z.coerce.number().positive().optional(),
  changeAmount: z.coerce.number().nonnegative().optional(),
  anticipated: z.boolean().default(false)
});

const checkoutSchema = z.object({
  customerId: z.string().optional(),
  petId: z.string().optional(),
  appointmentId: z.string().optional(),
  preSaleId: z.string().optional(),
  status: z.enum(["PENDING", "PARTIALLY_PAID", "PAID"]).default("PAID"),
  paymentMethod: z.enum(paymentMethods).optional(),
  cardBrand: z.string().optional(),
  cardNsu: z.string().optional(),
  cardAuthorization: z.string().optional(),
  payments: z.array(salePaymentSchema).optional(),
  discountType: z.enum(["VALUE", "PERCENT"]).default("VALUE"),
  discount: z.coerce.number().nonnegative().default(0),
  pendingReason: z.enum(pendingReasons).optional(),
  pendingNotes: z.string().optional(),
  expectedPaymentDate: z.string().date().optional(),
  adminPassword: z.string().optional(),
  membershipId: z.string().optional(),
  items: z.array(saleItemSchema).min(1)
});

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function salePaymentStatus(status: typeof saleStatuses[number]) {
  if (status === "PAID") return "PAID";
  if (status === "CANCELLED") return "CANCELLED";
  return "PENDING";
}

function nowBR() {
  return new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function saoPauloDate(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function periodRange(period: string) {
  const today = saoPauloDate();
  const reference = new Date(`${today}T12:00:00-03:00`);
  if (period === "week") {
    const day = reference.getUTCDay() || 7;
    const monday = new Date(reference);
    monday.setUTCDate(reference.getUTCDate() - day + 1);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return { from: saoPauloDate(monday), to: saoPauloDate(sunday) };
  }
  if (period === "month") {
    return { from: `${today.slice(0, 8)}01`, to: saoPauloDate(new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 0, 15))) };
  }
  if (period === "all" || period === "custom") return {};
  return { from: today, to: today };
}

async function operatorData(req: Request) {
  if (!req.user?.userId) return { operatorId: undefined, operatorName: undefined };
  const user = await prisma.user.findFirst({ where: { id: req.user.userId, companyId: companyId(req) }, select: { id: true, name: true } });
  return { operatorId: user?.id, operatorName: user?.name };
}

async function validateAdminPassword(cid: string, adminPassword?: string) {
  if (!adminPassword) return false;
  const admins = await prisma.user.findMany({ where: { companyId: cid, role: "ADMIN" }, select: { passwordHash: true } });
  for (const admin of admins) {
    if (await bcrypt.compare(adminPassword, admin.passwordHash)) return true;
  }
  return false;
}

async function openCashSession(cid: string) {
  return prisma.cashSession.findFirst({ where: { companyId: cid, status: "OPEN" }, orderBy: { openedAt: "desc" } });
}

async function requireOpenCashSession(cid: string) {
  const cashSession = await openCashSession(cid);
  if (!cashSession) throw Object.assign(new Error("Abra o caixa antes de finalizar vendas."), { statusCode: 409 });
  return cashSession;
}

async function syncSaleCodeCounter(cid: string, nextValue: number) {
  const counter = await prisma.internalCodeCounter.findUnique({
    where: { companyId_kind: { companyId: cid, kind: "SALE" } },
    select: { id: true, nextValue: true }
  });
  if (!counter) {
    await prisma.internalCodeCounter.create({ data: { companyId: cid, kind: "SALE", nextValue } });
    return;
  }
  if (counter.nextValue < nextValue) {
    await prisma.internalCodeCounter.update({ where: { id: counter.id }, data: { nextValue } });
  }
}

async function ensureSaleCodes(cid: string) {
  const missingCodes = await prisma.sale.findMany({
    where: { companyId: cid, internalCode: null },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  const last = await prisma.sale.findFirst({
    where: { companyId: cid, internalCode: { not: null } },
    orderBy: { internalCode: "desc" },
    select: { internalCode: true }
  });
  const counter = await prisma.internalCodeCounter.findUnique({
    where: { companyId_kind: { companyId: cid, kind: "SALE" } },
    select: { nextValue: true }
  });
  let nextCode = Math.max((last?.internalCode ?? 0) + 1, counter?.nextValue ?? 1);
  for (const sale of missingCodes) {
    await prisma.sale.update({ where: { id: sale.id }, data: { internalCode: nextCode++ } });
  }
  await syncSaleCodeCounter(cid, nextCode);
}

async function nextSaleCode(cid: string) {
  await ensureSaleCodes(cid);
  const counter = await prisma.internalCodeCounter.upsert({
    where: { companyId_kind: { companyId: cid, kind: "SALE" } },
    update: { nextValue: { increment: 1 } },
    create: { companyId: cid, kind: "SALE", nextValue: 2 },
    select: { nextValue: true }
  });
  return counter.nextValue - 1;
}

const receivableSaleInclude = {
  customer: { include: { pets: { orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }] }, memberships: { include: { plan: { include: { service: true } }, pet: true } } } },
  pet: true,
  appointment: { include: { service: true } },
  payments: { orderBy: { paidAt: "asc" as const } },
  items: { include: { service: true, product: true }, orderBy: { createdAt: "asc" as const } },
  receipt: true
};

function receivableError(res: Response, sale: { status: typeof saleStatuses[number]; internalCode: number | null; paidAt?: Date | null; paidAmount?: unknown; receipt?: { receiptCode: number } | null }) {
  const details = {
    orderCode: `PD-${String(sale.internalCode ?? 0).padStart(6, "0")}`,
    paidAt: sale.paidAt,
    paidAmount: Number(sale.paidAmount ?? 0),
    receiptCode: sale.receipt?.receiptCode
  };
  if (sale.status === "PAID") return res.status(409).json({ code: "ORDER_ALREADY_PAID", message: "Este pedido já foi pago.", details });
  if (sale.status === "CANCELLED") return res.status(409).json({ code: "ORDER_CANCELLED", message: "Este pedido foi cancelado.", details });
  return res.status(409).json({ code: "ORDER_NOT_RECEIVABLE", message: "Este pedido não está disponível para recebimento.", details: { ...details, status: sale.status } });
}

async function ensureSalesReceipt(db: any, cid: string, saleId: string, loadedSale?: any, loadedCompany?: any) {
  const existing = await db.salesReceipt.findUnique({ where: { saleId } });
  if (existing) return existing;
  const sale = loadedSale ?? await db.sale.findFirst({
    where: { id: saleId, companyId: cid, status: "PAID" },
    include: {
      customer: true,
      pet: true,
      items: { include: { product: true, service: true }, orderBy: { createdAt: "asc" } },
      payments: { orderBy: { paidAt: "asc" } }
    }
  });
  if (!sale || Number(sale.paidAmount) + 0.01 < Number(sale.total)) return null;
  const company = loadedCompany ?? await db.company.findUnique({ where: { id: cid } });
  if (!company) throw Object.assign(new Error("Empresa não encontrada."), { statusCode: 404 });

  const counter = await db.internalCodeCounter.upsert({
    where: { companyId_kind: { companyId: cid, kind: "SALES_RECEIPT" } },
    update: { nextValue: { increment: 1 } },
    create: { companyId: cid, kind: "SALES_RECEIPT", nextValue: 2 },
    select: { nextValue: true }
  });
  const receiptCode = counter.nextValue - 1;
  return db.salesReceipt.create({
    data: {
      companyId: cid,
      receiptCode,
      saleId: sale.id,
      customerId: sale.customerId,
      petId: sale.petId,
      cashSessionId: sale.cashSessionId,
      operatorId: sale.operatorId,
      companyNameSnapshot: company.name,
      companyDocumentSnapshot: company.document,
      companyAddressSnapshot: null,
      customerCodeSnapshot: sale.customer?.internalCode,
      customerNameSnapshot: sale.customer?.name,
      petNameSnapshot: sale.pet?.name,
      operatorNameSnapshot: sale.operatorName,
      itemsSnapshot: sale.items.map((item: any) => ({
        itemType: item.itemType,
        catalogCode: item.product?.catalogCode ?? item.service?.catalogCode ?? null,
        description: item.description,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        total: Number(item.total)
      })),
      paymentsSnapshot: sale.payments.map((payment: any) => ({
        method: payment.method,
        amount: Number(payment.amount),
        cardBrand: payment.cardBrand,
        cardNsu: payment.cardNsu,
        cardAuthorization: payment.cardAuthorization,
        installments: payment.installments,
        pixReference: payment.pixReference,
        cashReceived: payment.cashReceived == null ? null : Number(payment.cashReceived),
        changeAmount: payment.changeAmount == null ? null : Number(payment.changeAmount),
        financialPaymentMethodId: payment.financialPaymentMethodId,
        paymentMethodNameSnapshot: payment.paymentMethodNameSnapshot,
        paymentTypeSnapshot: payment.paymentTypeSnapshot,
        institutionNameSnapshot: payment.institutionNameSnapshot,
        destinationAccountId: payment.destinationAccountId,
        grossAmount: payment.grossAmount == null ? Number(payment.amount) : Number(payment.grossAmount),
        feePercentageSnapshot: payment.feePercentageSnapshot == null ? 0 : Number(payment.feePercentageSnapshot),
        fixedFeeSnapshot: payment.fixedFeeSnapshot == null ? 0 : Number(payment.fixedFeeSnapshot),
        feeAmount: payment.feeAmount == null ? 0 : Number(payment.feeAmount),
        netAmount: payment.netAmount == null ? Number(payment.amount) : Number(payment.netAmount),
        settlementDaysSnapshot: payment.settlementDaysSnapshot,
        expectedSettlementDate: payment.expectedSettlementDate,
        cardBrandSnapshot: payment.cardBrandSnapshot,
        paidAt: payment.paidAt
      })),
      subtotal: sale.subtotal,
      discount: sale.discount,
      total: sale.total,
      paidAmount: sale.paidAmount
    }
  });
}

async function addCustomerHistory(data: {
  companyId: string;
  customerId?: string | null;
  petId?: string | null;
  appointmentId?: string | null;
  saleId: string;
  type: string;
  title: string;
  description?: string;
  amount?: number;
}, db: any = prisma) {
  if (!data.customerId) return;
  await db.customerHistory.create({
    data: {
      companyId: data.companyId,
      customerId: data.customerId,
      petId: data.petId ?? undefined,
      appointmentId: data.appointmentId ?? undefined,
      saleId: data.saleId,
      type: data.type,
      title: data.title,
      description: data.description,
      amount: data.amount
    }
  });
}

async function completeMembershipRenewalOnce(db: any, cid: string, appointmentId: string, operatorId?: string) {
  const renewal = await db.membershipRenewal.findFirst({
    where: { companyId: cid, appointmentId },
    include: { plan: true }
  });
  if (!renewal || renewal.status === "PAID") return renewal;
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${renewal.id}))`;
  const current = await db.membershipRenewal.findUnique({ where: { id: renewal.id }, include: { plan: true } });
  if (!current || current.status === "PAID") return current;
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + current.plan.validityDays * 24 * 60 * 60 * 1000);
  const totalUses = current.plan.usageQuantity;
  const membership = await db.customerMembership.create({
    data: {
      companyId: cid,
      customerId: current.customerId,
      petId: current.petId,
      planId: current.planId,
      startDate,
      endDate,
      totalUses,
      usedUses: 1,
      remainingUses: Math.max(0, totalUses - 1),
      status: "ACTIVE"
    }
  });
  await db.membershipUsage.create({
    data: {
      companyId: cid,
      membershipId: membership.id,
      appointmentId,
      petId: current.petId,
      serviceId: current.plan.serviceId,
      status: "CONSUMED",
      usageNumber: 1,
      balanceBefore: totalUses,
      balanceAfter: Math.max(0, totalUses - 1),
      consumedAt: new Date(),
      operatorId
    }
  });
  await db.appointment.update({ where: { id: appointmentId }, data: { membershipId: membership.id, paymentMode: "PACKAGE" } });
  await db.membershipRenewal.update({ where: { id: current.id }, data: { status: "PAID", membershipId: membership.id, paidAt: new Date() } });
  await db.customerHistory.create({
    data: {
      companyId: cid,
      customerId: current.customerId,
      petId: current.petId,
      appointmentId,
      membershipId: membership.id,
      type: "MEMBERSHIP_RENEWAL",
      title: "Mensalidade renovada e primeiro uso consumido",
      description: `${current.plan.name} · Uso 1 de ${totalUses} · Saldo: ${totalUses} → ${Math.max(0, totalUses - 1)}`
    }
  });
  return membership;
}

export async function ensureWaitingSaleForFinishedAppointment(cid: string, appointmentId: string) {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, companyId: cid, status: "FINISHED" },
    include: { customer: true, pet: true, service: true, membershipUsage: true, membershipRenewal: { include: { plan: true } }, extraServices: { orderBy: { createdAt: "asc" } } }
  });
  if (!appointment) return null;

  const coveredByMembership = appointment.paymentMode === "PACKAGE" && appointment.membershipUsage?.status === "CONSUMED";
  const renewalAtCheckout = appointment.paymentMode === "RENEWAL_AT_CHECKOUT" && appointment.membershipRenewal?.status === "PENDING_PAYMENT";
  const baseTotal = renewalAtCheckout ? Number(appointment.membershipRenewal?.priceSnapshot ?? 0) : coveredByMembership ? 0 : Number(appointment.service.price);
  const extraTotal = appointment.extraServices.reduce((sum, extra) => sum + Number(extra.priceSnapshot), 0);
  const chargeableTotal = baseTotal + extraTotal;

  const existing = await prisma.sale.findFirst({
    where: { companyId: cid, appointmentId },
    include: {
      customer: { include: { pets: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }, memberships: { include: { plan: { include: { service: true } }, pet: true } } } },
      pet: true,
      appointment: { include: { service: true } },
      payments: { orderBy: { paidAt: "asc" } },
      items: { include: { service: true, product: true }, orderBy: { createdAt: "asc" } },
      receipt: true
    }
  });

  if (coveredByMembership && chargeableTotal <= 0) {
    const isUnusedZeroSale = existing
      && ["WAITING_PAYMENT", "PENDING"].includes(existing.status)
      && Number(existing.total) <= 0
      && Number(existing.paidAmount) <= 0
      && existing.payments.length === 0
      && !existing.receipt;
    if (isUnusedZeroSale) {
      await prisma.$transaction(async (tx) => {
        await tx.customerHistory.deleteMany({ where: { companyId: cid, saleId: existing.id } });
        await tx.sale.delete({ where: { id: existing.id } });
      });
    }
    return null;
  }

  if (existing) return existing;

  const total = chargeableTotal;
  const baseSaleItems = renewalAtCheckout
    ? [{
        companyId: cid,
        itemType: "SERVICE" as const,
        serviceId: appointment.serviceId,
        description: `Renovação: ${appointment.membershipRenewal!.plan.name}`,
        quantity: 1,
        unitPrice: baseTotal,
        total: baseTotal,
        coveredByMembership: false
      }, {
        companyId: cid,
        itemType: "SERVICE" as const,
        serviceId: appointment.serviceId,
        description: `${appointment.service.name} — incluído na renovação`,
        quantity: 1,
        unitPrice: 0,
        total: 0,
        coveredByMembership: true
      }]
    : [{
        companyId: cid,
        itemType: "SERVICE" as const,
        serviceId: appointment.serviceId,
        description: appointment.service.name,
        quantity: 1,
        unitPrice: baseTotal,
        total: baseTotal,
        coveredByMembership
      }];
  const saleItems = [
    ...baseSaleItems,
    ...appointment.extraServices.map((extra) => ({
      companyId: cid,
      itemType: "SERVICE" as const,
      serviceId: extra.serviceId,
      description: extra.nameSnapshot,
      quantity: 1,
      unitPrice: Number(extra.priceSnapshot),
      total: Number(extra.priceSnapshot),
      coveredByMembership: false
    }))
  ];
  try {
    const sale = await prisma.sale.create({
      data: {
        companyId: cid,
        internalCode: await nextSaleCode(cid),
        customerId: appointment.customerId,
        petId: appointment.petId,
        appointmentId: appointment.id,
        origin: "AGENDA",
        status: "WAITING_PAYMENT",
        paymentStatus: "PENDING",
        pendingSince: new Date(),
        subtotal: total,
        total,
        items: {
          create: saleItems
        }
      },
      include: {
        customer: { include: { pets: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }, memberships: { include: { plan: { include: { service: true } }, pet: true } } } },
        pet: true,
        appointment: { include: { service: true } },
        payments: { orderBy: { paidAt: "asc" } },
        items: { include: { service: true, product: true }, orderBy: { createdAt: "asc" } }
      }
    });
    await addCustomerHistory({
      companyId: cid,
      customerId: appointment.customerId,
      petId: appointment.petId,
      appointmentId: appointment.id,
      saleId: sale.id,
      type: "SALE",
      title: "Venda criada no caixa",
      description: `${appointment.pet.name} - ${appointment.service.name}`,
      amount: total
    });
    return sale;
  } catch (error) {
    const raceWinner = await prisma.sale.findFirst({
      where: { companyId: cid, appointmentId },
      include: {
        customer: { include: { pets: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }, memberships: { include: { plan: { include: { service: true } }, pet: true } } } },
        pet: true,
        appointment: { include: { service: true } },
        payments: { orderBy: { paidAt: "asc" } },
        items: { include: { service: true, product: true }, orderBy: { createdAt: "asc" } }
      }
    });
    if (raceWinner) return raceWinner;
    throw error;
  }
}

async function ensureWaitingSalesForFinishedAppointments(cid: string) {
  const appointments = await prisma.appointment.findMany({
    where: {
      companyId: cid,
      status: "FINISHED",
      OR: [
        { sales: { none: {} } },
        { paymentMode: "PACKAGE", sales: { some: { status: { in: ["WAITING_PAYMENT", "PENDING"] }, total: { lte: 0 } } } }
      ]
    },
    include: { customer: true, pet: true, service: true },
    orderBy: [{ date: "asc" }, { startTime: "asc" }]
  });

  for (const appointment of appointments) {
    await ensureWaitingSaleForFinishedAppointment(cid, appointment.id);
  }
}

async function validateCustomerPet(cid: string, customerId?: string, petId?: string) {
  if (!customerId && !petId) return;
  if (!customerId && petId) {
    throw Object.assign(new Error("Selecione um cliente para vincular o pet."), { statusCode: 400 });
  }
  if (customerId && !petId) {
    const customer = await prisma.customer.findFirst({ where: { id: customerId, companyId: cid }, select: { id: true } });
    if (!customer) throw Object.assign(new Error("Cliente não encontrado"), { statusCode: 404 });
    return;
  }
  const pet = await prisma.pet.findFirst({ where: { id: petId, customerId, companyId: cid } });
  if (!pet) throw Object.assign(new Error("Cliente ou pet não encontrado"), { statusCode: 404 });
}

async function buildSaleItems(cid: string, rawItems: SaleItemInput[], coveredServiceId?: string) {
  const serviceIds = [...new Set(rawItems.map((item) => item.serviceId).filter(Boolean) as string[])];
  const productIds = [...new Set(rawItems.map((item) => item.productId).filter(Boolean) as string[])];
  const [services, products] = await Promise.all([
    serviceIds.length ? prisma.service.findMany({ where: { id: { in: serviceIds }, companyId: cid } }) : [],
    productIds.length ? prisma.product.findMany({ where: { id: { in: productIds }, companyId: cid } }) : []
  ]);
  const servicesById = new Map(services.map((service) => [service.id, service]));
  const productsById = new Map(products.map((product) => [product.id, product]));

  let packageCoverageApplied = false;
  return rawItems.map((item) => {
    if (item.itemType === "SERVICE") {
      const service = item.serviceId ? servicesById.get(item.serviceId) : null;
      if (!service) throw Object.assign(new Error("Serviço de venda não encontrado"), { statusCode: 404 });
      const coveredByMembership = !packageCoverageApplied && coveredServiceId === service.id;
      if (coveredByMembership && item.quantity !== 1) throw Object.assign(new Error("O pacote cobre uma utilização do serviço por atendimento."), { statusCode: 400 });
      if (coveredByMembership) packageCoverageApplied = true;
      const unitPrice = coveredByMembership ? 0 : Number(service.price);
      return { companyId: cid, itemType: "SERVICE" as const, serviceId: service.id, description: service.name, quantity: item.quantity, unitPrice, total: item.quantity * unitPrice, coveredByMembership };
    }
    const product = item.productId ? productsById.get(item.productId) : null;
    if (!product) throw Object.assign(new Error("Produto de venda não encontrado"), { statusCode: 404 });
    const unitPrice = Number(product.salePrice);
    return { companyId: cid, itemType: "PRODUCT" as const, productId: product.id, description: product.name, quantity: item.quantity, unitPrice, total: item.quantity * unitPrice };
  });
}

function calculateTotals(items: { total: number }[], discountType: "VALUE" | "PERCENT", discountInput: number) {
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const rawDiscount = discountType === "PERCENT" ? subtotal * Math.min(discountInput, 100) / 100 : discountInput;
  const discount = Math.min(subtotal, Math.max(0, rawDiscount));
  const discountPercent = subtotal > 0 ? Number(((discount / subtotal) * 100).toFixed(2)) : 0;
  return { subtotal, discount, discountPercent, total: Math.max(0, subtotal - discount) };
}

function requiresDiscountApproval(_discountPercent: number) {
  return false;
}

function addSettlementDays(days: number, type: "CALENDAR" | "BUSINESS") {
  const date = new Date();
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (type === "CALENDAR" || ![0, 6].includes(date.getUTCDay())) remaining -= 1;
  }
  return date;
}

async function buildPaymentPlan(
  cid: string,
  body: z.infer<typeof checkoutSchema>,
  total: number,
  cashSessionId: string,
  operator: Awaited<ReturnType<typeof operatorData>>
) {
  const requestedPayments = body.payments?.length
    ? body.payments
    : body.status === "PAID" && body.paymentMethod
      ? [{
        method: body.paymentMethod,
        amount: total,
        anticipated: false,
        financialPaymentMethodId: undefined,
        cardBrand: body.cardBrand,
        cardNsu: body.cardNsu,
        cardAuthorization: body.cardAuthorization,
        installments: undefined,
        pixReference: undefined,
        cashReceived: undefined,
        changeAmount: undefined
      }]
      : [];
  const paymentReferences = new Set<string>();
  const configuredIds = requestedPayments.map((payment) => payment.financialPaymentMethodId).filter((id): id is string => Boolean(id));
  const configuredMethods = configuredIds.length ? await prisma.financialPaymentMethod.findMany({
    where: { id: { in: configuredIds }, companyId: cid, active: true, destinationAccount: { active: true } },
    include: {
      brands: { where: { active: true } },
      feeRules: {
        where: {
          active: true,
          effectiveFrom: { lte: new Date() },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: new Date() } }]
        },
        include: { cardBrand: true },
        orderBy: { effectiveFrom: "desc" }
      }
    }
  }) : [];
  if (configuredMethods.length !== new Set(configuredIds).size) {
    throw Object.assign(new Error("A forma de recebimento selecionada não está ativa."), { statusCode: 400 });
  }
  const configuredById = new Map(configuredMethods.map((method) => [method.id, method]));
  const typeToLegacy = { CASH: "CASH", PIX: "PIX", DEBIT_CARD: "DEBIT", CREDIT_CARD: "CREDIT", BANK_TRANSFER: "TRANSFER", OTHER: "OTHER" } as const;
  for (const payment of requestedPayments) {
    const configured = payment.financialPaymentMethodId ? configuredById.get(payment.financialPaymentMethodId) : undefined;
    if (configured && typeToLegacy[configured.type] !== payment.method) {
      throw Object.assign(new Error("O tipo da forma de recebimento não corresponde ao pagamento informado."), { statusCode: 400 });
    }
    if ((payment.method === "DEBIT" || payment.method === "CREDIT") && !payment.cardBrand?.trim()) {
      throw Object.assign(new Error("Informe a bandeira do cartão."), { statusCode: 400 });
    }
    if ((payment.method === "DEBIT" || payment.method === "CREDIT") && !payment.cardNsu?.trim()) {
      throw Object.assign(new Error("Informe a NSU do cartão para concluir o pagamento."), { statusCode: 400 });
    }
    if (payment.method === "CREDIT" && (!payment.installments || payment.installments < 1 || payment.installments > 12)) {
      throw Object.assign(new Error("Informe uma quantidade de parcelas entre 1 e 12."), { statusCode: 400 });
    }
    const reference = [payment.method, payment.cardNsu?.trim(), payment.cardAuthorization?.trim()].filter(Boolean).join("|");
    if (reference && reference !== payment.method) {
      if (paymentReferences.has(reference)) {
        throw Object.assign(new Error("Pagamento duplicado para a mesma referência."), { statusCode: 400 });
      }
      paymentReferences.add(reference);
    }
  }
  const paidAmount = Number(requestedPayments.reduce((sum, payment) => sum + payment.amount, 0).toFixed(2));
  if (paidAmount - total > 0.01) {
    throw Object.assign(new Error("Valor pago nÃ£o pode ser maior que o total da venda."), { statusCode: 400 });
  }
  const pendingAmount = Number(Math.max(0, total - paidAmount).toFixed(2));
  const status = pendingAmount <= 0.01 ? "PAID" : paidAmount > 0 ? "PARTIALLY_PAID" : "PENDING";
  if (body.status === "PAID" && status !== "PAID") {
    throw Object.assign(new Error("Pagamento pago precisa cobrir o total da venda."), { statusCode: 400 });
  }
  if ((status === "PENDING" || status === "PARTIALLY_PAID") && (!body.pendingReason || !body.pendingNotes?.trim())) {
    throw Object.assign(new Error("Informe o motivo e a observaÃ§Ã£o do pagamento pendente."), { statusCode: 400 });
  }
  return {
    status: status as "PENDING" | "PARTIALLY_PAID" | "PAID",
    paidAmount,
    pendingAmount,
    primaryPayment: requestedPayments[0],
    paymentData: requestedPayments.map((payment) => {
      const configured = payment.financialPaymentMethodId ? configuredById.get(payment.financialPaymentMethodId) : undefined;
      const matchingRule = configured?.feeRules.find((rule) =>
        (rule.installments == null || rule.installments === (payment.installments ?? 1))
        && (rule.cardBrandId == null || rule.cardBrand?.brandName.toLocaleLowerCase("pt-BR") === payment.cardBrand?.trim().toLocaleLowerCase("pt-BR"))
      );
      const feePercentage = Number(matchingRule?.feePercentage ?? configured?.defaultFeePercentage ?? 0);
      const anticipationFeePercentage = payment.anticipated && configured?.allowsAnticipation ? Number(configured.anticipationFeePercentage) : 0;
      const fixedFee = Number(matchingRule?.fixedFee ?? configured?.fixedFee ?? 0);
      const grossCents = Math.round(payment.amount * 100);
      const feeCents = Math.min(grossCents, Math.round(grossCents * (feePercentage + anticipationFeePercentage) / 100) + Math.round(fixedFee * 100));
      const settlementDays = matchingRule?.settlementDays ?? configured?.settlementDays ?? 0;
      const settlementDayType = matchingRule?.settlementDayType ?? configured?.settlementDayType ?? "CALENDAR";
      return {
        companyId: cid,
        cashSessionId,
        method: payment.method,
        amount: payment.amount,
        cardBrand: payment.cardBrand,
        cardNsu: payment.cardNsu,
        cardAuthorization: payment.cardAuthorization,
        installments: payment.installments,
        pixReference: payment.method === "PIX" ? payment.pixReference?.trim() || payment.cardNsu?.trim() : undefined,
        cashReceived: payment.method === "CASH" ? payment.cashReceived ?? payment.amount : undefined,
        changeAmount: payment.method === "CASH" ? payment.changeAmount ?? Math.max(0, (payment.cashReceived ?? payment.amount) - payment.amount) : undefined,
        operatorId: operator.operatorId,
        operatorName: operator.operatorName,
        financialPaymentMethodId: configured?.id,
        paymentMethodNameSnapshot: configured?.name,
        paymentTypeSnapshot: configured?.type,
        institutionNameSnapshot: configured?.institutionName,
        destinationAccountId: configured?.destinationAccountId,
        grossAmount: grossCents / 100,
        feePercentageSnapshot: feePercentage,
        anticipated: anticipationFeePercentage > 0,
        anticipationFeePercentageSnapshot: anticipationFeePercentage,
        fixedFeeSnapshot: fixedFee,
        feeAmount: feeCents / 100,
        netAmount: (grossCents - feeCents) / 100,
        settlementDaysSnapshot: settlementDays,
        expectedSettlementDate: addSettlementDays(settlementDays, settlementDayType),
        cardBrandSnapshot: payment.cardBrand
      };
    })
  };
}

async function processStockOnce(cid: string, saleId: string, items: { productId?: string; quantity: number }[], db: any = prisma) {
  const sale = await db.sale.findFirst({ where: { id: saleId, companyId: cid }, select: { stockProcessedAt: true } });
  if (!sale || sale.stockProcessedAt) return;

  const productQuantityById = new Map<string, number>();
  for (const item of items) {
    if (!item.productId) continue;
    productQuantityById.set(item.productId, (productQuantityById.get(item.productId) ?? 0) + item.quantity);
  }

  if (productQuantityById.size) {
    const products = await db.product.findMany({ where: { id: { in: [...productQuantityById.keys()] }, companyId: cid } });
    for (const product of products) {
      const quantity = productQuantityById.get(product.id) ?? 0;
      const currentStock = Number(product.stock);
      if (!product.allowNegativeStock && currentStock - quantity < 0) {
        throw Object.assign(new Error(`Estoque insuficiente para ${product.name}. Ative a permissão de venda sem estoque no cadastro do produto.`), { statusCode: 400 });
      }
    }
    for (const [productId, quantity] of productQuantityById.entries()) {
      await db.product.updateMany({ where: { id: productId, companyId: cid }, data: { stock: { decrement: quantity } } });
    }
  }

  await db.sale.update({ where: { id: saleId }, data: { stockProcessedAt: new Date() } });
}

async function processMembershipUseOnce(cid: string, saleId: string, membershipId?: string, db: any = prisma) {
  if (!membershipId) return;
  const existingUse = await db.customerHistory.findFirst({ where: { companyId: cid, membershipId, saleId, type: "MEMBERSHIP_USE" } });
  if (existingUse) return;

  const membership = await db.customerMembership.findFirst({ where: { id: membershipId, companyId: cid }, include: { plan: true, pet: true } });
  if (!membership || membership.status !== "ACTIVE" || membership.remainingUses <= 0 || membership.endDate < new Date()) {
    throw Object.assign(new Error("Pacote sem saldo ou vencido"), { statusCode: 400 });
  }

  await db.customerMembership.updateMany({
    where: { id: membershipId, companyId: cid, remainingUses: { gt: 0 }, status: "ACTIVE" },
    data: { usedUses: { increment: 1 }, remainingUses: { decrement: 1 } }
  });
  await db.customerHistory.create({
    data: {
      companyId: cid,
      customerId: membership.customerId,
      petId: membership.petId,
      saleId,
      membershipId,
      type: "MEMBERSHIP_USE",
      title: "Uso de pacote",
      description: `${membership.pet.name} - ${membership.plan.name}`
    }
  });
}

async function updateAppointmentPayment(cid: string, appointmentId: string | null | undefined, status: typeof saleStatuses[number], db: any = prisma) {
  if (!appointmentId) return;
  await db.appointment.updateMany({ where: { id: appointmentId, companyId: cid }, data: { paymentStatus: salePaymentStatus(status) } });
}

function sanitizePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizePayload);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    /password|token|secret|authorization|key/i.test(key) ? "[REDACTED]" : sanitizePayload(item)
  ]));
}

function handleRouteError(error: unknown, req: Request, res: Response) {
  const statusCode = typeof error === "object" && error && "statusCode" in error ? Number((error as { statusCode: number }).statusCode) : 500;
  if (error instanceof z.ZodError) {
    const invalidItemLink = error.issues.some((issue) =>
      issue.path[0] === "items" && (
        issue.path.includes("productId") ||
        issue.path.includes("serviceId") ||
        issue.path.includes("itemType")
      )
    );
    if (process.env.NODE_ENV !== "production") {
      console.error("SALE_VALIDATION_ERROR", {
        code: "INVALID_SALE_PAYLOAD",
        message: error.issues[0]?.message,
        path: error.issues[0]?.path,
        details: error.issues,
        payload: sanitizePayload(req.body)
      });
    }
    return res.status(400).json({
      code: "INVALID_SALE_ITEM",
      message: invalidItemLink
        ? "O pedido contém um item sem produto ou serviço vinculado."
        : "Não foi possível concluir esta operação. Verifique os dados do pedido e tente novamente."
    });
  }
  const technicalMessage = error instanceof Error ? error.message : "";
  const isTransactionTimeout = technicalMessage.includes("expired transaction")
    || technicalMessage.includes("Transaction API error")
    || (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2028");
  if (isTransactionTimeout) {
    console.error("SALE_TRANSACTION_TIMEOUT", { code: "TRANSACTION_TIMEOUT", route: req.originalUrl, saleId: req.params.id });
    return res.status(503).json({
      code: "TRANSACTION_TIMEOUT",
      message: "A operação demorou mais que o esperado e foi cancelada com segurança. Tente novamente."
    });
  }
  const message = statusCode >= 500
    ? "Não foi possível concluir o pagamento. Nenhum valor foi registrado. Tente novamente."
    : technicalMessage || "Não foi possível concluir esta operação. Verifique os dados do pedido e tente novamente.";
  return res.status(statusCode || 500).json({ message });
}

salesRouter.get("/", async (req, res) => {
  const cid = companyId(req);
  await ensureWaitingSalesForFinishedAppointments(cid);
  await ensureSaleCodes(cid);

  const q = String(req.query.q ?? "").trim();
  const qDigits = onlyDigits(q);
  const code = qDigits ? Number(qDigits) : undefined;
  const status = saleStatuses.find((item) => item === req.query.status);
  const paymentMethod = paymentMethods.find((item) => item === req.query.paymentMethod);
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : undefined;
  if (to) to.setHours(23, 59, 59, 999);
  const operator = String(req.query.operator ?? "").trim();
  const where: any = { companyId: cid };
  const andConditions: any[] = [];
  if (status) where.status = status;
  if (paymentMethod) andConditions.push({ OR: [{ paymentMethod }, { payments: { some: { method: paymentMethod } } }] });
  if (from || to) where.createdAt = { gte: from, lte: to };
  if (operator) where.operatorName = { contains: operator, mode: "insensitive" };
  if (q) {
    andConditions.push({ OR: [
      ...(code ? [{ internalCode: code }] : []),
      { customer: { name: { contains: q, mode: "insensitive" as const } } },
      { customer: { cpf: { contains: qDigits || q } } },
      { customer: { phone: { contains: qDigits || q } } },
      { pet: { name: { contains: q, mode: "insensitive" as const } } },
      { items: { some: { description: { contains: q, mode: "insensitive" as const } } } }
    ] });
  }
  if (andConditions.length) where.AND = andConditions;

  const sales = await prisma.sale.findMany({
    where,
    include: {
      customer: { include: { pets: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }, memberships: { include: { plan: { include: { service: true } }, pet: true } } } },
      pet: true,
      appointment: { include: { service: true } },
      payments: { orderBy: { paidAt: "asc" } },
      items: { include: { service: true, product: true }, orderBy: { createdAt: "asc" } }
    },
    orderBy: { createdAt: "desc" },
    take: 80
  });
  res.json(sales);
});

salesRouter.get("/receivable/search", async (req, res) => {
  const cid = companyId(req);
  await ensureWaitingSalesForFinishedAppointments(cid);
  await ensureSaleCodes(cid);
  const q = String(req.query.q ?? "").trim().slice(0, 100);
  const qDigits = onlyDigits(q);
  const code = qDigits ? Number(qDigits) : undefined;
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(50, Math.max(5, Number.parseInt(String(req.query.limit ?? "15"), 10) || 15));
  const where: any = { companyId: cid, status: { in: [...receivableStatuses] } };
  const andConditions: any[] = [];
  const statuses = String(req.query.status ?? "").split(",").filter((status) => receivableStatuses.includes(status as typeof receivableStatuses[number]));
  if (statuses.length) where.status = { in: statuses };
  const preset = periodRange(String(req.query.period ?? "today"));
  const from = String(req.query.from ?? preset.from ?? "");
  const to = String(req.query.to ?? preset.to ?? "");
  if (from || to) where.pendingSince = {
    ...(from ? { gte: new Date(`${from}T00:00:00-03:00`) } : {}),
    ...(to ? { lte: new Date(`${to}T23:59:59.999-03:00`) } : {})
  };
  const reason = String(req.query.reason ?? "");
  if (pendingReasons.includes(reason as typeof pendingReasons[number])) where.pendingReason = reason;
  const operator = String(req.query.operator ?? "").trim();
  if (operator) where.operatorName = { contains: operator, mode: "insensitive" };
  const minValue = Number(req.query.minValue);
  const maxValue = Number(req.query.maxValue);
  where.pendingAmount = {
    gt: 0,
    ...(Number.isFinite(minValue) ? { gte: minValue } : {}),
    ...(Number.isFinite(maxValue) ? { lte: maxValue } : {})
  };
  const expectedFrom = String(req.query.expectedFrom ?? "");
  const expectedTo = String(req.query.expectedTo ?? "");
  if (expectedFrom || expectedTo) where.expectedPaymentDate = {
    ...(expectedFrom ? { gte: new Date(`${expectedFrom}T00:00:00-03:00`) } : {}),
    ...(expectedTo ? { lte: new Date(`${expectedTo}T23:59:59.999-03:00`) } : {})
  };
  if (req.query.overdue === "true") {
    where.expectedPaymentDate = { lt: new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })}T00:00:00-03:00`) };
  }
  if (q) {
    andConditions.push({ OR: [
      ...(code ? [{ internalCode: code }, { customer: { internalCode: code } }] : []),
      { customer: { name: { contains: q, mode: "insensitive" } } },
      { customer: { cpf: { contains: qDigits || q } } },
      { customer: { phone: { contains: qDigits || q } } },
      { pet: { name: { contains: q, mode: "insensitive" } } },
      { items: { some: { description: { contains: q, mode: "insensitive" } } } }
    ] });
  }
  if (andConditions.length) where.AND = andConditions;
  const order = String(req.query.order ?? "oldest");
  const orderBy: any = order === "newest" ? { pendingSince: "desc" }
    : order === "highest" ? { pendingAmount: "desc" }
    : order === "lowest" ? { pendingAmount: "asc" }
    : order === "expected" ? [{ expectedPaymentDate: { sort: "asc", nulls: "last" } }, { pendingSince: "asc" }]
    : order === "customer" ? [{ customer: { name: "asc" } }, { pendingSince: "asc" }]
    : { pendingSince: "asc" };
  const [items, total, totals] = await prisma.$transaction([
    prisma.sale.findMany({
      where,
      include: receivableSaleInclude,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.sale.count({ where }),
    prisma.sale.aggregate({ where, _sum: { total: true, paidAmount: true, pendingAmount: true } })
  ]);
  res.json({
    items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)),
    summary: {
      total: Number(totals._sum.total ?? 0),
      paid: Number(totals._sum.paidAmount ?? 0),
      pending: Number(totals._sum.pendingAmount ?? 0)
    }
  });
});

salesRouter.get("/by-code/:code/receivable", async (req, res) => {
  const cid = companyId(req);
  await ensureWaitingSalesForFinishedAppointments(cid);
  await ensureSaleCodes(cid);
  const digits = onlyDigits(req.params.code);
  const internalCode = digits ? Number(digits) : 0;
  if (!internalCode) return res.status(400).json({ code: "ORDER_NUMBER_REQUIRED", message: "Digite o número do pedido." });
  const sale = await prisma.sale.findFirst({
    where: { companyId: cid, internalCode },
    include: receivableSaleInclude
  });
  if (!sale) {
    return res.status(404).json({
      code: "ORDER_NOT_FOUND",
      message: "Pedido não encontrado.",
      details: { orderCode: `PD-${String(internalCode).padStart(6, "0")}` }
    });
  }
  if (!receivableStatuses.includes(sale.status as typeof receivableStatuses[number])) return receivableError(res, sale);
  res.json(sale);
});

salesRouter.get("/:id/receivable", async (req, res) => {
  const cid = companyId(req);
  const sale = await prisma.sale.findFirst({
    where: { id: req.params.id, companyId: cid },
    include: receivableSaleInclude
  });
  if (!sale) return res.status(404).json({ code: "ORDER_NOT_FOUND", message: "Pedido não encontrado." });
  if (!receivableStatuses.includes(sale.status as typeof receivableStatuses[number])) return receivableError(res, sale);
  res.json(sale);
});

salesRouter.get("/:id", async (req, res) => {
  const cid = companyId(req);
  await ensureWaitingSalesForFinishedAppointments(cid);
  const sale = await prisma.sale.findFirst({
    where: { id: req.params.id, companyId: cid },
    include: {
      customer: { include: { pets: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }, memberships: { include: { plan: { include: { service: true } }, pet: true } } } },
      pet: true,
      appointment: { include: { service: true } },
      payments: { orderBy: { paidAt: "asc" } },
      items: { include: { service: true, product: true }, orderBy: { createdAt: "asc" } }
    }
  });
  if (!sale) return res.status(404).json({ message: "Pedido não encontrado" });
  res.json(sale);
});

salesRouter.get("/:id/receipt", async (req, res) => {
  const cid = companyId(req);
  const receipt = await prisma.salesReceipt.findFirst({ where: { saleId: req.params.id, companyId: cid } });
  if (!receipt) return res.status(404).json({ message: "Comprovante não encontrado." });
  res.json(receipt);
});

salesRouter.get("/:id/receipt-details", async (req, res) => {
  const cid = companyId(req);
  const sale = await prisma.sale.findFirst({
    where: { id: req.params.id, companyId: cid, status: "PAID" },
    include: {
      receipt: true,
      customer: true,
      pet: true,
      cashSession: true,
      items: { include: { service: true, product: true }, orderBy: { createdAt: "asc" } },
      payments: { orderBy: { paidAt: "asc" } },
      appointment: {
        include: {
          service: true,
          membership: { include: { plan: true } },
          membershipUsage: true,
          extraServices: true
        }
      }
    }
  });
  if (!sale?.receipt) {
    return res.status(404).json({ code: "RECEIPT_NOT_FOUND", message: "Não foi possível localizar este comprovante." });
  }
  res.json(sale);
});

salesRouter.post("/", async (req, res) => {
  const cid = companyId(req);
  try {
    const body = checkoutSchema.parse(req.body);
    const cashSession = await requireOpenCashSession(cid);
    if (body.appointmentId) {
      const existingSale = await prisma.sale.findFirst({
        where: { companyId: cid, appointmentId: body.appointmentId },
        include: { customer: { include: { pets: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }, memberships: { include: { plan: { include: { service: true } }, pet: true } } } }, pet: true, appointment: true, payments: { orderBy: { paidAt: "asc" } }, items: { include: { service: true, product: true } } }
      });
      if (existingSale) return res.json(existingSale);
    }
    await validateCustomerPet(cid, body.customerId, body.petId);
    if (body.status === "PAID" && !body.paymentMethod && !body.payments?.length) {
      return res.status(400).json({ message: "Escolha a forma de pagamento." });
    }
    if (body.status === "PENDING" && (!body.pendingReason || !body.pendingNotes?.trim())) {
      return res.status(400).json({ message: "Informe o motivo e a observação do pagamento pendente." });
    }

    const itemData = await buildSaleItems(cid, body.items);
    const totals = calculateTotals(itemData, body.discountType, body.discount);
    if (body.status !== "PAID" && !body.customerId) {
      return res.status(400).json({ message: "Para registrar pagamento para depois, vincule um cliente cadastrado ao pedido." });
    }
    if (requiresDiscountApproval(totals.discountPercent) && !(await validateAdminPassword(cid, body.adminPassword))) {
      return res.status(403).json({ message: "Desconto acima de 10% exige senha do administrador." });
    }

    const operator = await operatorData(req);
    const paymentPlan = await buildPaymentPlan(cid, body, totals.total, cashSession.id, operator);
    const internalCode = await nextSaleCode(cid);
    const sale = await prisma.$transaction(async (tx) => {
      const transactionSale = await tx.sale.create({
        data: {
          companyId: cid,
          internalCode,
          customerId: body.customerId,
          petId: body.petId,
          appointmentId: body.appointmentId,
          preSaleId: body.preSaleId,
          origin: body.appointmentId ? "AGENDA" : body.preSaleId ? "PRE_SALE" : "DIRECT",
          status: paymentPlan.status,
          paymentStatus: salePaymentStatus(paymentPlan.status),
          paymentMethod: paymentPlan.primaryPayment?.method,
          cardBrand: paymentPlan.primaryPayment?.cardBrand ?? body.cardBrand,
          cardNsu: paymentPlan.primaryPayment?.cardNsu ?? body.cardNsu,
          cardAuthorization: paymentPlan.primaryPayment?.cardAuthorization ?? body.cardAuthorization,
          cashSessionId: cashSession.id,
          subtotal: totals.subtotal,
          discount: totals.discount,
          discountType: body.discountType,
          discountPercent: body.discountType === "PERCENT" ? body.discount : totals.discountPercent,
          total: totals.total,
          paidAmount: paymentPlan.paidAmount,
          pendingAmount: paymentPlan.pendingAmount,
          pendingReason: paymentPlan.status !== "PAID" ? body.pendingReason : undefined,
          pendingNotes: paymentPlan.status !== "PAID" ? body.pendingNotes : undefined,
          pendingSince: paymentPlan.status !== "PAID" ? new Date() : undefined,
          expectedPaymentDate: paymentPlan.status !== "PAID" && body.expectedPaymentDate ? new Date(`${body.expectedPaymentDate}T12:00:00-03:00`) : undefined,
          paidAt: paymentPlan.status === "PAID" ? new Date() : undefined,
          ...operator,
          payments: paymentPlan.paymentData.length ? { create: paymentPlan.paymentData } : undefined,
          items: { create: itemData }
        },
        include: { customer: { include: { pets: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }, memberships: { include: { plan: { include: { service: true } }, pet: true } } } }, pet: true, appointment: true, payments: { orderBy: { paidAt: "asc" } }, items: { include: { service: true, product: true } } }
      });
      await processStockOnce(cid, transactionSale.id, itemData, tx);
      if (!transactionSale.appointmentId) {
        await processMembershipUseOnce(cid, transactionSale.id, body.membershipId, tx);
      }
      await updateAppointmentPayment(cid, transactionSale.appointmentId, transactionSale.status, tx);
      const receipt = transactionSale.status === "PAID" ? await ensureSalesReceipt(tx, cid, transactionSale.id) : null;
      await addCustomerHistory({
        companyId: cid,
        customerId: transactionSale.customerId,
        petId: transactionSale.petId,
        appointmentId: transactionSale.appointmentId,
        saleId: transactionSale.id,
        type: "SALE",
        title: transactionSale.status === "PAID" ? "Venda paga" : transactionSale.status === "PARTIALLY_PAID" ? "Venda parcialmente paga" : "Venda pendente",
        description: transactionSale.status !== "PAID" ? `Venda marcada com saldo pendente em ${nowBR()}. ${transactionSale.pendingNotes ?? ""}` : transactionSale.items.map((item) => item.description).join(", "),
        amount: Number(transactionSale.total)
      }, tx);
      return { ...transactionSale, receipt };
    });

    res.status(201).json(sale);
  } catch (error) {
    return handleRouteError(error, req, res);
  }
});

salesRouter.patch("/:id/checkout", async (req, res) => {
  const cid = companyId(req);
  const checkoutKey = `${cid}:${req.params.id}`;
  if (checkoutInProgress.has(checkoutKey)) {
    return res.status(409).json({ message: "Este pedido já está sendo processado. Aguarde a conclusão." });
  }
  checkoutInProgress.add(checkoutKey);
  try {
    const body = checkoutSchema.parse(req.body);
    const sale = await prisma.sale.findFirst({
      where: { id: req.params.id, companyId: cid },
      include: { items: { orderBy: { createdAt: "asc" } }, payments: true, receipt: true, appointment: { include: { membershipUsage: true, membershipRenewal: true } } }
    });
    if (!sale) return res.status(404).json({ message: "Venda não encontrada" });
    if (sale.status === "PAID" && req.header("Idempotency-Key")) {
      return res.json(sale);
    }
    if (sale.status === "PAID" || sale.status === "CANCELLED") {
      return res.status(409).json({ message: "Venda paga ou cancelada não pode ser alterada." });
    }
    const lockedAppointmentSale = sale.origin === "AGENDA" && sale.appointmentId && sale.appointment?.status === "FINISHED";
    const changesLinkedCustomer = body.customerId !== undefined && body.customerId !== sale.customerId;
    const changesLinkedPet = body.petId !== undefined && body.petId !== sale.petId;
    const changesLinkedAppointment = body.appointmentId !== undefined && body.appointmentId !== sale.appointmentId;
    if (lockedAppointmentSale && (changesLinkedCustomer || changesLinkedPet || changesLinkedAppointment)) {
      return res.status(409).json({ message: "Cliente e pet não podem ser alterados em pedido vinculado a atendimento finalizado." });
    }
    const cashSession = await requireOpenCashSession(cid);
    if (body.status === "PAID" && !body.paymentMethod && !body.payments?.length) {
      return res.status(400).json({ message: "Escolha a forma de pagamento." });
    }
    if (body.status === "PENDING" && (!body.pendingReason || !body.pendingNotes?.trim())) {
      return res.status(400).json({ message: "Informe o motivo e a observação do pagamento pendente." });
    }
    const customerId = body.customerId ?? sale.customerId ?? undefined;
    const petId = body.petId ?? sale.petId ?? undefined;
    await validateCustomerPet(cid, customerId, petId);
    if (body.status !== "PAID" && !customerId) {
      return res.status(400).json({ message: "Para registrar pagamento para depois, vincule um cliente cadastrado ao pedido." });
    }

    let itemData;
    if (lockedAppointmentSale) {
      const fixedCount = sale.items.length;
      const fixedItems = sale.items.slice(0, fixedCount).map((item) => ({
        companyId: cid,
        itemType: item.itemType,
        serviceId: item.serviceId ?? undefined,
        productId: item.productId ?? undefined,
        description: item.description,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        total: Number(item.total),
        coveredByMembership: item.coveredByMembership
      }));
      const extras = body.items.slice(fixedCount);
      itemData = [...fixedItems, ...(extras.length ? await buildSaleItems(cid, extras) : [])];
    } else {
      itemData = sale.stockProcessedAt
        ? sale.items.map((item) => ({ companyId: cid, itemType: item.itemType, serviceId: item.serviceId ?? undefined, productId: item.productId ?? undefined, description: item.description, quantity: item.quantity, unitPrice: Number(item.unitPrice), total: Number(item.total), coveredByMembership: item.coveredByMembership }))
        : await buildSaleItems(cid, body.items);
    }
    const totals = calculateTotals(itemData, body.discountType, body.discount);
    if (!sale.stockProcessedAt && requiresDiscountApproval(totals.discountPercent) && !(await validateAdminPassword(cid, body.adminPassword))) {
      return res.status(403).json({ message: "Desconto acima de 10% exige senha do administrador." });
    }

    const operator = await operatorData(req);
    const paymentPlan = await buildPaymentPlan(cid, body, totals.total, cashSession.id, operator);
    const companySnapshot = await prisma.company.findUnique({
      where: { id: cid },
      select: { name: true, document: true }
    });
    if (!companySnapshot) return res.status(404).json({ message: "Empresa não encontrada." });
    const transactionStartedAt = performance.now();
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${checkoutKey}))`;
      let stepStartedAt = performance.now();
      const markStep = (step: string) => {
        const now = performance.now();
        console.info("SALE_CHECKOUT_TIMING", {
          saleId: sale.id,
          step,
          durationMs: Math.round(now - stepStartedAt),
          totalMs: Math.round(now - transactionStartedAt)
        });
        stepStartedAt = now;
      };
      const current = await tx.sale.findFirst({ where: { id: sale.id, companyId: cid }, select: { status: true } });
      markStep("lock-and-validate");
      if (!current) throw Object.assign(new Error("Venda não encontrada"), { statusCode: 404 });
      if (current.status === "PAID") throw Object.assign(new Error("Este pedido já foi pago."), { statusCode: 409 });
      if (current.status === "CANCELLED") throw Object.assign(new Error("Venda cancelada não pode ser alterada."), { statusCode: 409 });

      if (!sale.stockProcessedAt || lockedAppointmentSale) {
        await tx.saleItem.deleteMany({ where: { saleId: sale.id, companyId: cid } });
        await tx.saleItem.createMany({ data: itemData.map((item) => ({ ...item, saleId: sale.id })) });
      }
      markStep("items");

      await tx.salePayment.deleteMany({ where: { saleId: sale.id, companyId: cid } });
      const transactionSale = await tx.sale.update({
        where: { id: sale.id },
        data: {
          customerId,
          petId,
          status: paymentPlan.status,
          paymentStatus: salePaymentStatus(paymentPlan.status),
          paymentMethod: paymentPlan.primaryPayment?.method,
          cardBrand: paymentPlan.primaryPayment?.cardBrand ?? body.cardBrand,
          cardNsu: paymentPlan.primaryPayment?.cardNsu ?? body.cardNsu,
          cardAuthorization: paymentPlan.primaryPayment?.cardAuthorization ?? body.cardAuthorization,
          cashSessionId: sale.cashSessionId ?? cashSession.id,
          subtotal: totals.subtotal,
          discount: totals.discount,
          discountType: body.discountType,
          discountPercent: body.discountType === "PERCENT" ? body.discount : totals.discountPercent,
          total: totals.total,
          paidAmount: paymentPlan.paidAmount,
          pendingAmount: paymentPlan.pendingAmount,
          pendingReason: paymentPlan.status !== "PAID" ? body.pendingReason : undefined,
          pendingNotes: paymentPlan.status !== "PAID" ? body.pendingNotes : undefined,
          pendingSince: paymentPlan.status !== "PAID" ? sale.pendingSince ?? new Date() : sale.pendingSince,
          expectedPaymentDate: paymentPlan.status !== "PAID"
            ? body.expectedPaymentDate ? new Date(`${body.expectedPaymentDate}T12:00:00-03:00`) : sale.expectedPaymentDate
            : sale.expectedPaymentDate,
          paidAt: paymentPlan.status === "PAID" ? new Date() : sale.paidAt,
          ...operator,
          payments: paymentPlan.paymentData.length ? { create: paymentPlan.paymentData } : undefined
        },
        include: {
          customer: { include: { pets: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }, memberships: { include: { plan: { include: { service: true } }, pet: true } } } },
          pet: true,
          appointment: { include: { service: true } },
          payments: { orderBy: { paidAt: "asc" } },
          items: { include: { service: true, product: true }, orderBy: { createdAt: "asc" } }
        }
      });
      markStep("sale-and-payments");

      await processStockOnce(cid, transactionSale.id, itemData, tx);
      if (!transactionSale.appointmentId) {
        await processMembershipUseOnce(cid, transactionSale.id, body.membershipId, tx);
      }
      if (transactionSale.appointmentId && transactionSale.status === "PAID") {
        await completeMembershipRenewalOnce(tx, cid, transactionSale.appointmentId, req.user?.userId);
      }
      markStep("stock-and-membership");
      await updateAppointmentPayment(cid, transactionSale.appointmentId, transactionSale.status, tx);
      const receipt = transactionSale.status === "PAID"
        ? await ensureSalesReceipt(tx, cid, transactionSale.id, transactionSale, companySnapshot)
        : null;
      markStep("appointment-and-receipt");
      await addCustomerHistory({
        companyId: cid,
        customerId: transactionSale.customerId,
        petId: transactionSale.petId,
        appointmentId: transactionSale.appointmentId,
        saleId: transactionSale.id,
        type: "SALE",
        title: transactionSale.status === "PAID" ? "Pagamento realizado" : transactionSale.status === "PARTIALLY_PAID" ? "Pagamento parcial" : "Pagamento pendente",
        description: transactionSale.status !== "PAID" ? `Venda marcada com saldo pendente em ${nowBR()}. ${transactionSale.pendingNotes ?? ""}` : `Forma de pagamento: ${transactionSale.paymentMethod}`,
        amount: Number(transactionSale.total)
      }, tx);
      markStep("history");
      return { ...transactionSale, receipt };
    }, { maxWait: 10000, timeout: 15000 });
    console.info("SALE_CHECKOUT_TIMING", {
      saleId: sale.id,
      step: "committed",
      durationMs: Math.round(performance.now() - transactionStartedAt)
    });

    res.json(updated);
  } catch (error) {
    return handleRouteError(error, req, res);
  } finally {
    checkoutInProgress.delete(checkoutKey);
  }
});

salesRouter.patch("/:id/cancel", async (req, res) => {
  const cid = companyId(req);
  const body = z.object({ adminPassword: z.string().min(1), reason: z.string().min(3) }).parse(req.body);
  if (!(await validateAdminPassword(cid, body.adminPassword))) {
    return res.status(403).json({ message: "Senha do administrador incorreta." });
  }
  const sale = await prisma.sale.findFirst({ where: { id: req.params.id, companyId: cid }, include: { appointment: true } });
  if (!sale) return res.status(404).json({ message: "Venda não encontrada" });
  if (sale.status === "CANCELLED") return res.json(sale);
  if (sale.appointment?.status === "FINISHED") {
    return res.status(409).json({
      message: "Este pedido pertence a um atendimento concluído. Ele não pode ser descartado; registre o pagamento ou marque como pagar depois."
    });
  }
  const operator = await operatorData(req);
  const updated = await prisma.sale.update({
    where: { id: sale.id },
    data: {
      status: "CANCELLED",
      paymentStatus: "CANCELLED",
      cancelReason: body.reason,
      cancelledAt: new Date(),
      ...operator
    },
    include: { customer: { include: { pets: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }, memberships: { include: { plan: { include: { service: true } }, pet: true } } } }, pet: true, appointment: true, payments: { orderBy: { paidAt: "asc" } }, items: { include: { service: true, product: true } } }
  });
  await updateAppointmentPayment(cid, updated.appointmentId, "CANCELLED");
  await addCustomerHistory({
    companyId: cid,
    customerId: updated.customerId,
    petId: updated.petId,
    appointmentId: updated.appointmentId,
    saleId: updated.id,
    type: "SALE",
    title: "Venda cancelada",
    description: `Venda cancelada em ${nowBR()}. Motivo: ${body.reason}`,
    amount: Number(updated.total)
  });
  res.json(updated);
});
