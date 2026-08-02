import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { companyId } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

export const catalogRouter = Router();

const optionalText = z.preprocess((value) => value === "" ? undefined : value, z.string().optional());
const optionalDecimal = z.preprocess((value) => value === "" || value === null ? undefined : value, z.coerce.number().nonnegative().optional());
const adminPasswordSchema = z.object({ adminPassword: z.string().min(1) });

const serviceSchema = z.object({
  name: z.string().min(1),
  category: optionalText,
  petSize: optionalText,
  coat: optionalText,
  price: z.coerce.number().nonnegative(),
  costEstimate: optionalDecimal,
  estimatedMinutes: z.coerce.number().int().positive(),
  desiredMargin: optionalDecimal,
  active: z.boolean().default(true),
  notes: optionalText
});

const productSchema = z.object({
  name: z.string().min(1),
  category: optionalText,
  sku: optionalText,
  barcode: optionalText,
  brand: optionalText,
  supplier: optionalText,
  salePrice: z.coerce.number().nonnegative(),
  costPrice: optionalDecimal,
  desiredMargin: optionalDecimal,
  stock: z.coerce.number().nonnegative().default(0),
  minStock: optionalDecimal.default(0),
  unit: z.enum(["unidade", "pacote", "kg", "g", "litro", "ml", "outro"]).default("unidade"),
  allowNegativeStock: z.boolean().default(false),
  active: z.boolean().default(true),
  notes: optionalText
});

const reusableOptionSchema = z.object({ name: z.string().min(1), adminPassword: z.string().min(1) });
const reusableKinds = ["product-category", "product-brand", "supplier", "service-category"] as const;

function cleanCatalogName(value?: string) {
  const clean = value?.trim().replace(/\s+/g, " ");
  return clean || undefined;
}

function normalizedCatalogName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

async function ensureProductCategory(cid: string, value?: string) {
  const name = cleanCatalogName(value);
  if (!name) return null;
  return prisma.productCategory.upsert({
    where: { companyId_normalizedName: { companyId: cid, normalizedName: normalizedCatalogName(name) } },
    update: { active: true },
    create: { companyId: cid, name, normalizedName: normalizedCatalogName(name) }
  });
}

async function ensureProductBrand(cid: string, value?: string) {
  const name = cleanCatalogName(value);
  if (!name) return null;
  return prisma.productBrand.upsert({
    where: { companyId_normalizedName: { companyId: cid, normalizedName: normalizedCatalogName(name) } },
    update: { active: true },
    create: { companyId: cid, name, normalizedName: normalizedCatalogName(name) }
  });
}

async function ensureSupplier(cid: string, value?: string) {
  const name = cleanCatalogName(value);
  if (!name) return null;
  return prisma.supplier.upsert({
    where: { companyId_normalizedName: { companyId: cid, normalizedName: normalizedCatalogName(name) } },
    update: { active: true },
    create: { companyId: cid, name, normalizedName: normalizedCatalogName(name) }
  });
}

async function ensureServiceCategory(cid: string, value?: string) {
  const name = cleanCatalogName(value);
  if (!name) return null;
  return prisma.serviceCategory.upsert({
    where: { companyId_normalizedName: { companyId: cid, normalizedName: normalizedCatalogName(name) } },
    update: { active: true },
    create: { companyId: cid, name, normalizedName: normalizedCatalogName(name) }
  });
}

async function productLookupData(cid: string, body: { category?: string; brand?: string; supplier?: string }) {
  const [category, brand, supplier] = await Promise.all([
    ensureProductCategory(cid, body.category),
    ensureProductBrand(cid, body.brand),
    ensureSupplier(cid, body.supplier)
  ]);

  return {
    category: category?.name ?? cleanCatalogName(body.category),
    categoryId: category?.id,
    brand: brand?.name ?? cleanCatalogName(body.brand),
    brandId: brand?.id,
    supplier: supplier?.name ?? cleanCatalogName(body.supplier),
    supplierId: supplier?.id
  };
}

