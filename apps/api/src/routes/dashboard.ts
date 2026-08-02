import { Router } from "express";
import { companyId } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

export const dashboardRouter = Router();

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

dashboardRouter.get("/", async (req, res) => {
  const cid = companyId(req);
  const today = startOfToday();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const inSevenDays = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const coldLimit = new Date(today.getTime() - 45 * 24 * 60 * 60 * 1000);

  await prisma.customerMembership.updateMany({
    where: { companyId: cid, status: "ACTIVE", endDate: { lt: today } },
    data: { status: "EXPIRED" }
  });

  const [appointmentsToday, revenue, customers, activeMemberships, expiringMemberships, coldCustomers] = await Promise.all([
    prisma.appointment.count({ where: { companyId: cid, date: { gte: today, lt: tomorrow } } }),
    prisma.sale.aggregate({ where: { companyId: cid, paymentStatus: "PAID", createdAt: { gte: today, lt: tomorrow } }, _sum: { total: true } }),
    prisma.customer.count({ where: { companyId: cid } }),
    prisma.customerMembership.count({ where: { companyId: cid, status: "ACTIVE" } }),
    prisma.customerMembership.count({ where: { companyId: cid, status: "ACTIVE", endDate: { gte: today, lte: inSevenDays } } }),
    prisma.customer.count({
      where: {
        companyId: cid,
        histories: { none: { type: { in: ["SALE", "APPOINTMENT"] }, createdAt: { gte: coldLimit } } }
      }
    })
  ]);

  const reducedFrequency = Math.max(0, Math.floor(coldCustomers / 2));
  res.json({
    cards: {
      appointmentsToday,
      revenueToday: Number(revenue._sum.total ?? 0),
      customers,
      activeMemberships,
      expiringMemberships,
      coldCustomers,
      reducedFrequency
    },
    recommendations: [
      `${coldCustomers} clientes estao ha mais de 45 dias sem voltar.`,
      `${expiringMemberships} mensalistas estao proximos do vencimento.`,
      appointmentsToday < 8 ? "Hoje voce possui horarios livres na agenda." : "Agenda cheia hoje. Considere redistribuir encaixes.",
      reducedFrequency ? "Entre em contato com clientes que diminuíram a frequência." : "Clientes recorrentes seguem dentro da frequência esperada."
    ]
  });
});
