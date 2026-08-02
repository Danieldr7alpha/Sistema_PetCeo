import assert from "node:assert/strict";
import { prisma } from "../apps/api/src/lib/prisma.js";

const apiUrl = process.env.TEST_API_URL ?? "http://127.0.0.1:3334";
const createdAppointmentIds: string[] = [];
const createdMembershipIds: string[] = [];
let planId = "";
let createdCashSessionId = "";
const createdServiceIds: string[] = [];

async function api(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init?.headers }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  const login = await fetch(`${apiUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@ceopet.ai", password: "admin123" })
  });
  assert.equal(login.status, 200);
  const session = await login.json() as { token: string; company: { id: string } };
  const token = session.token;
  const cid = session.company.id;
  const customer = await prisma.customer.findFirst({ where: { companyId: cid }, include: { pets: true } });
  const service = await prisma.service.findFirst({ where: { companyId: cid, active: true } });
  assert(customer?.pets[0] && service);
  const extras = await Promise.all([
    prisma.service.create({ data: { companyId: cid, name: "Tosa adicional teste", price: 45, estimatedMinutes: 30, active: true } }),
    prisma.service.create({ data: { companyId: cid, name: "Hidratação adicional teste", price: 20, estimatedMinutes: 20, active: true } })
  ]);
  createdServiceIds.push(...extras.map((item) => item.id));

  const plan = await prisma.membershipPlan.create({
    data: { companyId: cid, name: "Plano teste reserva", serviceId: service.id, usageQuantity: 4, validityDays: 30, suggestedFrequencyDays: 7, price: 160, active: true }
  });
  planId = plan.id;
  const startDate = new Date();
  const endDate = new Date(Date.now() + 30 * 86400000);
  const membership = await prisma.customerMembership.create({
    data: { companyId: cid, customerId: customer.id, petId: customer.pets[0].id, planId, startDate, endDate, totalUses: 4, remainingUses: 4 }
  });
  createdMembershipIds.push(membership.id);

  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const createAppointment = async (startTime: string, paymentMode: "AVULSO" | "PACKAGE" | "RENEWAL_AT_CHECKOUT", membershipId?: string, additionalServiceIds: string[] = [], primaryServiceId = service.id) => {
    const appointment = await api("/appointments", token, {
      method: "POST",
      body: JSON.stringify({
        customerId: customer.id, petId: customer.pets[0].id, serviceId: primaryServiceId,
        membershipId, renewalPlanId: paymentMode === "RENEWAL_AT_CHECKOUT" ? planId : undefined,
        paymentMode, date, startTime, additionalServiceIds
      })
    });
    createdAppointmentIds.push(appointment.id);
    return appointment;
  };

  const reserved = await createAppointment("20:01", "PACKAGE", membership.id);
  assert.equal(reserved.membershipUsage.status, "RESERVED");
  const unchanged = await prisma.customerMembership.findUniqueOrThrow({ where: { id: membership.id } });
  assert.equal(unchanged.remainingUses, 4, "agendar não consome");
  const optionsReserved = await api(`/memberships/pet/${customer.pets[0].id}/options`, token);
  const option = optionsReserved.find((item: any) => item.id === membership.id);
  assert.equal(option.availableUses, 3);
  assert.equal(option.reservedUses, 1);
  await api(`/appointments/${reserved.id}/status`, token, { method: "PATCH", body: JSON.stringify({ status: "CANCELLED" }) });
  const released = await prisma.membershipUsage.findUniqueOrThrow({ where: { appointmentId: reserved.id } });
  assert.equal(released.status, "RELEASED");

  for (const additionalServiceIds of [[extras[0].id, extras[0].id], [service.id]]) {
    const duplicateResponse = await fetch(`${apiUrl}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        customerId: customer.id, petId: customer.pets[0].id, serviceId: service.id,
        membershipId: membership.id, paymentMode: "PACKAGE", date, startTime: "20:09", additionalServiceIds
      })
    });
    assert.equal(duplicateResponse.status, 400, "serviço duplicado bloqueado");
  }

  const consumed = await createAppointment("20:02", "PACKAGE", membership.id, extras.map((item) => item.id));
  for (const status of ["ARRIVED", "IN_SERVICE", "FINISHED"]) {
    await api(`/appointments/${consumed.id}/status`, token, { method: "PATCH", body: JSON.stringify({ status }) });
  }
  const afterConsume = await prisma.customerMembership.findUniqueOrThrow({ where: { id: membership.id } });
  assert.equal(afterConsume.remainingUses, 3);
  await api(`/appointments/${consumed.id}/status`, token, { method: "PATCH", body: JSON.stringify({ status: "FINISHED" }) });
  const afterRepeatedFinish = await prisma.customerMembership.findUniqueOrThrow({ where: { id: membership.id } });
  assert.equal(afterRepeatedFinish.remainingUses, 3, "finalização idempotente");
  const packageWithExtrasSale = await prisma.sale.findFirstOrThrow({ where: { appointmentId: consumed.id }, include: { items: { orderBy: { createdAt: "asc" } } } });
  assert.equal(Number(packageWithExtrasSale.total), 65);
  assert.equal(packageWithExtrasSale.items.length, 3);
  assert.equal(Number(packageWithExtrasSale.items[0].unitPrice), 0);

  const packageOnly = await createAppointment("20:06", "PACKAGE", membership.id);
  for (const status of ["ARRIVED", "IN_SERVICE", "FINISHED"]) {
    await api(`/appointments/${packageOnly.id}/status`, token, { method: "PATCH", body: JSON.stringify({ status }) });
  }
  const afterPackageOnly = await prisma.customerMembership.findUniqueOrThrow({ where: { id: membership.id } });
  assert.equal(afterPackageOnly.remainingUses, 2, "pacote puro consome exatamente uma utilização");
  const finishedPackageOnly = await prisma.appointment.findUniqueOrThrow({ where: { id: packageOnly.id } });
  assert.equal(finishedPackageOnly.paymentStatus, "NOT_REQUIRED", "pacote puro não simula pagamento");
  assert.equal(await prisma.sale.count({ where: { appointmentId: packageOnly.id } }), 0, "pacote puro não cria pedido financeiro");
  assert.equal(await prisma.customerHistory.count({ where: { appointmentId: packageOnly.id, type: "MEMBERSHIP_USE" } }), 1, "uso aparece uma vez no histórico");
  assert.equal(await prisma.customerHistory.count({ where: { appointmentId: packageOnly.id, type: "APPOINTMENT" } }), 1, "atendimento aparece uma vez no histórico");
  await api(`/appointments/${packageOnly.id}/status`, token, { method: "PATCH", body: JSON.stringify({ status: "FINISHED" }) });
  const afterRepeatedPackageOnly = await prisma.customerMembership.findUniqueOrThrow({ where: { id: membership.id } });
  assert.equal(afterRepeatedPackageOnly.remainingUses, 2, "repetir finalização do pacote puro não duplica consumo");
  assert.equal(await prisma.sale.count({ where: { appointmentId: packageOnly.id } }), 0, "repetir finalização não cria pedido de valor zero");

  const avulso = await createAppointment("20:05", "AVULSO", undefined, [extras[1].id], extras[0].id);
  for (const status of ["ARRIVED", "IN_SERVICE", "FINISHED"]) {
    await api(`/appointments/${avulso.id}/status`, token, { method: "PATCH", body: JSON.stringify({ status }) });
  }
  const avulsoSale = await prisma.sale.findFirstOrThrow({ where: { appointmentId: avulso.id }, include: { items: true } });
  assert.equal(Number(avulsoSale.total), 65);
  assert.equal(avulsoSale.items.length, 2);
  assert.equal(await prisma.membershipUsage.count({ where: { appointmentId: avulso.id } }), 0);

  await prisma.customerMembership.update({ where: { id: membership.id }, data: { remainingUses: 0, usedUses: 4 } });
  const zeroOptions = await api(`/memberships/pet/${customer.pets[0].id}/options`, token);
  const zero = zeroOptions.find((item: any) => item.id === membership.id);
  assert.equal(zero.usable, false);
  assert.equal(zero.unavailableReason, "NO_BALANCE");

  const renewalAppointment = await createAppointment("20:03", "RENEWAL_AT_CHECKOUT");
  assert.equal(renewalAppointment.membershipRenewal.status, "PENDING_PAYMENT");
  for (const status of ["ARRIVED", "IN_SERVICE", "FINISHED"]) {
    await api(`/appointments/${renewalAppointment.id}/status`, token, { method: "PATCH", body: JSON.stringify({ status }) });
  }
  const renewalSale = await prisma.sale.findFirstOrThrow({ where: { appointmentId: renewalAppointment.id }, include: { items: { orderBy: { createdAt: "asc" } } } });
  assert.equal(Number(renewalSale.total), 160);
  assert.equal(renewalSale.items.length, 2);
  assert.equal(renewalSale.items[1].coveredByMembership, true);

  let cashSession = await prisma.cashSession.findFirst({ where: { companyId: cid, status: "OPEN" } });
  if (!cashSession) {
    cashSession = await prisma.cashSession.create({ data: { companyId: cid, status: "OPEN", openingAmount: 0, notes: "Teste mensalidade" } });
    createdCashSessionId = cashSession.id;
  }
  await api(`/sales/${renewalSale.id}/checkout`, token, {
    method: "PATCH",
    body: JSON.stringify({
      customerId: customer.id, petId: customer.pets[0].id, status: "PAID", paymentMethod: "CASH",
      payments: [{ method: "CASH", amount: 160, cashReceived: 160, changeAmount: 0 }],
      discountType: "VALUE", discount: 0,
      items: [
        { itemType: "SERVICE", serviceId: service.id, quantity: 1 },
        { itemType: "SERVICE", serviceId: service.id, quantity: 1 }
      ]
    })
  });
  const paidRenewal = await prisma.membershipRenewal.findUniqueOrThrow({ where: { appointmentId: renewalAppointment.id } });
  assert.equal(paidRenewal.status, "PAID");
  const renewedMembership = await prisma.customerMembership.findUniqueOrThrow({ where: { id: paidRenewal.membershipId! } });
  createdMembershipIds.push(renewedMembership.id);
  assert.equal(renewedMembership.remainingUses, 3);

  const pendingRenewalAppointment = await createAppointment("20:04", "RENEWAL_AT_CHECKOUT");
  for (const status of ["ARRIVED", "IN_SERVICE", "FINISHED"]) {
    await api(`/appointments/${pendingRenewalAppointment.id}/status`, token, { method: "PATCH", body: JSON.stringify({ status }) });
  }
  const pendingSale = await prisma.sale.findFirstOrThrow({ where: { appointmentId: pendingRenewalAppointment.id } });
  await api(`/sales/${pendingSale.id}/checkout`, token, {
    method: "PATCH",
    body: JSON.stringify({
      customerId: customer.id, petId: customer.pets[0].id, status: "PENDING",
      pendingReason: "PAY_ON_PICKUP", pendingNotes: "Teste de renovação pendente",
      discountType: "VALUE", discount: 0,
      items: [
        { itemType: "SERVICE", serviceId: service.id, quantity: 1 },
        { itemType: "SERVICE", serviceId: service.id, quantity: 1 }
      ]
    })
  });
  const stillPending = await prisma.membershipRenewal.findUniqueOrThrow({ where: { appointmentId: pendingRenewalAppointment.id } });
  assert.equal(stillPending.status, "PENDING_PAYMENT");
  assert.equal(stillPending.membershipId, null);
  console.log("Mensalidade no agendamento, reserva, consumo e renovação: OK");
}

