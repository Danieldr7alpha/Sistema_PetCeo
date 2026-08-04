import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { companyId, requireAdmin } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

export const membershipsRouter = Router();

async function nextMembershipSaleCode(tx: any, cid: string) {
  const last = await tx.sale.findFirst({ where: { companyId: cid, internalCode: { not: null } }, orderBy: { internalCode: "desc" }, select: { internalCode: true } });
  const minimum = (last?.internalCode ?? 0) + 1;
  const current = await tx.internalCodeCounter.findUnique({ where: { companyId_kind: { companyId: cid, kind: "SALE" } }, select: { nextValue: true } });
  const nextValue = Math.max(minimum, current?.nextValue ?? 1);
  await tx.internalCodeCounter.upsert({ where: { companyId_kind: { companyId: cid, kind: "SALE" } }, update: { nextValue: nextValue + 1 }, create: { companyId: cid, kind: "SALE", nextValue: nextValue + 1 } });
  return nextValue;
}

membershipsRouter.get("/plans", async (req, res) => {
  res.json(await prisma.membershipPlan.findMany({ where: { companyId: companyId(req) }, include: { service: true }, orderBy: { name: "asc" } }));
});

membershipsRouter.get("/pet/:petId/options", async (req, res) => {
  const cid = companyId(req);
  const pet = await prisma.pet.findFirst({ where: { id: req.params.petId, companyId: cid } });
  if (!pet) return res.status(404).json({ message: "Pet não encontrado." });
  const memberships = await prisma.customerMembership.findMany({
    where: { companyId: cid, customerId: pet.customerId, petId: pet.id, status: { not: "CANCELLED" } },
    include: {
      customer: true,
      pet: true,
      plan: { include: { service: true } },
      usages: { where: { status: "RESERVED" }, select: { id: true } }
    },
    orderBy: { endDate: "asc" }
  });
  const now = new Date();
  res.json(memberships.map(({ usages, ...membership }) => {
    const reservedUses = usages.length;
    const availableUses = Math.max(0, membership.remainingUses - reservedUses);
    const expired = membership.endDate < now;
    const active = membership.status === "ACTIVE";
    return {
      ...membership,
      reservedUses,
      availableUses,
      usable: active && !expired && availableUses > 0,
      unavailableReason: expired || membership.status === "EXPIRED" ? "EXPIRED" : membership.status === "PENDING_PAYMENT" ? "PENDING_PAYMENT" : !active ? "INACTIVE" : availableUses <= 0 ? "NO_BALANCE" : null
    };
  }));
});

membershipsRouter.post("/plans", async (req, res) => {
  const body = z.object({
    name: z.string(),
    serviceId: z.string(),
    usageQuantity: z.coerce.number(),
    validityDays: z.coerce.number(),
    suggestedFrequencyDays: z.coerce.number(),
    price: z.coerce.number(),
    active: z.boolean().default(true)
  }).parse(req.body);
  const service = await prisma.service.findFirst({ where: { id: body.serviceId, companyId: companyId(req) } });
  if (!service) return res.status(404).json({ message: "Serviço não encontrado" });
  res.status(201).json(await prisma.membershipPlan.create({ data: { ...body, companyId: companyId(req) } }));
});

membershipsRouter.patch("/plans/:id", async (req, res) => {
  const cid = companyId(req);
  const body = z.object({
    name: z.string().optional(),
    serviceId: z.string().optional(),
    usageQuantity: z.coerce.number().optional(),
    validityDays: z.coerce.number().optional(),
    suggestedFrequencyDays: z.coerce.number().optional(),
    price: z.coerce.number().optional(),
    active: z.boolean().optional()
  }).parse(req.body);
  if (body.serviceId) {
    const service = await prisma.service.findFirst({ where: { id: body.serviceId, companyId: cid } });
    if (!service) return res.status(404).json({ message: "Serviço não encontrado" });
  }
  await prisma.membershipPlan.updateMany({ where: { id: req.params.id, companyId: cid }, data: body });
  const plan = await prisma.membershipPlan.findFirst({ where: { id: req.params.id, companyId: cid }, include: { service: true } });
  if (!plan) return res.status(404).json({ message: "Plano não encontrado" });
  res.json(plan);
});

