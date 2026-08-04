import crypto from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

export const publicRegistrationRouter = Router();

const digits = (value: string) => value.replace(/\D/g, "");

function validCpf(value: string) {
  const cpf = digits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const check = (length: number) => {
    const sum = cpf.slice(0, length).split("").reduce((total, number, index) => total + Number(number) * (length + 1 - index), 0);
    const remainder = (sum * 10) % 11;
    return (remainder === 10 ? 0 : remainder) === Number(cpf[length]);
  };
  return check(9) && check(10);
}

const registrationSchema = z.object({
  name: z.string().trim().min(3),
  cpf: z.string().transform(digits).refine(validCpf, "CPF inválido"),
  phone: z.string().transform(digits).refine((value) => value.length >= 10 && value.length <= 11),
  zipCode: z.string().transform(digits).optional(),
  street: z.string().trim().optional(), number: z.string().trim().optional(), complement: z.string().trim().optional(),
  neighborhood: z.string().trim().optional(), city: z.string().trim().optional(), state: z.string().trim().optional(),
  petName: z.string().trim().min(1),
  species: z.enum(["DOG", "CAT", "OTHER"]), customSpecies: z.string().trim().optional(), breed: z.string().trim().optional(),
  petGender: z.enum(["MALE", "FEMALE", "UNINFORMED"]), size: z.enum(["SMALL", "MEDIUM", "LARGE", "GIANT"]),
  color: z.string().trim().optional(), notes: z.string().trim().optional()
}).refine((value) => value.species !== "OTHER" || Boolean(value.customSpecies), { message: "Informe a espécie do pet.", path: ["customSpecies"] });

async function nextCustomerCode(tx: Prisma.TransactionClient, companyId: string) {
  const existing = await tx.internalCodeCounter.findUnique({ where: { companyId_kind: { companyId, kind: "CUSTOMER" } } });
  if (!existing) {
    const last = await tx.customer.findFirst({ where: { companyId, internalCode: { not: null } }, orderBy: { internalCode: "desc" }, select: { internalCode: true } });
    const nextValue = (last?.internalCode ?? 0) + 1;
    await tx.internalCodeCounter.create({ data: { companyId, kind: "CUSTOMER", nextValue: nextValue + 1 } });
    return nextValue;
  }
  await tx.internalCodeCounter.update({ where: { id: existing.id }, data: { nextValue: { increment: 1 } } });
  return existing.nextValue;
}

function tokenHash(token: string) { return crypto.createHash("sha256").update(token).digest("hex"); }

publicRegistrationRouter.get("/:token", async (req, res) => {
  const invite = await prisma.customerRegistrationInvite.findUnique({ where: { tokenHash: tokenHash(req.params.token) }, include: { company: { select: { name: true } } } });
  if (!invite || invite.usedAt || invite.expiresAt < new Date()) return res.status(410).json({ message: "Este link expirou ou já foi utilizado." });
  res.json({ companyName: invite.company.name, expiresAt: invite.expiresAt });
});

publicRegistrationRouter.post("/:token", async (req, res) => {
  try {
    const body = registrationSchema.parse(req.body);
    const hash = tokenHash(req.params.token);
    const invite = await prisma.customerRegistrationInvite.findUnique({ where: { tokenHash: hash } });
    if (!invite || invite.usedAt || invite.expiresAt < new Date()) return res.status(410).json({ message: "Este link expirou ou já foi utilizado." });
    const customer = await prisma.$transaction(async (tx) => {
      const claimed = await tx.customerRegistrationInvite.updateMany({ where: { id: invite.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (!claimed.count) throw new Error("INVITE_ALREADY_USED");
      const internalCode = await nextCustomerCode(tx, invite.companyId);
      const created = await tx.customer.create({ data: {
        companyId: invite.companyId, internalCode, name: body.name, cpf: body.cpf, phone: body.phone,
        zipCode: body.zipCode, street: body.street, number: body.number, complement: body.complement,
        neighborhood: body.neighborhood, city: body.city, state: body.state,
        pets: { create: [{ companyId: invite.companyId, name: body.petName, species: body.species, customSpecies: body.species === "OTHER" ? body.customSpecies : null, breed: body.breed, gender: body.petGender, size: body.size, color: body.color, notes: body.notes, isPrimary: true }] }
      }, include: { pets: true } });
      await tx.customerHistory.create({ data: { companyId: invite.companyId, customerId: created.id, type: "CUSTOMER", title: "Cliente cadastrado pelo link", description: `${created.name} concluiu o próprio cadastro.` } });
      await tx.systemNotification.create({ data: { companyId: invite.companyId, customerId: created.id, type: "CUSTOMER_REGISTERED", title: "Novo cliente cadastrado", message: `${created.name} concluiu o cadastro pelo link.` } });
      return created;
    });
    res.status(201).json({ id: customer.id, name: customer.name });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues[0]?.message || "Preencha corretamente os dados obrigatórios." });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return res.status(409).json({ message: "Já existe um cliente cadastrado com este CPF." });
    if (error instanceof Error && error.message === "INVITE_ALREADY_USED") return res.status(410).json({ message: "Este link já foi utilizado." });
    throw error;
  }
});
