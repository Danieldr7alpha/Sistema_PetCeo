import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { companyId, requireAdmin } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

export const customersRouter = Router();

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function matchesCustomerSearch(customer: { internalCode: number | null; name: string; cpf: string; phone: string; street: string | null; neighborhood: string | null; city: string | null; pets: { name: string }[] }, query: string) {
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  if (!normalized) return true;
  const digits = onlyDigits(query);
  return customer.name.toLocaleLowerCase("pt-BR").includes(normalized)
    || String(customer.internalCode ?? "").padStart(4, "0").includes(digits || normalized.replace("#", ""))
    || Boolean(digits && onlyDigits(customer.cpf).includes(digits))
    || Boolean(digits && onlyDigits(customer.phone).includes(digits))
    || Boolean(customer.street?.toLocaleLowerCase("pt-BR").includes(normalized))
    || Boolean(customer.neighborhood?.toLocaleLowerCase("pt-BR").includes(normalized))
    || Boolean(customer.city?.toLocaleLowerCase("pt-BR").includes(normalized))
    || customer.pets.some((pet) => pet.name.toLocaleLowerCase("pt-BR").includes(normalized));
}

async function ensureCustomerCodes(cid: string) {
  const missingCodes = await prisma.customer.findMany({
    where: { companyId: cid, internalCode: null },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  if (!missingCodes.length) return;
  const last = await prisma.customer.findFirst({
    where: { companyId: cid, internalCode: { not: null } },
    orderBy: { internalCode: "desc" },
    select: { internalCode: true }
  });
  let nextCode = (last?.internalCode ?? 0) + 1;
  for (const customer of missingCodes) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: { internalCode: nextCode++ }
    });
  }
}

async function nextCustomerCode(tx: Prisma.TransactionClient, cid: string) {
  const existing = await tx.internalCodeCounter.findUnique({
    where: { companyId_kind: { companyId: cid, kind: "CUSTOMER" } }
  });
  if (!existing) {
    const last = await tx.customer.findFirst({
      where: { companyId: cid, internalCode: { not: null } },
      orderBy: { internalCode: "desc" },
      select: { internalCode: true }
    });
    const nextValue = (last?.internalCode ?? 0) + 1;
    await tx.internalCodeCounter.create({
      data: { companyId: cid, kind: "CUSTOMER", nextValue: nextValue + 1 }
    });
    return nextValue;
  }
  await tx.internalCodeCounter.update({
    where: { id: existing.id },
    data: { nextValue: { increment: 1 } }
  });
  return existing.nextValue;
}

function customerErrorMessage(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = Array.isArray(error.meta?.target) ? error.meta?.target.join(",") : String(error.meta?.target ?? "");
    if (target.includes("cpf")) return "Já existe um cliente cadastrado com este CPF.";
    if (target.includes("internalCode")) return "Não foi possível gerar o código do cliente. Tente novamente.";
  }
  return "Não foi possível salvar o cliente.";
}

const petSchema = z.object({
  name: z.string().min(1),
  species: z.enum(["DOG", "CAT", "OTHER"]),
  customSpecies: z.string().optional(),
  breed: z.string().optional(),
  gender: z.enum(["MALE", "FEMALE", "UNINFORMED"]).default("UNINFORMED"),
  size: z.enum(["SMALL", "MEDIUM", "LARGE", "GIANT"]).optional(),
  color: z.string().optional(),
  weight: z.coerce.number().optional(),
  birthDate: z.string().optional(),
  vaccinesStatus: z.enum(["YES", "NO", "UNINFORMED"]).default("UNINFORMED"),
  status: z.enum(["ACTIVE", "INACTIVE", "DECEASED"]).default("ACTIVE"),
  isPrimary: z.boolean().default(false),
  notes: z.string().optional()
});