membershipsRouter.delete("/plans/:id", requireAdmin, async (req, res) => {
  const cid = companyId(req);
  const body = z.object({ password: z.string().min(1) }).parse(req.body);
  const user = await prisma.user.findFirst({ where: { id: req.user?.userId, companyId: cid, role: "ADMIN" } });
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
    return res.status(401).json({ message: "Senha de administrador incorreta" });
  }

  const plan = await prisma.membershipPlan.findFirst({ where: { id: req.params.id, companyId: cid } });
  if (!plan) return res.status(404).json({ message: "Plano não encontrado" });

  const linkedMemberships = await prisma.customerMembership.count({ where: { planId: plan.id, companyId: cid } });
  if (linkedMemberships > 0) {
    const updated = await prisma.membershipPlan.update({
      where: { id: plan.id },
      data: { active: false },
      include: { service: true }
    });
    return res.json({ mode: "soft-delete", plan: updated });
  }

  await prisma.membershipPlan.delete({ where: { id: plan.id } });
  return res.json({ mode: "delete" });
});

membershipsRouter.get("/", async (req, res) => {
  const cid = companyId(req);
  const status = String(req.query.status ?? "ALL");
  const today = new Date();
  const inSevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  res.json(await prisma.customerMembership.findMany({
    where: {
      companyId: cid,
      status: ["ACTIVE", "PENDING_PAYMENT", "EXPIRED", "CANCELLED"].includes(status) ? status as "ACTIVE" | "PENDING_PAYMENT" | "EXPIRED" | "CANCELLED" : undefined,
      endDate: status === "EXPIRING" ? { gte: today, lte: inSevenDays } : undefined
    },
    include: { customer: true, pet: true, plan: { include: { service: true } }, purchaseSale: { select: { id: true, internalCode: true, status: true } } },
    orderBy: { endDate: "asc" }
  }));
});

membershipsRouter.post("/", async (req, res) => {
  const cid = companyId(req);
  const body = z.object({ customerId: z.string(), petId: z.string(), planId: z.string(), preferredWeekday: z.coerce.number().int().min(0).max(6), preferredTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).parse(req.body);
  const plan = await prisma.membershipPlan.findFirstOrThrow({ where: { id: body.planId, companyId: cid, active: true } });
  const pet = await prisma.pet.findFirst({ where: { id: body.petId, customerId: body.customerId, companyId: cid } });
  if (!pet) return res.status(404).json({ message: "Cliente ou pet não encontrado" });
  const activeMembership = await prisma.customerMembership.findFirst({
    where: {
      companyId: cid,
      customerId: body.customerId,
      petId: body.petId,
      planId: body.planId,
      status: { in: ["ACTIVE", "PENDING_PAYMENT"] }
    }
  });
  if (activeMembership) {
    return res.status(409).json({ message: activeMembership.status === "PENDING_PAYMENT" ? "Já existe um pedido aguardando pagamento para este plano." : "Este cliente já possui uma mensalidade ativa para este plano." });
  }
  const now = new Date(); const provisionalEnd = new Date(now.getTime() + plan.validityDays * 86_400_000);
  const result = await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.create({ data: {
      companyId: cid, internalCode: await nextMembershipSaleCode(tx, cid), customerId: body.customerId, petId: body.petId,
      origin: "DIRECT", status: "WAITING_PAYMENT", paymentStatus: "PENDING", pendingSince: now,
      subtotal: plan.price, total: plan.price, paidAmount: 0, pendingAmount: plan.price, stockProcessedAt: now,
      operatorId: req.user?.userId,
      items: { create: [{ companyId: cid, itemType: "SERVICE", serviceId: plan.serviceId, description: `Plano mensalista — ${plan.name}`, quantity: 1, unitPrice: plan.price, total: plan.price }] }
    } });
    const membership = await tx.customerMembership.create({ data: {
      companyId: cid, customerId: body.customerId, petId: body.petId, planId: body.planId, startDate: now, endDate: provisionalEnd,
      totalUses: plan.usageQuantity, remainingUses: plan.usageQuantity, status: "PENDING_PAYMENT",
      preferredWeekday: body.preferredWeekday, preferredTime: body.preferredTime, purchaseSaleId: sale.id
    }, include: { customer: true, pet: true, plan: { include: { service: true } }, purchaseSale: { select: { id: true, internalCode: true, status: true } } } });
    await tx.customerHistory.create({ data: { companyId: cid, customerId: body.customerId, petId: body.petId, membershipId: membership.id, saleId: sale.id, type: "MEMBERSHIP", title: "Plano aguardando pagamento", description: `${plan.name} · Pedido PD-${String(sale.internalCode).padStart(5, "0")}` } });
    return { membership, sale: { id: sale.id, internalCode: sale.internalCode } };
  });
  res.status(201).json(result);
});

