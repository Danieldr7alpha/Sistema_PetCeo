import assert from "node:assert/strict";
import { prisma } from "../apps/api/src/lib/prisma.js";

const apiUrl = process.env.TEST_API_URL ?? "http://127.0.0.1:3333";
const email = process.env.TEST_ADMIN_EMAIL ?? "admin@ceopet.ai";
const password = process.env.TEST_ADMIN_PASSWORD ?? "admin123";
const createdSaleIds: string[] = [];

async function request(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init?.headers }
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function main() {
  const login = await fetch(`${apiUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  assert.equal(login.status, 200, "login");
  const session = await login.json() as { token: string; company: { id: string } };
  const cid = session.company.id;
  const token = session.token;
  const [customer, service, product, cashSession] = await Promise.all([
    prisma.customer.findFirst({ where: { companyId: cid }, include: { pets: true } }),
    prisma.service.findFirst({ where: { companyId: cid, active: true } }),
    prisma.product.findFirst({ where: { companyId: cid, active: true } }),
    prisma.cashSession.findFirst({ where: { companyId: cid, status: "OPEN" } })
  ]);
  assert(customer && service && cashSession, "fixture base");

  async function fixture(kind: "SERVICE" | "PRODUCT" | "MIXED" = "SERVICE") {
    assert(service);
    if (kind !== "SERVICE") assert(product);
    const servicePrice = Number(service.price);
    const productPrice = Number(product?.salePrice ?? 0);
    const items = [
      ...(kind !== "PRODUCT" ? [{
        companyId: cid, itemType: "SERVICE" as const, serviceId: service.id,
        description: service.name, quantity: 1, unitPrice: servicePrice, total: servicePrice
      }] : []),
      ...(kind !== "SERVICE" ? [{
        companyId: cid, itemType: "PRODUCT" as const, productId: product!.id,
        description: product!.name, quantity: 1, unitPrice: productPrice, total: productPrice
      }] : [])
    ];
    const total = items.reduce((sum, item) => sum + item.total, 0);
    const sale = await prisma.sale.create({
      data: {
        companyId: cid,
        customerId: customer!.id,
        petId: customer!.pets[0]?.id,
        origin: "AGENDA",
        status: "WAITING_PAYMENT",
        paymentStatus: "PENDING",
        subtotal: total,
        total,
        stockProcessedAt: kind === "SERVICE" ? null : new Date(),
        items: { create: items }
      },
      include: { items: true }
    });
    createdSaleIds.push(sale.id);
    return sale;
  }

  function itemsPayload(sale: Awaited<ReturnType<typeof fixture>>) {
    return sale.items.map((item) => ({
      itemType: item.itemType,
      productId: item.productId,
      serviceId: item.serviceId,
      quantity: item.quantity
    }));
  }

  async function checkout(
    sale: Awaited<ReturnType<typeof fixture>>,
    body: Record<string, unknown>,
    expected = 200
  ) {
    const result = await request(`/sales/${sale.id}/checkout`, token, {
      method: "PATCH",
      body: JSON.stringify({
        customerId: sale.customerId,
        petId: sale.petId,
        discountType: "VALUE",
        discount: 0,
        items: itemsPayload(sale),
        ...body
      })
    });
    assert.equal(result.response.status, expected, JSON.stringify(result.body));
    return result.body as any;
  }

  for (const invalidCase of [
    { name: "debit without NSU", payment: { method: "DEBIT", amount: 55, cardBrand: "Visa" }, message: "Informe a NSU do cartão para concluir o pagamento." },
    { name: "credit without NSU", payment: { method: "CREDIT", amount: 55, cardBrand: "Visa", installments: 1 }, message: "Informe a NSU do cartão para concluir o pagamento." },
    { name: "credit without installments", payment: { method: "CREDIT", amount: 55, cardBrand: "Visa", cardNsu: "NSU-1" }, message: "parcelas" },
    { name: "card without brand", payment: { method: "DEBIT", amount: 55, cardNsu: "NSU-2" }, message: "bandeira" }
  ]) {
    const sale = await fixture();
    const result = await checkout(sale, {
      status: "PAID", paymentMethod: invalidCase.payment.method, payments: [{ ...invalidCase.payment, amount: Number(sale.total) }]
    }, 400);
    assert(String(result.message).toLowerCase().includes(invalidCase.message.toLowerCase()), invalidCase.name);
    const unchanged = await prisma.sale.findUnique({ where: { id: sale.id }, include: { payments: true } });
    assert.equal(unchanged?.status, "WAITING_PAYMENT", `${invalidCase.name} status rollback`);
    assert.equal(unchanged?.payments.length, 0, `${invalidCase.name} payment rollback`);
  }

  {
    const sale = await fixture();
    const total = Number(sale.total);
    const result = await checkout(sale, {
      status: "PAID", paymentMethod: "CREDIT",
      payments: [
        { method: "CREDIT", amount: Number((total / 2).toFixed(2)), cardBrand: "Visa", cardNsu: `CARD-1-${sale.id}`, installments: 2 },
        { method: "DEBIT", amount: Number((total - Number((total / 2).toFixed(2))).toFixed(2)), cardBrand: "Mastercard" }
      ]
    }, 400);
    assert(String(result.message).includes("NSU"), "two cards, one without NSU");
    assert.equal(await prisma.salePayment.count({ where: { saleId: sale.id } }), 0, "two-card atomic rollback");
  }

  for (const method of ["PIX", "CASH", "DEBIT", "CREDIT"] as const) {
    const sale = await fixture();
    const total = Number(sale.total);
    const payment = {
      method,
      amount: total,
      ...(method === "PIX" ? { cardNsu: `PIX-${sale.id}` } : {}),
      ...(method === "DEBIT" || method === "CREDIT" ? { cardBrand: "Visa", cardNsu: `NSU-${sale.id}`, cardAuthorization: `AUTH-${sale.id}` } : {}),
      ...(method === "CREDIT" ? { installments: 1 } : {})
    };
    const result = await checkout(sale, { status: "PAID", paymentMethod: method, payments: [payment] });
    assert.equal(result.status, "PAID", method);
    assert.equal(result.items[0].productId, null, `${method} service productId`);
    assert(result.receipt?.receiptCode > 0, `${method} receipt`);
    assert.equal(result.receipt.saleId, sale.id, `${method} receipt sale`);
  }

  {
    const sale = await fixture();
    const total = Number(sale.total);
    const result = await checkout(sale, {
      status: "PAID",
      paymentMethod: "PIX",
      payments: [
        { method: "PIX", amount: Number((total * 0.55).toFixed(2)), cardNsu: `MIX-${sale.id}` },
        { method: "CREDIT", amount: Number((total - Number((total * 0.55).toFixed(2))).toFixed(2)), cardBrand: "Visa", cardNsu: `CREDIT-${sale.id}`, installments: 1 }
      ]
    });
    assert.equal(result.payments.length, 2, "mixed payment");
  }

  {
    const sale = await fixture();
    const total = Number(sale.total);
    const first = Number((total * 0.55).toFixed(2));
    const result = await checkout(sale, {
      status: "PAID", paymentMethod: "CREDIT",
      payments: [
        { method: "CREDIT", amount: first, cardBrand: "Visa", cardNsu: `TWO-1-${sale.id}`, installments: 2 },
        { method: "DEBIT", amount: Number((total - first).toFixed(2)), cardBrand: "Mastercard", cardNsu: `TWO-2-${sale.id}` }
      ]
    });
    assert.equal(result.payments.length, 2, "two valid cards");
  }

  {
    const sale = await fixture();
    const finalTotal = Number((Number(sale.total) * 0.9).toFixed(2));
    const result = await checkout(sale, {
      status: "PAID", discount: 10, discountType: "PERCENT",
      paymentMethod: "PIX", payments: [{ method: "PIX", amount: finalTotal, cardNsu: `DISC-${sale.id}` }]
    });
    assert.equal(Number(result.total), finalTotal, "discount + PIX");
  }

  for (const discount of [0, 10]) {
    const sale = await fixture();
    const result = await checkout(sale, {
      status: "PENDING", discount, discountType: discount ? "PERCENT" : "VALUE",
      payments: [], pendingReason: "PIX_LATER", pendingNotes: "Teste automatizado"
    });
    assert.equal(result.status, "PENDING", "pay later");
    assert.equal(result.receipt, null, "pay later without receipt");
    assert.equal(Number(result.discount), discount ? Number(sale.total) * 0.1 : 0, "preserved discount");
    assert.equal(Number(result.pendingAmount), Number(result.total), "pending balance");
  }

  {
    const sale = await fixture();
    const result = await checkout(sale, {
      status: "PARTIALLY_PAID", payments: [{ method: "PIX", amount: 10 }],
      pendingReason: "PARTIAL_PAYMENT", pendingNotes: "Saldo pendente"
    });
    assert.equal(result.status, "PARTIALLY_PAID", "partial");
    const paid = await checkout(sale, {
      status: "PAID", paymentMethod: "PIX",
      payments: [{ method: "PIX", amount: 10 }, { method: "CREDIT", amount: Number(sale.total) - 10, cardBrand: "Visa", cardNsu: `BALANCE-${sale.id}`, installments: 1 }]
    });
    assert.equal(paid.status, "PAID", "receive pending balance");
    assert.equal(paid.payments.length, 2, "preserve previous and new payment");
  }

  for (const kind of ["PRODUCT", "MIXED"] as const) {
    const sale = await fixture(kind);
    const result = await checkout(sale, {
      status: "PAID", paymentMethod: "CASH", payments: [{ method: "CASH", amount: Number(sale.total) }]
    });
    assert.equal(result.status, "PAID", kind);
  }

  {
    const sale = await fixture();
    const invalid = await checkout(sale, {
      status: "PAID", paymentMethod: "PIX", payments: [{ method: "PIX", amount: Number(sale.total) }],
      items: [{ itemType: "SERVICE", productId: null, serviceId: null, quantity: 1 }]
    }, 400);
    assert.equal(invalid.message, "O pedido contém um item sem produto ou serviço vinculado.", "friendly invalid item");
  }

  {
    const sale = await fixture();
    const body = {
      customerId: sale.customerId, petId: sale.petId, status: "PAID",
      paymentMethod: "PIX", payments: [{ method: "PIX", amount: Number(sale.total), cardNsu: `IDEMP-${sale.id}` }],
      discountType: "VALUE", discount: 0, items: itemsPayload(sale)
    };
    const [first, second] = await Promise.all([
      request(`/sales/${sale.id}/checkout`, token, { method: "PATCH", body: JSON.stringify(body) }),
      request(`/sales/${sale.id}/checkout`, token, { method: "PATCH", body: JSON.stringify(body) })
    ]);
    assert([first.response.status, second.response.status].includes(200), "one idempotent request succeeds");
    const payments = await prisma.salePayment.count({ where: { saleId: sale.id } });
    const history = await prisma.customerHistory.count({ where: { saleId: sale.id, title: "Pagamento realizado" } });
    assert.equal(payments, 1, "payment not duplicated");
    assert.equal(history, 1, "history not duplicated");
    assert.equal(await prisma.salesReceipt.count({ where: { saleId: sale.id } }), 1, "receipt not duplicated");
    const persisted = await request(`/sales/${sale.id}/receipt`, token);
    assert.equal(persisted.response.status, 200, "receipt remains queryable");
  }

  {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date());
    const report = await request(`/cash/reports/summary?from=${today}&to=${today}`, token);
    assert.equal(report.response.status, 200, JSON.stringify(report.body));
    const testPaymentIds = new Set((await prisma.salePayment.findMany({
      where: { saleId: { in: createdSaleIds } }, select: { id: true }
    })).map((payment) => payment.id));
    const details = (report.body as any).paymentDetails.filter((payment: any) => testPaymentIds.has(payment.id));
    assert(details.some((payment: any) => payment.method === "DEBIT" && payment.cardNsu && payment.cardBrand), "report debit details");
    assert(details.some((payment: any) => payment.method === "CREDIT" && payment.cardNsu && payment.installments), "report credit details");
    assert(details.some((payment: any) => payment.method === "PIX" && payment.pixReference), "report PIX reference");
    assert(details.some((payment: any) => payment.method === "CASH" && payment.cashReceived != null && payment.changeAmount != null), "report cash details");
  }

  console.log("SALE_CHECKOUT_INTEGRATION=PASS");
  console.log("CENARIOS=CARD_VALIDATION,CARD_ATOMIC_ROLLBACK,PIX,CASH,DEBIT,CREDIT,MIXED,TWO_CARDS,DISCOUNT_PIX,PAY_LATER,DISCOUNT_PAY_LATER,PARTIAL,RECEIVE_BALANCE,PRODUCT,PRODUCT_SERVICE,INVALID_ITEM,DOUBLE_CLICK,DAILY_REPORT");
}

main()
  .finally(async () => {
    if (createdSaleIds.length) {
      await prisma.customerHistory.deleteMany({ where: { saleId: { in: createdSaleIds } } });
      await prisma.salesReceipt.deleteMany({ where: { saleId: { in: createdSaleIds } } });
      await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } });
      const companies = await prisma.company.findMany({ select: { id: true } });
      for (const company of companies) {
        const last = await prisma.salesReceipt.findFirst({ where: { companyId: company.id }, orderBy: { receiptCode: "desc" } });
        await prisma.internalCodeCounter.updateMany({
          where: { companyId: company.id, kind: "SALES_RECEIPT" },
          data: { nextValue: (last?.receiptCode ?? 0) + 1 }
        });
      }
    }
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