async function serviceLookupData(cid: string, body: { category?: string }) {
  const category = await ensureServiceCategory(cid, body.category);
  return {
    category: category?.name ?? cleanCatalogName(body.category),
    categoryId: category?.id
  };
}

async function syncInternalCodeCounter(cid: string, kind: "PRODUCT" | "SERVICE", nextValue: number) {
  const counter = await prisma.internalCodeCounter.findUnique({
    where: { companyId_kind: { companyId: cid, kind } },
    select: { id: true, nextValue: true }
  });

  if (!counter) {
    await prisma.internalCodeCounter.create({ data: { companyId: cid, kind, nextValue } });
    return;
  }

  if (counter.nextValue < nextValue) {
    await prisma.internalCodeCounter.update({ where: { id: counter.id }, data: { nextValue } });
  }
}

async function reserveInternalCode(cid: string, kind: "PRODUCT" | "SERVICE") {
  const counter = await prisma.internalCodeCounter.upsert({
    where: { companyId_kind: { companyId: cid, kind } },
    update: { nextValue: { increment: 1 } },
    create: { companyId: cid, kind, nextValue: 2 },
    select: { nextValue: true }
  });
  return counter.nextValue - 1;
}

async function reserveCatalogCode(db: any, cid: string) {
  const counter = await db.internalCodeCounter.upsert({
    where: { companyId_kind: { companyId: cid, kind: "CATALOG_ITEM" } },
    update: { nextValue: { increment: 1 } },
    create: { companyId: cid, kind: "CATALOG_ITEM", nextValue: 2 },
    select: { nextValue: true }
  });
  return counter.nextValue - 1;
}