membershipsRouter.post("/renewals/:id/sale", async (req, res) => {
  const cid = companyId(req);
  const renewal = await prisma.membershipRenewal.findFirst({
    where: { id: req.params.id, companyId: cid, status: "PENDING_PAYMENT" },
    include: { plan: true, appointment: true }
  });
  if (!renewal) return res.status(404).json({ message: "Renovação pendente não encontrada." });
  if (renewal.appointment.status !== "SCHEDULED") return res.status(409).json({ message: "Este lembrete não está mais disponível para renovação." });
  const existing = await prisma.sale.findFirst({ where: { companyId: cid, appointmentId: renewal.appointmentId } });
  if (existing) return res.json({ sale: { id: existing.id, internalCode: existing.internalCode } });
  const now = new Date();
  const sale = await prisma.sale.create({ data: {
    companyId: cid, internalCode: await nextMembershipSaleCode(prisma, cid), customerId: renewal.customerId, petId: renewal.petId,
    appointmentId: renewal.appointmentId, origin: "AGENDA", status: "WAITING_PAYMENT", paymentStatus: "PENDING", pendingSince: now,
    subtotal: renewal.priceSnapshot, total: renewal.priceSnapshot, paidAmount: 0, pendingAmount: renewal.priceSnapshot, stockProcessedAt: now,
    operatorId: req.user?.userId,
    items: { create: [{ companyId: cid, itemType: "SERVICE", serviceId: renewal.plan.serviceId, description: `Renovação do plano mensalista — ${renewal.plan.name}`, quantity: 1, unitPrice: renewal.priceSnapshot, total: renewal.priceSnapshot }] }
  } });
  await prisma.customerHistory.create({ data: { companyId: cid, customerId: renewal.customerId, petId: renewal.petId, appointmentId: renewal.appointmentId, saleId: sale.id, type: "MEMBERSHIP_RENEWAL", title: "Renovação enviada ao Caixa", description: `${renewal.plan.name} · Pedido PD-${String(sale.internalCode).padStart(6, "0")}` } });
  res.status(201).json({ sale: { id: sale.id, internalCode: sale.internalCode } });
});

