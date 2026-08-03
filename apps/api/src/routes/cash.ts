import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import type { Request } from "express";
import { companyId } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

export const cashRouter = Router();

const paymentMethods = ["PIX", "CASH", "DEBIT", "CREDIT", "TRANSFER", "VOUCHER", "OTHER"] as const;
const preSaleItemSchema = z.object({
  itemType: z.enum(["SERVICE", "PRODUCT"]),
  serviceId: z.string().optional(),
  productId: z.string().optional(),
  quantity: z.coerce.number().int().positive().default(1)
});

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

async function syncCashSessionCounter(cid: string, nextValue: number) {
  const counter = await prisma.internalCodeCounter.findUnique({
    where: { companyId_kind: { companyId: cid, kind: "CASH_SESSION" } },
    select: { id: true, nextValue: true }
  });
  if (!counter) {
    await prisma.internalCodeCounter.create({ data: { companyId: cid, kind: "CASH_SESSION", nextValue } });
    return;
  }
  if (counter.nextValue < nextValue) {
    await prisma.internalCodeCounter.update({ where: { id: counter.id }, data: { nextValue } });
  }
}

async function ensureCashSessionCodes(cid: string) {
  const missingCodes = await prisma.cashSession.findMany({
    where: { companyId: cid, internalCode: null },
    orderBy: { openedAt: "asc" },
    select: { id: true }
  });
  const last = await prisma.cashSession.findFirst({
    where: { companyId: cid, internalCode: { not: null } },
    orderBy: { internalCode: "desc" },
    select: { internalCode: true }
  });
  const counter = await prisma.internalCodeCounter.findUnique({
    where: { companyId_kind: { companyId: cid, kind: "CASH_SESSION" } },
    select: { nextValue: true }
  });
  let nextCode = Math.max((last?.internalCode ?? 0) + 1, counter?.nextValue ?? 1);
  for (const session of missingCodes) {
    await prisma.cashSession.update({ where: { id: session.id }, data: { internalCode: nextCode++ } });
  }
  await syncCashSessionCounter(cid, nextCode);
}

async function nextCashSessionCode(cid: string) {
  await ensureCashSessionCodes(cid);
  const counter = await prisma.internalCodeCounter.upsert({
    where: { companyId_kind: { companyId: cid, kind: "CASH_SESSION" } },
    update: { nextValue: { increment: 1 } },
    create: { companyId: cid, kind: "CASH_SESSION", nextValue: 2 },
    select: { nextValue: true }
  });
  return counter.nextValue - 1;
}

async function nextInternalCode(cid: string, kind: string) {
  const counter = await prisma.internalCodeCounter.upsert({
    where: { companyId_kind: { companyId: cid, kind } },
    update: { nextValue: { increment: 1 } },
    create: { companyId: cid, kind, nextValue: 2 },
    select: { nextValue: true }
  });
  return counter.nextValue - 1;
}

async function buildPreSaleItems(cid: string, rawItems: z.infer<typeof preSaleItemSchema>[]) {
  const serviceIds = [...new Set(rawItems.map((item) => item.serviceId).filter(Boolean) as string[])];
  const productIds = [...new Set(rawItems.map((item) => item.productId).filter(Boolean) as string[])];
  const [services, products] = await Promise.all([
    serviceIds.length ? prisma.service.findMany({ where: { id: { in: serviceIds }, companyId: cid, active: true } }) : [],
    productIds.length ? prisma.product.findMany({ where: { id: { in: productIds }, companyId: cid, active: true } }) : []
  ]);
  const servicesById = new Map(services.map((service) => [service.id, service]));
  const productsById = new Map(products.map((product) => [product.id, product]));

  return rawItems.map((item) => {
    if (item.itemType === "SERVICE") {
      const service = item.serviceId ? servicesById.get(item.serviceId) : null;
      if (!service) throw Object.assign(new Error("Serviço de pré-venda não encontrado ou inativo."), { statusCode: 404 });
      const unitPrice = Number(service.price);
      return { companyId: cid, itemType: "SERVICE" as const, serviceId: service.id, description: service.name, quantity: item.quantity, unitPrice, total: item.quantity * unitPrice };
    }
    const product = item.productId ? productsById.get(item.productId) : null;
    if (!product) throw Object.assign(new Error("Produto de pré-venda não encontrado ou inativo."), { statusCode: 404 });
    const unitPrice = Number(product.salePrice);
    return { companyId: cid, itemType: "PRODUCT" as const, productId: product.id, description: product.name, quantity: item.quantity, unitPrice, total: item.quantity * unitPrice };
  });
}