async function ensureProductCodes(cid: string) {
  const missingCodes = await prisma.product.findMany({
    where: { companyId: cid, internalCode: null },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  const last = await prisma.product.findFirst({
    where: { companyId: cid, internalCode: { not: null } },
    orderBy: { internalCode: "desc" },
    select: { internalCode: true }
  });
  const counter = await prisma.internalCodeCounter.findUnique({
    where: { companyId_kind: { companyId: cid, kind: "PRODUCT" } },
    select: { nextValue: true }
  });
  let nextCode = Math.max((last?.internalCode ?? 0) + 1, counter?.nextValue ?? 1);
  for (const product of missingCodes) {
    await prisma.product.update({ where: { id: product.id }, data: { internalCode: nextCode++ } });
  }
  await syncInternalCodeCounter(cid, "PRODUCT", nextCode);
}

async function nextProductCode(cid: string) {
  await ensureProductCodes(cid);
  return reserveInternalCode(cid, "PRODUCT");
}

async function ensureServiceCodes(cid: string) {
  const missingCodes = await prisma.service.findMany({
    where: { companyId: cid, internalCode: null },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  const last = await prisma.service.findFirst({
    where: { companyId: cid, internalCode: { not: null } },
    orderBy: { internalCode: "desc" },
    select: { internalCode: true }
  });
  const counter = await prisma.internalCodeCounter.findUnique({
    where: { companyId_kind: { companyId: cid, kind: "SERVICE" } },
    select: { nextValue: true }
  });
  let nextCode = Math.max((last?.internalCode ?? 0) + 1, counter?.nextValue ?? 1);
  for (const service of missingCodes) {
    await prisma.service.update({ where: { id: service.id }, data: { internalCode: nextCode++ } });
  }
  await syncInternalCodeCounter(cid, "SERVICE", nextCode);
}

async function nextServiceCode(cid: string) {
  await ensureServiceCodes(cid);
  return reserveInternalCode(cid, "SERVICE");
}

function productView<T extends { category?: string | null; brand?: string | null; supplier?: string | null; categoryRef?: { name: string } | null; brandRef?: { name: string } | null; supplierRef?: { name: string } | null }>(product: T) {
  return {
    ...product,
    category: product.categoryRef?.name ?? product.category,
    brand: product.brandRef?.name ?? product.brand,
    supplier: product.supplierRef?.name ?? product.supplier
  };
}

function serviceView<T extends { category?: string | null; categoryRef?: { name: string } | null }>(service: T) {
  return {
    ...service,
    category: service.categoryRef?.name ?? service.category
  };
}

async function validateAdminPassword(req: Request, res: Response) {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ message: "Você não possui permissão para executar esta ação." });
    return false;
  }

  const cid = companyId(req);
  const { adminPassword } = adminPasswordSchema.parse(req.body);
  const user = await prisma.user.findFirst({ where: { id: req.user.userId, companyId: cid, role: "ADMIN" } });
  if (!user || !(await bcrypt.compare(adminPassword, user.passwordHash))) {
    res.status(401).json({ message: "Senha do administrador incorreta." });
    return false;
  }

  return true;
}

async function backfillProductLookups(cid: string) {
  const products = await prisma.product.findMany({ where: { companyId: cid } });
  for (const product of products) {
    if ((!product.category || product.categoryId) && (!product.brand || product.brandId) && (!product.supplier || product.supplierId)) continue;
    const lookupData = await productLookupData(cid, {
      category: product.category ?? undefined,
      brand: product.brand ?? undefined,
      supplier: product.supplier ?? undefined
    });
    await prisma.product.update({
      where: { id: product.id },
      data: {
        category: lookupData.category,
        categoryId: lookupData.categoryId,
        brand: lookupData.brand,
        brandId: lookupData.brandId,
        supplier: lookupData.supplier,
        supplierId: lookupData.supplierId
      }
    });
  }
}

async function backfillServiceLookups(cid: string) {
  const services = await prisma.service.findMany({ where: { companyId: cid } });
  for (const service of services) {
    if (!service.category || service.categoryId) continue;
    const lookupData = await serviceLookupData(cid, { category: service.category });
    await prisma.service.update({
      where: { id: service.id },
      data: { category: lookupData.category, categoryId: lookupData.categoryId }
    });
  }
}

async function updateReusableOption(kind: typeof reusableKinds[number], cid: string, id: string, name: string) {
  const cleanName = cleanCatalogName(name);
  if (!cleanName) throw new Error("Nome inválido");
  const normalizedName = normalizedCatalogName(cleanName);

  if (kind === "product-category") {
    const current = await prisma.productCategory.findFirst({ where: { id, companyId: cid } });
    if (!current) return { notFound: true as const };
    const duplicate = await prisma.productCategory.findFirst({ where: { companyId: cid, normalizedName, id: { not: id } } });
    if (duplicate) return { conflict: true as const };
    const option = await prisma.productCategory.update({ where: { id }, data: { name: cleanName, normalizedName, active: true } });
    await prisma.product.updateMany({ where: { companyId: cid, categoryId: id }, data: { category: option.name } });
    return { conflict: false as const, option };
  }

  if (kind === "product-brand") {
    const current = await prisma.productBrand.findFirst({ where: { id, companyId: cid } });
    if (!current) return { notFound: true as const };
    const duplicate = await prisma.productBrand.findFirst({ where: { companyId: cid, normalizedName, id: { not: id } } });
    if (duplicate) return { conflict: true as const };
    const option = await prisma.productBrand.update({ where: { id }, data: { name: cleanName, normalizedName, active: true } });
    await prisma.product.updateMany({ where: { companyId: cid, brandId: id }, data: { brand: option.name } });
    return { conflict: false as const, option };
  }

  if (kind === "supplier") {
    const current = await prisma.supplier.findFirst({ where: { id, companyId: cid } });
    if (!current) return { notFound: true as const };
    const duplicate = await prisma.supplier.findFirst({ where: { companyId: cid, normalizedName, id: { not: id } } });
    if (duplicate) return { conflict: true as const };
    const option = await prisma.supplier.update({ where: { id }, data: { name: cleanName, normalizedName, active: true } });
    await prisma.product.updateMany({ where: { companyId: cid, supplierId: id }, data: { supplier: option.name } });
    return { conflict: false as const, option };
  }

  const current = await prisma.serviceCategory.findFirst({ where: { id, companyId: cid } });
  if (!current) return { notFound: true as const };
  const duplicate = await prisma.serviceCategory.findFirst({ where: { companyId: cid, normalizedName, id: { not: id } } });
  if (duplicate) return { conflict: true as const };
  const option = await prisma.serviceCategory.update({ where: { id }, data: { name: cleanName, normalizedName, active: true } });
  await prisma.service.updateMany({ where: { companyId: cid, categoryId: id }, data: { category: option.name } });
  return { conflict: false as const, option };
}

catalogRouter.get("/services", async (req, res) => {
  const includeInactive = req.query.includeInactive === "true";
  if (includeInactive && req.user?.role !== "ADMIN") {
    return res.status(403).json({ message: "Você não possui permissão para executar esta ação." });
  }
  const cid = companyId(req);
  await backfillServiceLookups(cid);
  const services = await prisma.service.findMany({
    where: { companyId: cid, active: includeInactive ? undefined : true },
    include: { categoryRef: true },
    orderBy: [{ catalogCode: "asc" }, { name: "asc" }]
  });
  res.json(services.map(serviceView));
});

catalogRouter.post("/admin-auth", async (req, res) => {
  if (!(await validateAdminPassword(req, res))) return;
  res.json({ ok: true });
});

catalogRouter.post("/services", async (req, res) => {
  const cid = companyId(req);
  const body = serviceSchema.parse(req.body);
  const lookupData = await serviceLookupData(cid, body);
  const service = await prisma.$transaction(async (tx) => {
    const catalogCode = await reserveCatalogCode(tx, cid);
    const created = await tx.service.create({
      data: { ...body, ...lookupData, companyId: cid, internalCode: catalogCode, catalogCode },
      include: { categoryRef: true }
    });
    await tx.catalogItem.create({
      data: { companyId: cid, catalogCode, itemType: "SERVICE", serviceId: created.id, active: created.active }
    });
    return created;
  });
  res.status(201).json(serviceView(service));
});

catalogRouter.patch("/services/:id", async (req, res) => {
  if (!(await validateAdminPassword(req, res))) return;
  const cid = companyId(req);
  const body = serviceSchema.partial().parse(req.body);
  const lookupData = await serviceLookupData(cid, body);
  await prisma.service.updateMany({ where: { id: req.params.id, companyId: cid }, data: { ...body, ...lookupData } });
  if (body.active !== undefined) {
    await prisma.catalogItem.updateMany({ where: { serviceId: req.params.id, companyId: cid }, data: { active: body.active } });
  }
  const service = await prisma.service.findFirst({ where: { id: req.params.id, companyId: cid }, include: { categoryRef: true } });
  if (!service) return res.status(404).json({ message: "Serviço não encontrado" });
  res.json(serviceView(service));
});

catalogRouter.delete("/services/:id", async (req, res) => {
  if (!(await validateAdminPassword(req, res))) return;
  const cid = companyId(req);
  const service = await prisma.service.findFirst({ where: { id: req.params.id, companyId: cid } });
  if (!service) return res.status(404).json({ message: "Serviço não encontrado" });

  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.service.update({ where: { id: service.id }, data: { active: false } });
    await tx.catalogItem.updateMany({ where: { serviceId: service.id, companyId: cid }, data: { active: false } });
    return item;
  });
  return res.json({ mode: "inactive", service: updated });
});