const customerSchema = z.object({
  name: z.string().min(1),
  cpf: z.string().min(1).transform((value) => onlyDigits(value).slice(0, 11)),
  gender: z.enum(["MALE", "FEMALE", "OTHER", "UNINFORMED"]).default("UNINFORMED"),
  customGender: z.string().trim().optional(),
  phone: z.string().min(1).transform((value) => onlyDigits(value).slice(0, 11)),
  zipCode: z.string().optional(),
  street: z.string().optional(),
  number: z.string().optional(),
  complement: z.string().optional(),
  neighborhood: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional()
});

customersRouter.get("/", async (req, res) => {
  const cid = companyId(req);
  await ensureCustomerCodes(cid);
  const q = String(req.query.q ?? "").trim();
  const customers = await prisma.customer.findMany({
    where: { companyId: cid },
    include: { pets: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }, memberships: true },
    orderBy: { createdAt: "desc" }
  });
  const filtered = q ? customers.filter((customer) => matchesCustomerSearch(customer, q)) : customers;
  res.json(filtered);
});

customersRouter.get("/search", async (req, res) => {
  const cid = companyId(req);
  await ensureCustomerCodes(cid);
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return res.json([]);
  const customers = await prisma.customer.findMany({
    where: { companyId: cid },
    include: {
      pets: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      memberships: { include: { plan: { include: { service: true } }, pet: true } }
    },
    orderBy: [{ internalCode: "asc" }, { createdAt: "asc" }],
  });
  const normalized = q.toLocaleLowerCase("pt-BR");
  const qDigits = onlyDigits(q);
  const parsedCode = /^\d{1,9}$/.test(qDigits) ? Number(qDigits) : undefined;
  const code = parsedCode && parsedCode <= 2_147_483_647 ? parsedCode : undefined;
  const results = customers
    .filter((customer) => matchesCustomerSearch(customer, q))
    .map((customer) => {
      const matchedPet = customer.pets.find((pet) => pet.name.toLowerCase().includes(normalized));
      const exactCode = code && customer.internalCode === code ? 0 : 1;
      const startsWithName = customer.name.toLowerCase().startsWith(normalized) ? 0 : 1;
      return { ...customer, matchedPetId: matchedPet?.id, matchedPetName: matchedPet?.name, relevance: exactCode + startsWithName };
    })
    .sort((a, b) => a.relevance - b.relevance || (a.internalCode ?? 0) - (b.internalCode ?? 0))
    .slice(0, 10)
    .map(({ relevance, ...customer }) => customer);
  res.json(results);
});

customersRouter.post("/", async (req, res) => {
  const cid = companyId(req);
  try {
    const body = customerSchema.extend({ pets: z.array(petSchema).min(1) }).parse(req.body);
    const customer = await prisma.$transaction(async (tx) => {
      const internalCode = await nextCustomerCode(tx, cid);
      const created = await tx.customer.create({
        data: {
          companyId: cid,
          internalCode,
          name: body.name,
          cpf: body.cpf,
          gender: body.gender,
          customGender: body.gender === "OTHER" ? body.customGender : null,
          phone: body.phone,
          zipCode: body.zipCode,
          street: body.street,
          number: body.number,
          complement: body.complement,
          neighborhood: body.neighborhood,
          city: body.city,
          state: body.state,
          pets: {
            create: body.pets.map((pet) => ({
              ...pet,
              customSpecies: pet.species === "OTHER" ? pet.customSpecies : null,
              companyId: cid,
              birthDate: pet.birthDate ? new Date(pet.birthDate) : undefined,
              weight: pet.weight
            }))
          }
        },
        include: { pets: true, memberships: true }
      });
      await tx.customerHistory.create({
        data: {
          companyId: cid,
          customerId: created.id,
          type: "CUSTOMER",
          title: "Cliente cadastrado",
          description: `${created.name} cadastrado com ${created.pets.length} pet(s).`
        }
      });
      return created;
    });
    res.status(201).json(customer);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: "Preencha corretamente os dados do cliente." });
    return res.status(400).json({ message: customerErrorMessage(error) });
  }
});

