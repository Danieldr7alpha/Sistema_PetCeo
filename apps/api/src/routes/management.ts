import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { companyId, requireAdmin, requirePermission } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

export const managementRouter = Router();
managementRouter.use("/cash-registers", requirePermission("financial:cash-registers"));
managementRouter.use("/team", requireAdmin);

const permissions = [
  "dashboard", "appointments", "customers", "memberships", "products", "checkout", "checkout:pending", "checkout:reports",
  "checkout:closing-reports", "checkout:withdrawal", "checkout:supply", "checkout:transfer", "checkout:consumption", "checkout:close",
  "financial", "financial:accounts", "financial:cash-registers", "financial:methods", "financial:receivables", "financial:payables",
  "financial:movements", "financial:reports", "team"
] as const;

async function ensureDefaultRegister(cid: string) {
  const existing = await prisma.cashRegister.findFirst({ where: { companyId: cid } });
  const register = existing ?? await prisma.cashRegister.create({ data: { companyId: cid, code: "101", name: "Caixa 101" } });
  await prisma.cashSession.updateMany({ where: { companyId: cid, cashRegisterId: null }, data: { cashRegisterId: register.id } });
}

async function registerBalance(registerId: string, initialBalance: number) {
  const session = await prisma.cashSession.findFirst({
    where: { cashRegisterId: registerId }, orderBy: { openedAt: "desc" },
    include: { payments: { where: { method: "CASH" }, select: { amount: true } }, movements: { select: { type: true, amount: true } } }
  });
  if (!session) return initialBalance;
  if (session.status === "CLOSED") return Number(session.closingCashAmount ?? session.expectedCashAmount ?? session.openingAmount);
  const sales = session.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const cashIn = session.movements.filter((movement) => ["CASH_IN", "TRANSFER_IN", "ADJUSTMENT"].includes(movement.type)).reduce((sum, movement) => sum + Number(movement.amount), 0);
  const cashOut = session.movements.filter((movement) => ["CASH_OUT", "EXPENSE", "TRANSFER_OUT"].includes(movement.type)).reduce((sum, movement) => sum + Number(movement.amount), 0);
  return Number(session.openingAmount) + sales + cashIn - cashOut;
}

managementRouter.get("/cash-registers", async (req, res) => {
  const cid = companyId(req); await ensureDefaultRegister(cid);
  const registers = await prisma.cashRegister.findMany({ where: { companyId: cid }, include: { userAccess: { include: { user: { select: { id: true, name: true, active: true } } } }, sessions: { where: { status: "OPEN" }, select: { id: true, openedByName: true, openedAt: true } } }, orderBy: { code: "asc" } });
  res.json(await Promise.all(registers.map(async (register) => ({ ...register, balance: await registerBalance(register.id, Number(register.initialBalance)), allowedUsers: register.userAccess.map((access) => access.user), openSession: register.sessions[0] ?? null }))));
});

const registerSchema = z.object({ code: z.string().trim().min(1).max(20), name: z.string().trim().min(2).max(80), initialBalance: z.coerce.number().nonnegative().default(0), active: z.boolean().default(true), notes: z.string().trim().max(500).optional() });
managementRouter.post("/cash-registers", async (req, res) => {
  const cid = companyId(req); const body = registerSchema.parse(req.body);
  res.status(201).json(await prisma.cashRegister.create({ data: { ...body, notes: body.notes || null, companyId: cid } }));
});
managementRouter.patch("/cash-registers/:id", async (req, res) => {
  const cid = companyId(req); const body = registerSchema.partial().parse(req.body);
  const existing = await prisma.cashRegister.findFirst({ where: { id: req.params.id, companyId: cid } });
  if (!existing) return res.status(404).json({ message: "Caixa não encontrado." });
  res.json(await prisma.cashRegister.update({ where: { id: existing.id }, data: body }));
});
managementRouter.delete("/cash-registers/:id", async (req, res) => {
  const cid = companyId(req); const existing = await prisma.cashRegister.findFirst({ where: { id: req.params.id, companyId: cid }, include: { _count: { select: { sessions: true } } } });
  if (!existing) return res.status(404).json({ message: "Caixa não encontrado." });
  if (existing._count.sessions) await prisma.cashRegister.update({ where: { id: existing.id }, data: { active: false } }); else await prisma.cashRegister.delete({ where: { id: existing.id } });
  res.json({ deleted: true });
});

