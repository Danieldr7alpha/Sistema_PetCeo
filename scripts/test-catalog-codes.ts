import assert from "node:assert/strict";
import { prisma } from "../apps/api/src/lib/prisma.js";

const apiUrl = process.env.TEST_API_URL ?? "http://127.0.0.1:3333";
const createdProductIds: string[] = [];
const createdServiceIds: string[] = [];

async function main() {
  const login = await fetch(`${apiUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.TEST_ADMIN_EMAIL ?? "admin@ceopet.ai",
      password: process.env.TEST_ADMIN_PASSWORD ?? "admin123"
    })
  });
  assert.equal(login.status, 200);
  const session = await login.json() as { token: string; company: { id: string } };
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` };

  async function createProduct(name: string) {
    const response = await fetch(`${apiUrl}/catalog/products`, {
      method: "POST", headers,
      body: JSON.stringify({ name, salePrice: 10, stock: 0, active: true })
    });
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    createdProductIds.push(body.id);
    return body as { id: string; catalogCode: number; internalCode: number };
  }

  async function createService(name: string) {
    const response = await fetch(`${apiUrl}/catalog/services`, {
      method: "POST", headers,
      body: JSON.stringify({ name, price: 20, estimatedMinutes: 30, active: true })
    });
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    createdServiceIds.push(body.id);
    return body as { id: string; catalogCode: number; internalCode: number };
  }

  const marker = Date.now();
  const first = await createProduct(`Produto teste catálogo ${marker}`);
  const second = await createService(`Serviço teste catálogo ${marker}`);
  const third = await createProduct(`Produto teste catálogo B ${marker}`);
  assert.equal(second.catalogCode, first.catalogCode + 1, "product then service sequence");
  assert.equal(third.catalogCode, second.catalogCode + 1, "service then product sequence");

  const [parallelProduct, parallelService] = await Promise.all([
    createProduct(`Produto concorrente ${marker}`),
    createService(`Serviço concorrente ${marker}`)
  ]);
  assert.notEqual(parallelProduct.catalogCode, parallelService.catalogCode, "parallel codes differ");

  const [productsResponse, servicesResponse] = await Promise.all([
    fetch(`${apiUrl}/catalog/products`, { headers }),
    fetch(`${apiUrl}/catalog/services`, { headers })
  ]);
  const products = await productsResponse.json() as { id: string; catalogCode: number }[];
  const services = await servicesResponse.json() as { id: string; catalogCode: number }[];
  const exactMatches = [
    ...products.map((item) => ({ type: "PRODUCT", ...item })),
    ...services.map((item) => ({ type: "SERVICE", ...item }))
  ].filter((item) => item.catalogCode === second.catalogCode);
  assert.equal(exactMatches.length, 1, "numeric code has one exact PDV match");
  assert.equal(exactMatches[0].type, "SERVICE", "numeric code locates service");

  const duplicates = await prisma.catalogItem.groupBy({
    by: ["companyId", "catalogCode"],
    _count: { _all: true },
    having: { catalogCode: { _count: { gt: 1 } } }
  });
  assert.equal(duplicates.length, 0, "no duplicated catalog codes");

  const migratedProducts = await prisma.product.count({
    where: { companyId: session.company.id, catalogCode: { not: null }, legacyInternalCode: { not: null } }
  });
  const migratedServices = await prisma.service.count({
    where: { companyId: session.company.id, catalogCode: { not: null }, legacyInternalCode: { not: null } }
  });
  assert(migratedProducts > 0 && migratedServices > 0, "legacy mapping preserved");

  console.log("CATALOG_CODE_INTEGRATION=PASS");
  console.log(`SEQUENCE=${first.catalogCode},${second.catalogCode},${third.catalogCode}; PARALLEL=${parallelProduct.catalogCode},${parallelService.catalogCode}`);
}

main()
  .finally(async () => {
    await prisma.catalogItem.deleteMany({
      where: { OR: [{ productId: { in: createdProductIds } }, { serviceId: { in: createdServiceIds } }] }
    });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.service.deleteMany({ where: { id: { in: createdServiceIds } } });
    const companyIds = await prisma.company.findMany({ select: { id: true } });
    for (const company of companyIds) {
      const last = await prisma.catalogItem.findFirst({ where: { companyId: company.id }, orderBy: { catalogCode: "desc" } });
      await prisma.internalCodeCounter.updateMany({
        where: { companyId: company.id, kind: "CATALOG_ITEM" },
        data: { nextValue: (last?.catalogCode ?? 0) + 1 }
      });
    }
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
