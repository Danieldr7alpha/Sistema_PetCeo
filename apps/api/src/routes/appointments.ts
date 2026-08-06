import { Router } from "express";
import { z } from "zod";
import { companyId, requireAdmin } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { ensureWaitingSaleForFinishedAppointment } from "./sales.js";

export const appointmentsRouter = Router();
const pendingAppointmentCreates = new Map<string, Promise<unknown>>();

const appointmentInclude = {
  customer: { include: { memberships: { include: { plan: { include: { service: true } }, pet: true } } } },
  pet: true,
  service: true,
  membership: { include: { plan: { include: { service: true } }, pet: true, usages: { where: { status: "RESERVED" as const }, select: { id: true } } } },
  membershipUsage: true,
  membershipRenewal: { include: { plan: { include: { service: true } } } },
  extraServices: { include: { service: true }, orderBy: { createdAt: "asc" as const } },
  sales: true,
  checkoutSale: true
};

function localDateInput(date = new Date()) {
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function shiftedEndTime(oldStart: string, oldEnd: string | null, newStart: string) {
  if (!oldEnd) return null;
  const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const duration = Math.max(0, toMinutes(oldEnd) - toMinutes(oldStart));
  const endMinutes = (toMinutes(newStart) + duration) % (24 * 60);
  return `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
}

async function lockMembership(tx: any, membershipId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${membershipId}))`;
}

appointmentsRouter.get("/", async (req, res) => {
  const cid = companyId(req);
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : undefined;
  res.json(await prisma.appointment.findMany({
    where: { companyId: cid, date: from || to ? { gte: from, lte: to } : undefined },
    include: appointmentInclude,
    orderBy: [{ date: "asc" }, { startTime: "asc" }]
  }));
});

appointmentsRouter.post("/", async (req, res) => {
  const cid = companyId(req);
  const body = z.object({
    customerId: z.string(),
    petId: z.string(),
    serviceId: z.string(),
    membershipId: z.string().optional(),
    paymentMode: z.enum(["AVULSO", "PACKAGE", "RENEWAL_AT_CHECKOUT"]).default("AVULSO"),
    date: z.string(),
    startTime: z.string(),
    endTime: z.string().optional(),
    notes: z.string().optional(),
    renewalPlanId: z.string().optional(),
    orderGroupId: z.string().max(100).optional(),
    additionalServiceIds: z.array(z.string()).default([])
  }).parse(req.body);

  if (body.date < localDateInput()) return res.status(400).json({ message: "Não é permitido agendar em uma data que já passou." });
  if (body.paymentMode === "PACKAGE" && !body.membershipId) return res.status(400).json({ code: "MEMBERSHIP_REQUIRED", message: "Selecione o pacote que será utilizado." });
  if (body.paymentMode === "RENEWAL_AT_CHECKOUT" && !body.renewalPlanId) return res.status(400).json({ code: "RENEWAL_PLAN_REQUIRED", message: "Selecione o plano que será renovado." });

  const [pet, service] = await Promise.all([
    prisma.pet.findFirst({ where: { id: body.petId, customerId: body.customerId, companyId: cid } }),
    prisma.service.findFirst({ where: { id: body.serviceId, companyId: cid } })
  ]);
  if (!pet || !service) return res.status(404).json({ message: "Cliente, pet ou serviço não encontrado." });
  const uniqueAdditionalServiceIds = [...new Set(body.additionalServiceIds)];
  if (uniqueAdditionalServiceIds.length !== body.additionalServiceIds.length) {
    return res.status(400).json({ code: "DUPLICATE_ADDITIONAL_SERVICE", message: "Este serviço já foi adicionado ao agendamento." });
  }
  if (uniqueAdditionalServiceIds.includes(body.serviceId)) {
    return res.status(400).json({ code: "PACKAGE_SERVICE_DUPLICATED", message: "Este serviço já está incluído no pacote ou como serviço principal." });
  }
  const additionalServices = uniqueAdditionalServiceIds.length
    ? await prisma.service.findMany({ where: { id: { in: uniqueAdditionalServiceIds }, companyId: cid, active: true } })
    : [];
  if (additionalServices.length !== uniqueAdditionalServiceIds.length) {
    return res.status(404).json({ message: "Um dos serviços adicionais não foi encontrado." });
  }
  const renewalPlan = body.paymentMode === "RENEWAL_AT_CHECKOUT"
    ? await prisma.membershipPlan.findFirst({ where: { id: body.renewalPlanId, companyId: cid, active: true } })
    : null;
  if (body.paymentMode === "RENEWAL_AT_CHECKOUT" && (!renewalPlan || renewalPlan.serviceId !== body.serviceId)) {
    return res.status(409).json({ code: "RENEWAL_PLAN_INVALID", message: "O plano selecionado não cobre este serviço." });
  }

  const appointmentDate = new Date(body.date);
  const appointmentKey = [cid, body.customerId, body.petId, body.serviceId, uniqueAdditionalServiceIds.sort().join(","), body.membershipId ?? "AVULSO", body.date, body.startTime].join("|");
  const recentWindow = new Date(Date.now() - 15000);
  const createOrReuseAppointment = () => prisma.$transaction(async (tx) => {
    if (body.paymentMode === "PACKAGE" && body.membershipId) {
      await lockMembership(tx, body.membershipId);
    }
    const recentDuplicate = await tx.appointment.findFirst({
      where: {
        companyId: cid, customerId: body.customerId, petId: body.petId, serviceId: body.serviceId,
        date: appointmentDate, startTime: body.startTime, status: { not: "CANCELLED" }, createdAt: { gte: recentWindow }
      },
      include: appointmentInclude,
      orderBy: { createdAt: "asc" }
    });
    if (recentDuplicate) return recentDuplicate;

    let membership: any = null;
    if (body.paymentMode === "PACKAGE" && body.membershipId) {
      membership = await tx.customerMembership.findFirst({
        where: { id: body.membershipId, companyId: cid, customerId: body.customerId, petId: body.petId },
        include: { plan: true }
      });
      if (!membership) throw Object.assign(new Error("Mensalidade não encontrada para este pet."), { statusCode: 404, code: "MEMBERSHIP_NOT_FOUND" });
      if (membership.status !== "ACTIVE" || membership.endDate < new Date()) throw Object.assign(new Error(`Mensalidade vencida em ${membership.endDate.toLocaleDateString("pt-BR")}.`), { statusCode: 409, code: "MEMBERSHIP_EXPIRED" });
      if (membership.plan.serviceId !== body.serviceId) throw Object.assign(new Error("Este pacote não cobre o serviço selecionado."), { statusCode: 409, code: "MEMBERSHIP_SERVICE_MISMATCH" });
      const reserved = await tx.membershipUsage.count({ where: { membershipId: membership.id, status: "RESERVED" } });
      if (membership.remainingUses - reserved <= 0) throw Object.assign(new Error("Este pacote não possui mais saldo disponível."), { statusCode: 409, code: "MEMBERSHIP_NO_BALANCE" });
    }

    const appointment = await tx.appointment.create({
      data: {
        companyId: cid,
        customerId: body.customerId,
        petId: body.petId,
        serviceId: body.serviceId,
        membershipId: body.paymentMode === "PACKAGE" ? body.membershipId : undefined,
        paymentMode: body.paymentMode,
        date: appointmentDate,
        startTime: body.startTime,
        endTime: body.endTime,
        notes: body.notes,
        orderGroupId: body.orderGroupId
      }
    });
    if (membership) {
      await tx.membershipUsage.create({
        data: {
          companyId: cid,
          membershipId: membership.id,
          appointmentId: appointment.id,
          petId: body.petId,
          serviceId: body.serviceId,
          status: "RESERVED",
          balanceBefore: membership.remainingUses,
          operatorId: req.user?.userId
        }
      });
    }
    if (body.paymentMode === "RENEWAL_AT_CHECKOUT" && renewalPlan) {
      await tx.membershipRenewal.create({
        data: {
          companyId: cid,
          customerId: body.customerId,
          petId: body.petId,
          planId: renewalPlan.id,
          appointmentId: appointment.id,
          priceSnapshot: renewalPlan.price,
          createdById: req.user?.userId
        }
      });
    }
    if (additionalServices.length) {
      await tx.appointmentExtraService.createMany({
        data: additionalServices.map((additional) => ({
          companyId: cid,
          appointmentId: appointment.id,
          serviceId: additional.id,
          nameSnapshot: additional.name,
          priceSnapshot: additional.price
        }))
      });
    }
    return tx.appointment.findUniqueOrThrow({ where: { id: appointment.id }, include: appointmentInclude });
  }, { maxWait: 10000, timeout: 20000 });

  try {
    let pendingAppointment = pendingAppointmentCreates.get(appointmentKey);
    const isNewRequest = !pendingAppointment;
    if (!pendingAppointment) {
      pendingAppointment = createOrReuseAppointment().finally(() => pendingAppointmentCreates.delete(appointmentKey));
      pendingAppointmentCreates.set(appointmentKey, pendingAppointment);
    }
    const appointment = await pendingAppointment;
    res.status(isNewRequest ? 201 : 200).json(appointment);
  } catch (error) {
    const known = error as Error & { statusCode?: number; code?: string };
    res.status(known.statusCode ?? (known.code === "P2034" ? 409 : 500)).json({
      code: known.code === "P2034" ? "MEMBERSHIP_CONFLICT" : known.code,
      message: known.code === "P2034" ? "O saldo do pacote mudou. Consulte novamente e tente outra vez." : known.message
    });
  }
});

appointmentsRouter.patch("/:id/reschedule", async (req, res) => {
  const cid = companyId(req);
  const body = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional()
  }).parse(req.body);

  if (body.date < localDateInput()) {
    return res.status(400).json({ message: "Não é permitido reagendar para uma data que já passou." });
  }

  const current = await prisma.appointment.findFirst({
    where: { id: req.params.id, companyId: cid },
    include: appointmentInclude
  });
  if (!current) return res.status(404).json({ message: "Agendamento não encontrado." });
  if (!current.membershipId || current.membershipUsage?.status !== "RESERVED") {
    return res.status(409).json({ message: "Somente um atendimento reservado de mensalista pode ser reagendado por esta opção." });
  }
  if (current.status !== "SCHEDULED") {
    return res.status(409).json({ message: "Somente atendimentos que ainda estão agendados podem ser reagendados." });
  }

  const newDate = new Date(body.date);
  const duplicate = await prisma.appointment.findFirst({
    where: {
      id: { not: current.id }, companyId: cid, petId: current.petId,
      date: newDate, startTime: body.startTime, status: { not: "CANCELLED" }
    }
  });
  if (duplicate) {
    return res.status(409).json({ message: "Este pet já possui um agendamento nessa data e horário." });
  }

  const oldDate = current.date.toLocaleDateString("pt-BR", { timeZone: "UTC" });
  const adjustedEndTime = body.endTime ?? shiftedEndTime(current.startTime, current.endTime, body.startTime);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.appointment.update({
      where: { id: current.id },
      data: { date: newDate, startTime: body.startTime, endTime: adjustedEndTime }
    });
    await tx.customerHistory.create({
      data: {
        companyId: cid, customerId: current.customerId, petId: current.petId,
        appointmentId: current.id, membershipId: current.membershipId,
        type: "APPOINTMENT_RESCHEDULED", title: "Atendimento de mensalista reagendado",
        description: `${oldDate} às ${current.startTime} → ${newDate.toLocaleDateString("pt-BR", { timeZone: "UTC" })} às ${body.startTime}`
      }
    });
    return tx.appointment.findUniqueOrThrow({ where: { id: current.id }, include: appointmentInclude });
  });

  res.json(updated);
});