catalogRouter.get("/product-options", async (req, res) => {
  const cid = companyId(req);
  await backfillProductLookups(cid);
  await backfillServiceLookups(cid);
  const [categories, brands, suppliers, serviceCategories] = await Promise.all([
    prisma.productCategory.findMany({ where: { companyId: cid, active: true }, orderBy: { name: "asc" } }),
    prisma.productBrand.findMany({ where: { companyId: cid, active: true }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { companyId: cid, active: true }, orderBy: { name: "asc" } }),
    prisma.serviceCategory.findMany({ where: { companyId: cid, active: true }, orderBy: { name: "asc" } })
  ]);
  res.json({ categories, brands, suppliers, serviceCategories });
});

catalogRouter.patch("/reusable-options/:kind/:id", async (req, res) => {
  if (!(await validateAdminPassword(req, res))) return;
  const kind = reusableKinds.find((item) => item === req.params.kind);
  if (!kind) return res.status(404).json({ message: "Cadastro reutilizável não encontrado" });
  const cid = companyId(req);
  const body = reusableOptionSchema.parse(req.body);
  const result = await updateReusableOption(kind, cid, req.params.id, body.name);
  if ("notFound" in result && result.notFound) return res.status(404).json({ message: "Cadastro reutilizável não encontrado" });
  if (result.conflict) return res.status(409).json({ message: "Já existe um cadastro com este nome." });
  res.json(result.option);
});