membershipsRouter.patch("/renewals/:id/cancel-package", requireAdmin, async (req, res) => {
  const cid = companyId(req);
  const renewal = await prisma.membershipRenewal.findFirst({
    where: { id: req.params.id, companyId: cid, status: "PENDING_PAYMENT" },
    include: { appointment: true, plan: true }
  });
  if (!renewal) return res.status(404).json({ message: "Lembrete de renovação pendente não encontrado." });

  const result = await prisma.$transaction(async (tx) => {
    const membership = renewal.appointment.membershipId
      ? await tx.customerMembership.findFirst({ where: { id: renewal.appointment.membershipId, companyId: cid } })
      : null;

    if (membership) {
      await tx.customerMembership.update({ where: { id: membership.id }, data: { status: "CANCELLED" } });
      await tx.appointment.updateMany({
        where: { companyId: cid, membershipId: membership.id, status: { in: ["SCHEDULED", "ARRIVED"] } },
        data: { status: "CANCELLED", paymentStatus: "CANCELLED" }
      });
      await tx.membershipUsage.updateMany({
        where: { companyId: cid, membershipId: membership.id, status: "RESERVED" },
        data: { status: "RELEASED" }
      });
    } else {
      await tx.appointment.update({ where: { id: renewal.appointmentId }, data: { status: "CANCELLED", paymentStatus: "CANCELLED" } });
    }

    await tx.membershipRenewal.update({ where: { id: renewal.id }, data: { status: "CANCELLED" } });
    await tx.sale.updateMany({
      where: { companyId: cid, appointmentId: renewal.appointmentId, status: "WAITING_PAYMENT" },
      data: { status: "CANCELLED", paymentStatus: "CANCELLED", cancelReason: "Pacote cancelado no lembrete de renovação", cancelledAt: new Date() }
    });
    await tx.customerHistory.create({
      data: {
        companyId: cid,
        customerId: renewal.customerId,
        petId: renewal.petId,
        appointmentId: renewal.appointmentId,
        membershipId: membership?.id,
        type: "MEMBERSHIP",
        title: "Pacote mensalista cancelado",
        description: `${renewal.plan.name} · Cancelado pelo atalho do lembrete de renovação`
      }
    });
    return { membershipId: membership?.id ?? null };
  });

  res.json({ message: "Pacote cancelado com sucesso.", ...result });
});

membershipsRouter.post("/:id/use", (_req, res) => {
  res.status(410).json({
    code: "DIRECT_MEMBERSHIP_USE_DISABLED",
    message: "O uso da mensalidade é reservado no agendamento e consumido somente ao finalizar o atendimento."
  });
});

membershipsRouter.post("/:id/use-legacy-disabled", async (req, res) => {
  const cid = companyId(req);
  const membership = await prisma.customerMembership.findFirstOrThrow({ where: { id: req.params.id, companyId: cid }, include: { plan: true, pet: true } });
  if (membership.remainingUses <= 0) return res.status(400).json({ message: "Saldo insuficiente" });
  if (membership.status !== "ACTIVE" || membership.endDate < new Date()) return res.status(400).json({ message: "Mensalidade vencida ou inativa" });
  const updated = await prisma.customerMembership.update({
    where: { id: membership.id },
    data: { usedUses: { increment: 1 }, remainingUses: { decrement: 1 } },
    include: { customer: true, pet: true, plan: true }
  });
  await prisma.customerHistory.create({
    data: { companyId: cid, customerId: membership.customerId, petId: membership.petId, membershipId: membership.id, type: "MEMBERSHIP_USE", title: "Uso de mensalidade", description: `${membership.pet.name} - ${membership.plan.name}` }
  });
  res.json({ ...updated, alert: updated.remainingUses === 0 ? "Esse foi o último uso da mensalidade. Ofereça renovação ao cliente." : null });
});

membershipsRouter.patch("/:id/cancel", requireAdmin, async (req, res) => {
  const cid = companyId(req);
  await prisma.customerMembership.updateMany({ where: { id: req.params.id, companyId: cid }, data: { status: "CANCELLED" } });
  const membership = await prisma.customerMembership.findFirst({ where: { id: req.params.id, companyId: cid } });
  if (!membership) return res.status(404).json({ message: "Mensalidade não encontrada" });
  await prisma.customerHistory.create({
    data: { companyId: cid, customerId: membership.customerId, petId: membership.petId, membershipId: membership.id, type: "MEMBERSHIP", title: "Mensalidade cancelada" }
  });
  res.json(membership);
});