async function validateCustomerPet(cid: string, customerId?: string, petId?: string) {
  if (!customerId && !petId) return;
  if (!customerId || !petId) {
    throw Object.assign(new Error("Selecione cliente e pet ou use Consumidor final."), { statusCode: 400 });
  }
  const pet = await prisma.pet.findFirst({ where: { id: petId, customerId, companyId: cid } });
  if (!pet) throw Object.assign(new Error("Cliente ou pet nÃ£o encontrado."), { statusCode: 404 });
}

function routeError(error: unknown, res: import("express").Response) {
  const statusCode = typeof error === "object" && error && "statusCode" in error ? Number((error as { statusCode: number }).statusCode) : 500;
  const message = error instanceof Error ? error.message : "Erro ao processar operação do caixa";
  return res.status(statusCode || 500).json({ message });
}

async function openCashSession(cid: string) {
  await ensureCashSessionCodes(cid);
  return prisma.cashSession.findFirst({
    where: { companyId: cid, status: "OPEN" },
    include: { movements: { orderBy: { createdAt: "desc" } } },
    orderBy: { openedAt: "desc" }
  });
}

async function sessionSummary(cid: string, cashSessionId: string) {
  const session = await prisma.cashSession.findFirst({
    where: { id: cashSessionId, companyId: cid },
    include: { movements: { orderBy: { createdAt: "asc" } } }
  });
  if (!session) return null;

  const sales = await prisma.sale.findMany({
    where: { companyId: cid, cashSessionId },
    include: { payments: true, items: { include: { service: true, product: true } }, customer: true, pet: true }
  });

  const totalsByMethod = Object.fromEntries(paymentMethods.map((method) => [method, 0])) as Record<typeof paymentMethods[number], number>;
  let pendingTotal = 0;
  let cancelledTotal = 0;
  let discountsTotal = 0;
  for (const sale of sales) {
    const total = Number(sale.total);
    discountsTotal += Number(sale.discount);
    if (sale.status !== "CANCELLED" && sale.status !== "REFUNDED" && sale.payments.length) {
      for (const payment of sale.payments) totalsByMethod[payment.method] += Number(payment.amount);
    }
    if (sale.status === "PENDING" || sale.status === "PARTIALLY_PAID") pendingTotal += Number(sale.pendingAmount || total);
    if (sale.status === "CANCELLED") cancelledTotal += total;
  }

  const cashIn = session.movements.filter((movement) => ["CASH_IN", "TRANSFER_IN", "ADJUSTMENT"].includes(movement.type)).reduce((sum, movement) => sum + Number(movement.amount), 0);
  const cashOut = session.movements.filter((movement) => ["CASH_OUT", "EXPENSE", "TRANSFER_OUT"].includes(movement.type)).reduce((sum, movement) => sum + Number(movement.amount), 0);
  const totalReceived = Object.values(totalsByMethod).reduce((sum, value) => sum + value, 0);
  const expectedCash = Number(session.openingAmount) + totalsByMethod.CASH + cashIn - cashOut;

  return { session, sales, totalsByMethod, pendingTotal, cancelledTotal, discountsTotal, cashIn, cashOut, totalReceived, expectedCash };
}