appointmentsRouter.patch("/:id/status", async (req, res) => {
  const cid = companyId(req);
  const body = z.object({ status: z.enum(["SCHEDULED", "ARRIVED", "IN_SERVICE", "BATHING", "WAITING_PICKUP", "FINISHED", "CANCELLED"]) }).parse(req.body);
  if (body.status === "CANCELLED" && req.user?.role !== "ADMIN") return res.status(403).json({ message: "Apenas administradores podem cancelar atendimento." });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.appointment.findFirst({ where: { id: req.params.id, companyId: cid }, include: appointmentInclude });
      if (!current) throw Object.assign(new Error("Agendamento não encontrado."), { statusCode: 404 });
      if (body.status === "CANCELLED" && current.membershipId) throw Object.assign(new Error("Atendimento de mensalista já foi pago e não pode ser cancelado pela Agenda. Para cancelar o plano, faça o estorno da venda no Caixa."), { statusCode: 409 });
      if (body.status === "FINISHED" && current.status === "FINISHED") return { appointment: current, consumedNow: false };

      const order = ["SCHEDULED", "ARRIVED", "IN_SERVICE", "FINISHED", "CANCELLED"];
      if (body.status === "CANCELLED" && !["SCHEDULED", "ARRIVED"].includes(current.status)) throw Object.assign(new Error("Somente agendamentos ainda não iniciados podem ser cancelados."), { statusCode: 409 });
      if (current.status === "FINISHED") throw Object.assign(new Error("Atendimento finalizado não pode voltar de status."), { statusCode: 409 });
      if (body.status !== "CANCELLED" && order.indexOf(body.status) < order.indexOf(current.status)) throw Object.assign(new Error("Status não pode voltar para uma etapa anterior."), { statusCode: 409 });

      let consumedNow = false;
      if (current.membershipId && current.membershipUsage) {
        await lockMembership(tx, current.membershipId);
        const usage = await tx.membershipUsage.findUnique({ where: { appointmentId: current.id } });
        if (body.status === "CANCELLED" && usage?.status === "RESERVED") {
          await tx.membershipUsage.update({ where: { id: usage.id }, data: { status: "RELEASED", releasedAt: new Date(), operatorId: req.user?.userId } });
        }
        if (body.status === "FINISHED" && usage?.status === "RESERVED") {
          const membership = await tx.customerMembership.findFirst({ where: { id: current.membershipId, companyId: cid, petId: current.petId }, include: { plan: true, pet: true } });
          if (!membership || membership.status !== "ACTIVE" || membership.endDate < new Date()) throw Object.assign(new Error("A mensalidade está vencida ou inativa."), { statusCode: 409, code: "MEMBERSHIP_EXPIRED" });
          if (membership.plan.serviceId !== current.serviceId) throw Object.assign(new Error("Este pacote não cobre o serviço do atendimento."), { statusCode: 409, code: "MEMBERSHIP_SERVICE_MISMATCH" });
          const updated = await tx.customerMembership.updateMany({
            where: { id: membership.id, companyId: cid, remainingUses: { gt: 0 } },
            data: { usedUses: { increment: 1 }, remainingUses: { decrement: 1 } }
          });
          if (updated.count !== 1) throw Object.assign(new Error("Este pacote não possui mais saldo disponível."), { statusCode: 409, code: "MEMBERSHIP_NO_BALANCE" });
          await tx.membershipUsage.update({
            where: { id: usage.id },
            data: {
              status: "CONSUMED",
              usageNumber: membership.usedUses + 1,
              balanceBefore: membership.remainingUses,
              balanceAfter: membership.remainingUses - 1,
              consumedAt: new Date(),
              operatorId: req.user?.userId
            }
          });
          await tx.customerHistory.create({
            data: {
              companyId: cid,
              customerId: current.customerId,
              petId: current.petId,
              appointmentId: current.id,
              membershipId: membership.id,
              type: "MEMBERSHIP_USE",
              title: `Uso ${membership.usedUses + 1} de ${membership.totalUses}`,
              description: `${current.service.name} · ${current.pet.name} · Saldo: ${membership.remainingUses} → ${membership.remainingUses - 1}`
            }
          });
          consumedNow = true;
        }
      }
      if (body.status === "CANCELLED" && current.membershipRenewal?.status === "PENDING_PAYMENT") {
        await tx.membershipRenewal.update({ where: { id: current.membershipRenewal.id }, data: { status: "CANCELLED" } });
      }
      const coveredPackageWithoutCharge = body.status === "FINISHED"
        && current.paymentMode === "PACKAGE"
        && current.membershipUsage?.status === "RESERVED"
        && current.extraServices.every((extra) => Number(extra.priceSnapshot) <= 0);
      await tx.appointment.update({
        where: { id: current.id },
        data: {
          status: body.status,
          ...(coveredPackageWithoutCharge ? { paymentStatus: "NOT_REQUIRED" as const } : {})
        }
      });
      const appointment = await tx.appointment.findUniqueOrThrow({ where: { id: current.id }, include: appointmentInclude });
      return { appointment, consumedNow };
    }, { maxWait: 10000, timeout: 20000 });

    if (body.status === "FINISHED") {
      await ensureWaitingSaleForFinishedAppointment(cid, result.appointment.id);
      const existingHistory = await prisma.customerHistory.findFirst({ where: { companyId: cid, appointmentId: result.appointment.id, type: "APPOINTMENT" } });
      if (!existingHistory) {
        await prisma.customerHistory.create({
          data: {
            companyId: cid, customerId: result.appointment.customerId, petId: result.appointment.petId,
            appointmentId: result.appointment.id, type: "APPOINTMENT", title: "Atendimento finalizado",
            description: `${result.appointment.pet.name} - ${result.appointment.service.name}`,
            amount: result.appointment.paymentMode === "PACKAGE" ? 0 : result.appointment.service.price
          }
        });
      }
    }
    const fresh = await prisma.appointment.findFirst({ where: { id: req.params.id, companyId: cid }, include: appointmentInclude });
    res.json(fresh ?? result.appointment);
  } catch (error) {
    const known = error as Error & { statusCode?: number; code?: string };
    console.error("APPOINTMENT_STATUS_UPDATE_FAILED", {
      appointmentId: req.params.id,
      companyId: cid,
      requestedStatus: body.status,
      code: known.code,
      message: known.message
    });
    res.status(known.statusCode ?? (known.code === "P2034" ? 409 : 500)).json({
      code: known.code === "P2034" ? "MEMBERSHIP_CONFLICT" : known.code,
      message: known.code === "P2034" ? "O saldo do pacote mudou. Tente novamente." : known.message
    });
  }
});

appointmentsRouter.delete("/:id", requireAdmin, async (req, res) => {
  const cid = companyId(req);
  await prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findFirst({ where: { id: req.params.id, companyId: cid }, include: { membershipUsage: true } });
    if (!appointment) return;
    if (appointment.membershipId) await lockMembership(tx, appointment.membershipId);
    if (appointment.membershipUsage?.status === "RESERVED") {
      await tx.membershipUsage.update({ where: { id: appointment.membershipUsage.id }, data: { status: "RELEASED", releasedAt: new Date(), operatorId: req.user?.userId } });
    }
    await tx.appointment.update({ where: { id: appointment.id }, data: { status: "CANCELLED" } });
  });
  res.status(204).send();
});