managementRouter.get("/team", async (req, res) => {
  const cid = companyId(req);
  res.json(await prisma.user.findMany({ where: { companyId: cid }, select: { id: true, name: true, email: true, cpf: true, phone: true, jobTitle: true, salary: true, otherMonthlyCost: true, otherCostDescription: true, zipCode: true, street: true, addressNumber: true, complement: true, neighborhood: true, city: true, state: true, role: true, active: true, permissions: true, cashRegisterAccess: { select: { cashRegisterId: true } } }, orderBy: { name: "asc" } }));
});

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((value) => value || null);
const teamSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  cpf: z.string().regex(/^\d{11}$/, "Informe um CPF com 11 números.").optional().nullable().transform((value) => value || null),
  phone: z.string().regex(/^\d{10,11}$/, "Informe um telefone com DDD.").optional().nullable().transform((value) => value || null),
  jobTitle: optionalText(80),
  salary: z.coerce.number().nonnegative().optional().nullable(),
  otherMonthlyCost: z.coerce.number().nonnegative().optional().nullable(),
  otherCostDescription: optionalText(160),
  zipCode: z.string().regex(/^\d{8}$/, "Informe um CEP com 8 números.").optional().nullable().transform((value) => value || null),
  street: optionalText(160), addressNumber: optionalText(30), complement: optionalText(100), neighborhood: optionalText(100), city: optionalText(100), state: z.string().trim().max(2).optional().nullable().transform((value) => value?.toUpperCase() || null),
  password: z.string().min(6).optional(), role: z.enum(["ADMIN", "EMPLOYEE"]).default("EMPLOYEE"), active: z.boolean().default(true), permissions: z.array(z.enum(permissions)).default([]), cashRegisterIds: z.array(z.string()).default([])
});
managementRouter.post("/team", async (req, res) => {
  const cid = companyId(req); const body = teamSchema.extend({ password: z.string().min(6) }).parse(req.body);
  const validRegisters = await prisma.cashRegister.findMany({ where: { companyId: cid, id: { in: body.cashRegisterIds } }, select: { id: true } });
  const user = await prisma.user.create({ data: { companyId: cid, name: body.name, email: body.email, cpf: body.cpf, phone: body.phone, jobTitle: body.jobTitle, salary: body.salary, otherMonthlyCost: body.otherMonthlyCost, otherCostDescription: body.otherCostDescription, zipCode: body.zipCode, street: body.street, addressNumber: body.addressNumber, complement: body.complement, neighborhood: body.neighborhood, city: body.city, state: body.state, passwordHash: await bcrypt.hash(body.password, 10), role: body.role, active: body.active, permissions: body.role === "ADMIN" ? [] : body.permissions, cashRegisterAccess: { create: validRegisters.map((register) => ({ cashRegisterId: register.id })) } } });
  res.status(201).json({ id: user.id });
});
managementRouter.patch("/team/:id", async (req, res) => {
  const cid = companyId(req); const body = teamSchema.partial().parse(req.body);
  const existing = await prisma.user.findFirst({ where: { id: req.params.id, companyId: cid } });
  if (!existing) return res.status(404).json({ message: "Funcionário não encontrado." });
  if (existing.id === req.user?.userId && body.active === false) return res.status(400).json({ message: "Você não pode desativar seu próprio acesso." });
  const cashRegisterIds = body.cashRegisterIds ?? null;
  const data: any = { name: body.name, email: body.email, cpf: body.cpf, phone: body.phone, jobTitle: body.jobTitle, salary: body.salary, otherMonthlyCost: body.otherMonthlyCost, otherCostDescription: body.otherCostDescription, zipCode: body.zipCode, street: body.street, addressNumber: body.addressNumber, complement: body.complement, neighborhood: body.neighborhood, city: body.city, state: body.state, role: body.role, active: body.active, permissions: body.role === "ADMIN" ? [] : body.permissions };
  if (body.password) data.passwordHash = await bcrypt.hash(body.password, 10);
  await prisma.$transaction(async (tx) => { await tx.user.update({ where: { id: existing.id }, data }); if (cashRegisterIds) { await tx.userCashRegister.deleteMany({ where: { userId: existing.id } }); const valid = await tx.cashRegister.findMany({ where: { companyId: cid, id: { in: cashRegisterIds } }, select: { id: true } }); if (valid.length) await tx.userCashRegister.createMany({ data: valid.map((register) => ({ userId: existing.id, cashRegisterId: register.id })) }); } });
  res.json({ updated: true });
});
managementRouter.delete("/team/:id", async (req, res) => {
  const cid = companyId(req); const existing = await prisma.user.findFirst({ where: { id: req.params.id, companyId: cid } });
  if (!existing) return res.status(404).json({ message: "Funcionário não encontrado." });
  if (existing.id === req.user?.userId) return res.status(400).json({ message: "Você não pode excluir seu próprio acesso." });
  await prisma.user.update({ where: { id: existing.id }, data: { active: false } }); res.json({ deleted: true });
});