function periodFromQuery(req: Request) {
  const now = new Date();
  const atSaoPaulo = (value: string, endOfDay = false) =>
    new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}-03:00`);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now);
  const from = atSaoPaulo(String(req.query.from ?? today));
  const to = req.query.to ? atSaoPaulo(String(req.query.to), true) : now;
  return { from, to };
}

async function cashReportSummary(req: Request, res: import("express").Response) {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ message: "Você não possui permissão para executar esta ação." });
  const cid = companyId(req);
  const { from, to } = periodFromQuery(req);
  const cashSessionId = req.query.cashSessionId ? String(req.query.cashSessionId) : undefined;
  const cashSessionFilter = cashSessionId ? { cashSessionId } : {};
  const sessions = await prisma.cashSession.findMany({
    where: cashSessionId
      ? { companyId: cid, id: cashSessionId }
      : { companyId: cid, openedAt: { lte: to }, OR: [{ closedAt: null }, { closedAt: { gte: from } }] },
    include: { movements: { orderBy: { createdAt: "asc" } } },
    orderBy: { openedAt: "asc" }
  });
  const sales = await prisma.sale.findMany({
    where: { companyId: cid, ...cashSessionFilter, ...(cashSessionId ? {} : { createdAt: { gte: from, lte: to } }) },
    include: { items: { include: { service: true, product: true } } }
  });
  const receivedPayments = await prisma.salePayment.findMany({
    where: {
      companyId: cid,
      ...cashSessionFilter,
      ...(cashSessionId ? {} : { paidAt: { gte: from, lte: to } }),
      sale: { status: { notIn: ["CANCELLED", "REFUNDED"] } }
    },
    include: { sale: { include: { customer: true, pet: true, receipt: true } } },
    orderBy: { paidAt: "asc" }
  });
  const totalsByMethod = Object.fromEntries(paymentMethods.map((method) => [method, 0])) as Record<typeof paymentMethods[number], number>;
  const byOperator = new Map<string, number>();
  const byService = new Map<string, number>();
  const byProduct = new Map<string, number>();
  const byHour = new Map<string, number>();
  let pendingTotal = 0;
  let cancelledTotal = 0;
  let discountsTotal = 0;

  for (const payment of receivedPayments) {
    const amount = Number(payment.amount);
    totalsByMethod[payment.method] += amount;
    const operatorName = payment.operatorName ?? "Não informado";
    byOperator.set(operatorName, (byOperator.get(operatorName) ?? 0) + amount);
    const hour = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false
    }).format(payment.paidAt);
    byHour.set(hour, (byHour.get(hour) ?? 0) + amount);
  }

  for (const sale of sales) {
    const total = Number(sale.total);
    discountsTotal += Number(sale.discount);
    if (sale.status === "PENDING" || sale.status === "PARTIALLY_PAID") pendingTotal += Number(sale.pendingAmount || total);
    if (sale.status === "CANCELLED") cancelledTotal += total;
    for (const item of sale.items) {
      if (item.itemType === "SERVICE") byService.set(item.description, (byService.get(item.description) ?? 0) + Number(item.total));
      if (item.itemType === "PRODUCT") byProduct.set(item.description, (byProduct.get(item.description) ?? 0) + Number(item.total));
    }
  }

  return res.json({
    from,
    to,
    sessions,
    totalsByMethod,
    totalReceived: Object.values(totalsByMethod).reduce((sum, value) => sum + value, 0),
    pendingTotal,
    cancelledTotal,
    discountsTotal,
    paymentDetails: receivedPayments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      amount: Number(payment.amount),
      cardBrand: payment.cardBrand,
      cardNsu: payment.cardNsu,
      cardAuthorization: payment.cardAuthorization,
      installments: payment.installments,
      pixReference: payment.pixReference,
      cashReceived: payment.cashReceived == null ? null : Number(payment.cashReceived),
      changeAmount: payment.changeAmount == null ? null : Number(payment.changeAmount),
      paidAt: payment.paidAt,
      saleCode: payment.sale.internalCode,
      receiptCode: payment.sale.receipt?.receiptCode ?? null,
      customerName: payment.sale.customer?.name ?? "Consumidor final",
      petName: payment.sale.pet?.name ?? null,
      operatorName: payment.operatorName ?? payment.sale.operatorName ?? "Não informado"
    })),
    byOperator: [...byOperator.entries()].map(([name, total]) => ({ name, total })),
    byService: [...byService.entries()].map(([name, total]) => ({ name, total })),
    byProduct: [...byProduct.entries()].map(([name, total]) => ({ name, total })),
    byHour: [...byHour.entries()].map(([hour, total]) => ({ hour, total }))
  });
}

cashRouter.get("/current", async (req, res) => {
  const cid = companyId(req);
  const session = await openCashSession(cid);
  res.json({ session });
});

cashRouter.post("/open", async (req, res) => {
  const cid = companyId(req);
  const body = z.object({ openingAmount: z.coerce.number().nonnegative().default(0), notes: z.string().optional() }).parse(req.body);
  const current = await openCashSession(cid);
  if (current) return res.status(409).json({ message: "Já existe um caixa aberto." });
  const operator = await operatorData(req);
  const session = await prisma.cashSession.create({
    data: {
      companyId: cid,
      internalCode: await nextCashSessionCode(cid),
      openingAmount: body.openingAmount,
      notes: body.notes,
      openedById: operator.operatorId,
      openedByName: operator.operatorName
    },
    include: { movements: true }
  });
  res.status(201).json(session);
});

cashRouter.get("/reports/summary", cashReportSummary);

cashRouter.get("/pre-sales", async (req, res) => {
  const cid = companyId(req);
  const status = String(req.query.status ?? "OPEN");
  const preSales = await prisma.preSale.findMany({
    where: { companyId: cid, status: ["OPEN", "CONVERTED", "EXPIRED", "CANCELLED"].includes(status) ? status as "OPEN" | "CONVERTED" | "EXPIRED" | "CANCELLED" : undefined },
    include: { customer: { include: { pets: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } } }, pet: true, items: { include: { service: true, product: true }, orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
    take: 80
  });
  res.json(preSales);
});

cashRouter.post("/pre-sales", async (req, res) => {
  const cid = companyId(req);
  try {
    const body = z.object({
      customerId: z.string().optional(),
      petId: z.string().optional(),
      notes: z.string().optional(),
      expiresAt: z.string().optional(),
      discount: z.coerce.number().nonnegative().default(0),
      items: z.array(preSaleItemSchema).min(1)
    }).parse(req.body);
    await validateCustomerPet(cid, body.customerId, body.petId);
    const items = await buildPreSaleItems(cid, body.items);
    const subtotal = items.reduce((sum, item) => sum + item.total, 0);
    const discount = Math.min(subtotal, body.discount);
    const operator = await operatorData(req);
    const preSale = await prisma.preSale.create({
      data: {
        companyId: cid,
        internalCode: await nextInternalCode(cid, "PRE_SALE"),
        customerId: body.customerId,
        petId: body.petId,
        operatorId: operator.operatorId,
        operatorName: operator.operatorName,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        subtotal,
        discount,
        total: Math.max(0, subtotal - discount),
        notes: body.notes,
        items: { create: items }
      },
      include: { customer: { include: { pets: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } } }, pet: true, items: { include: { service: true, product: true } } }
    });
    res.status(201).json(preSale);
  } catch (error) {
    return routeError(error, res);
  }
});

cashRouter.post("/pre-sales/:id/convert", async (req, res) => {
  const cid = companyId(req);
  const preSale = await prisma.preSale.findFirst({
    where: { id: req.params.id, companyId: cid, status: "OPEN" },
    include: { items: true }
  });
  if (!preSale) return res.status(404).json({ message: "Pré-venda aberta não encontrada." });
  const existing = await prisma.sale.findFirst({ where: { companyId: cid, preSaleId: preSale.id }, include: { customer: { include: { pets: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }, memberships: { include: { plan: { include: { service: true } }, pet: true } } } }, pet: true, payments: { orderBy: { paidAt: "asc" } }, items: { include: { service: true, product: true } } } });
  if (existing) return res.json(existing);

  const sale = await prisma.sale.create({
    data: {
      companyId: cid,
      internalCode: await nextInternalCode(cid, "SALE"),
      preSaleId: preSale.id,
      customerId: preSale.customerId,
      petId: preSale.petId,
      origin: "PRE_SALE",
      status: "WAITING_PAYMENT",
      paymentStatus: "PENDING",
      subtotal: preSale.subtotal,
      discount: preSale.discount,
      total: preSale.total,
      pendingAmount: preSale.total,
      items: {
        create: preSale.items.map((item) => ({
          companyId: cid,
          itemType: item.itemType,
          serviceId: item.serviceId,
          productId: item.productId,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total
        }))
      }
    },
    include: { customer: { include: { pets: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }, memberships: { include: { plan: { include: { service: true } }, pet: true } } } }, pet: true, payments: { orderBy: { paidAt: "asc" } }, items: { include: { service: true, product: true } } }
  });
  await prisma.preSale.update({ where: { id: preSale.id }, data: { status: "CONVERTED", convertedSaleId: sale.id } });
  res.json(sale);
});

cashRouter.patch("/pre-sales/:id/cancel", async (req, res) => {
  const cid = companyId(req);
  const body = z.object({ reason: z.string().optional() }).parse(req.body);
  const preSale = await prisma.preSale.updateMany({ where: { id: req.params.id, companyId: cid, status: "OPEN" }, data: { status: "CANCELLED", notes: body.reason } });
  if (!preSale.count) return res.status(404).json({ message: "Pré-venda aberta não encontrada." });
  res.json({ ok: true });
});

cashRouter.get("/:id/summary", async (req, res) => {
  const summary = await sessionSummary(companyId(req), req.params.id);
  if (!summary) return res.status(404).json({ message: "Sessão de caixa não encontrada." });
  res.json(summary);
});

cashRouter.post("/:id/movements", async (req, res) => {
  const cid = companyId(req);
  const body = z.object({
    type: z.enum(["CASH_IN", "CASH_OUT", "EXPENSE", "TRANSFER_IN", "TRANSFER_OUT", "ADJUSTMENT"]),
    amount: z.coerce.number().positive(),
    reason: z.string().min(2),
    notes: z.string().optional(),
    originAccount: z.string().optional(),
    destinationAccount: z.string().optional(),
    transferId: z.string().optional(),
    adminPassword: z.string().optional()
  }).parse(req.body);
  const session = await prisma.cashSession.findFirst({ where: { id: req.params.id, companyId: cid, status: "OPEN" } });
  if (!session) return res.status(404).json({ message: "Caixa aberto não encontrado." });
  if (["CASH_OUT", "EXPENSE", "TRANSFER_OUT", "ADJUSTMENT"].includes(body.type) && !(await validateAdminPassword(cid, body.adminPassword))) {
    return res.status(403).json({ message: "Esta movimentação exige senha do administrador." });
  }
  const operator = await operatorData(req);
  const movement = await prisma.cashMovement.create({
    data: {
      companyId: cid,
      cashSessionId: session.id,
      internalCode: await nextInternalCode(cid, "CASH_MOVEMENT"),
      type: body.type,
      amount: body.amount,
      reason: body.reason,
      notes: body.notes,
      originAccount: body.originAccount,
      destinationAccount: body.destinationAccount,
      transferId: body.transferId,
      operatorId: operator.operatorId,
      operatorName: operator.operatorName
    }
  });
  res.status(201).json(movement);
});

cashRouter.post("/:id/close", async (req, res) => {
  const cid = companyId(req);
  const body = z.object({ countedCashAmount: z.coerce.number().nonnegative(), differenceReason: z.string().optional(), adminPassword: z.string().optional() }).parse(req.body);
  if (!(await validateAdminPassword(cid, body.adminPassword))) {
    return res.status(403).json({ message: "Senha do administrador incorreta." });
  }
  const summary = await sessionSummary(cid, req.params.id);
  if (!summary || summary.session.status !== "OPEN") return res.status(404).json({ message: "Caixa aberto não encontrado." });
  const difference = Number((body.countedCashAmount - summary.expectedCash).toFixed(2));
  if (difference !== 0 && !body.differenceReason?.trim()) {
    return res.status(400).json({ message: "Informe o motivo da diferença para fechar o caixa." });
  }
  const operator = await operatorData(req);
  const closed = await prisma.cashSession.update({
    where: { id: summary.session.id },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      closedById: operator.operatorId,
      closedByName: operator.operatorName,
      closingCashAmount: body.countedCashAmount,
      expectedCashAmount: summary.expectedCash,
      difference,
      differenceReason: body.differenceReason
    },
    include: { movements: true }
  });
  res.json(closed);
});

/*
cashRouter.get("/reports/summary", async (req, res) => {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ message: "Você não possui permissão para executar esta ação." });
  const cid = companyId(req);
  const { from, to } = periodFromQuery(req);
  const sales = await prisma.sale.findMany({
    where: { companyId: cid, createdAt: { gte: from, lte: to } },
    include: { items: { include: { service: true, product: true } } }
  });
  const totalsByMethod = Object.fromEntries(paymentMethods.map((method) => [method, 0])) as Record<typeof paymentMethods[number], number>;
  const byOperator = new Map<string, number>();
  const byService = new Map<string, number>();
  const byProduct = new Map<string, number>();
  const byHour = new Map<string, number>();
  let pendingTotal = 0;
  let cancelledTotal = 0;
  let discountsTotal = 0;

  for (const sale of sales) {
    const total = Number(sale.total);
    discountsTotal += Number(sale.discount);
    if (sale.status === "PAID" && sale.paymentMethod) totalsByMethod[sale.paymentMethod] += total;
    if (sale.status === "PENDING") pendingTotal += total;
    if (sale.status === "CANCELLED") cancelledTotal += total;
    byOperator.set(sale.operatorName ?? "Não informado", (byOperator.get(sale.operatorName ?? "Não informado") ?? 0) + total);
    byHour.set(String(sale.createdAt.getHours()).padStart(2, "0"), (byHour.get(String(sale.createdAt.getHours()).padStart(2, "0")) ?? 0) + total);
    for (const item of sale.items) {
      if (item.itemType === "SERVICE") byService.set(item.description, (byService.get(item.description) ?? 0) + Number(item.total));
      if (item.itemType === "PRODUCT") byProduct.set(item.description, (byProduct.get(item.description) ?? 0) + Number(item.total));
    }
  }

  res.json({
    from,
    to,
    totalsByMethod,
    totalReceived: Object.values(totalsByMethod).reduce((sum, value) => sum + value, 0),
    pendingTotal,
    cancelledTotal,
    discountsTotal,
    byOperator: [...byOperator.entries()].map(([name, total]) => ({ name, total })),
    byService: [...byService.entries()].map(([name, total]) => ({ name, total })),
    byProduct: [...byProduct.entries()].map(([name, total]) => ({ name, total })),
    byHour: [...byHour.entries()].map(([hour, total]) => ({ hour, total }))
  });
});
*/