catalogRouter.get("/products", async (req, res) => {
  const includeInactive = req.query.includeInactive === "true";
  if (includeInactive && req.user?.role !== "ADMIN") {
    return res.status(403).json({ message: "Você não possui permissão para executar esta ação." });
  }
  const cid = companyId(req);
  const products = await prisma.product.findMany({
    where: { companyId: cid, active: includeInactive ? undefined : true },
    include: { categoryRef: true, brandRef: true, supplierRef: true },
    orderBy: [{ catalogCode: "asc" }, { name: "asc" }]
  });
  res.json(products.map(productView));
});

catalogRouter.post("/products", async (req, res) => {
  const cid = companyId(req);
  const body = productSchema.parse(req.body);
  const lookupData = await productLookupData(cid, body);
  const product = await prisma.$transaction(async (tx) => {
    const catalogCode = await reserveCatalogCode(tx, cid);
    const created = await tx.product.create({
      data: { ...body, ...lookupData, companyId: cid, internalCode: catalogCode, catalogCode },
      include: { categoryRef: true, brandRef: true, supplierRef: true }
    });
    await tx.catalogItem.create({
      data: { companyId: cid, catalogCode, itemType: "PRODUCT", productId: created.id, active: created.active }
    });
    return created;
  });
  res.status(201).json(productView(product));
});

catalogRouter.patch("/products/:id", async (req, res) => {
  if (!(await validateAdminPassword(req, res))) return;
  const cid = companyId(req);
  const body = productSchema.partial().parse(req.body);
  const lookupData = await productLookupData(cid, body);
  await prisma.product.updateMany({ where: { id: req.params.id, companyId: cid }, data: { ...body, ...lookupData } });
  if (body.active !== undefined) {
    await prisma.catalogItem.updateMany({ where: { productId: req.params.id, companyId: cid }, data: { active: body.active } });
  }
  const product = await prisma.product.findFirst({
    where: { id: req.params.id, companyId: cid },
    include: { categoryRef: true, brandRef: true, supplierRef: true }
  });
  if (!product) return res.status(404).json({ message: "Produto não encontrado" });
  res.json(productView(product));
});

catalogRouter.delete("/products/:id", async (req, res) => {
  if (!(await validateAdminPassword(req, res))) return;
  const cid = companyId(req);
  const product = await prisma.product.findFirst({ where: { id: req.params.id, companyId: cid } });
  if (!product) return res.status(404).json({ message: "Produto não encontrado" });

  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.product.update({ where: { id: product.id }, data: { active: false } });
    await tx.catalogItem.updateMany({ where: { productId: product.id, companyId: cid }, data: { active: false } });
    return item;
  });
  return res.json({ mode: "inactive", product: updated });
});