main().finally(async () => {
  const sales = await prisma.sale.findMany({ where: { appointmentId: { in: createdAppointmentIds } }, select: { id: true } });
  const saleIds = sales.map((sale) => sale.id);
  await prisma.$transaction(async (tx) => {
    if (saleIds.length) {
      await tx.salePayment.deleteMany({ where: { saleId: { in: saleIds } } });
      await tx.salesReceipt.deleteMany({ where: { saleId: { in: saleIds } } });
      await tx.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
      await tx.sale.deleteMany({ where: { id: { in: saleIds } } });
    }
    await tx.customerHistory.deleteMany({ where: { OR: [{ appointmentId: { in: createdAppointmentIds } }, { membershipId: { in: createdMembershipIds } }] } });
    await tx.membershipUsage.deleteMany({ where: { appointmentId: { in: createdAppointmentIds } } });
    await tx.membershipRenewal.deleteMany({ where: { appointmentId: { in: createdAppointmentIds } } });
    await tx.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    await tx.customerMembership.deleteMany({ where: { id: { in: createdMembershipIds } } });
    if (planId) await tx.membershipPlan.deleteMany({ where: { id: planId } });
    if (createdServiceIds.length) await tx.service.deleteMany({ where: { id: { in: createdServiceIds } } });
    if (createdCashSessionId) await tx.cashSession.deleteMany({ where: { id: createdCashSessionId } });
  });
  await prisma.$disconnect();
});