customersRouter.put("/:id", async (req, res) => {
  const cid = companyId(req);
  const body = customerSchema.parse(req.body);
  const result = await prisma.customer.updateMany({
    where: { id: req.params.id, companyId: cid },
    data: { ...body, customGender: body.gender === "OTHER" ? body.customGender : null }
  });
  if (!result.count) return res.status(404).json({ message: "Cliente não encontrado" });
  const customer = await prisma.customer.findFirst({
    where: { id: req.params.id, companyId: cid },
    include: { pets: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }, memberships: true }
  });
  res.json(customer);
});

customersRouter.get("/:id", async (req, res) => {
  const customer = await prisma.customer.findFirst({
    where: { id: req.params.id, companyId: companyId(req) },
    include: {
      pets: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      histories: { orderBy: { createdAt: "desc" } },
      memberships: { include: { plan: { include: { service: true } }, pet: true } },
      sales: {
        where: { status: "PAID", receipt: { isNot: null } },
        orderBy: { paidAt: "desc" },
        include: {
          receipt: true,
          items: { orderBy: { createdAt: "asc" } },
          payments: { orderBy: { paidAt: "asc" } },
          pet: { select: { id: true, name: true } }
        }
      }
    }
  });
  if (!customer) return res.status(404).json({ message: "Cliente não encontrado" });
  res.json(customer);
});

customersRouter.post("/:id/pets", async (req, res) => {
  const cid = companyId(req);
  const body = petSchema.parse(req.body);
  const customer = await prisma.customer.findFirst({ where: { id: req.params.id, companyId: cid } });
  if (!customer) return res.status(404).json({ message: "Cliente não encontrado" });
  if (body.isPrimary) {
    await prisma.pet.updateMany({ where: { customerId: customer.id, companyId: cid }, data: { isPrimary: false } });
  }
  const pet = await prisma.pet.create({ data: { ...body, companyId: cid, customerId: customer.id, birthDate: body.birthDate ? new Date(body.birthDate) : undefined } });
  await prisma.customerHistory.create({
    data: { companyId: cid, customerId: customer.id, petId: pet.id, type: "PET", title: "Pet adicionado", description: pet.name }
  });
  res.status(201).json(pet);
});

customersRouter.patch("/:customerId/pets/:petId", async (req, res) => {
  const cid = companyId(req);
  const body = petSchema.partial().parse(req.body);
  const pet = await prisma.pet.findFirst({ where: { id: req.params.petId, customerId: req.params.customerId, companyId: cid } });
  if (!pet) return res.status(404).json({ message: "Pet não encontrado" });
  if (body.isPrimary) {
    await prisma.pet.updateMany({ where: { customerId: req.params.customerId, companyId: cid }, data: { isPrimary: false } });
  }
  const updated = await prisma.pet.update({
    where: { id: pet.id },
    data: { ...body, birthDate: body.birthDate ? new Date(body.birthDate) : undefined }
  });
  if (body.status && body.status !== pet.status) {
    await prisma.customerHistory.create({
      data: {
        companyId: cid,
        customerId: req.params.customerId,
        petId: pet.id,
        type: "PET",
        title: body.status === "DECEASED" ? "Pet marcado como falecido" : "Status do pet alterado",
        description: `${pet.name}: ${body.status}`
      }
    });
  }
  res.json(updated);
});

customersRouter.delete("/:customerId/pets/:petId", requireAdmin, async (req, res) => {
  const cid = companyId(req);
  const pet = await prisma.pet.findFirst({ where: { id: req.params.petId, customerId: req.params.customerId, companyId: cid } });
  if (!pet) return res.status(404).json({ message: "Pet não encontrado" });
  await prisma.pet.update({ where: { id: pet.id }, data: { status: "INACTIVE" } });
  await prisma.customerHistory.create({
    data: { companyId: cid, customerId: req.params.customerId, petId: pet.id, type: "PET", title: "Pet marcado como inativo", description: pet.name }
  });
  res.status(204).send();
});
