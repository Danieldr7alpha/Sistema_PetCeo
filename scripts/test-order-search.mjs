import assert from "node:assert/strict";

const apiUrl = process.env.TEST_API_URL ?? "http://127.0.0.1:3333";

async function login() {
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.TEST_ADMIN_EMAIL ?? "admin@ceopet.ai",
      password: process.env.TEST_ADMIN_PASSWORD ?? "admin123"
    })
  });
  assert.equal(response.status, 200, "login de teste");
  return (await response.json()).token;
}

async function request(path, token) {
  const response = await fetch(`${apiUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

const token = await login();
const list = await request("/sales/receivable/search?page=1&limit=5", token);
assert.equal(list.response.status, 200, "busca paginada");
assert.equal(list.body.pageSize, 5, "limite aplicado");
assert.ok(list.body.items.every((sale) => ["WAITING_PAYMENT", "PENDING", "PARTIALLY_PAID"].includes(sale.status)), "somente pedidos cobráveis");

if (list.body.items.length) {
  const candidate = list.body.items[0];
  const numericCode = String(candidate.internalCode);
  const byCode = await request(`/sales/by-code/${numericCode}/receivable`, token);
  assert.equal(byCode.response.status, 200, "busca sem zeros à esquerda");
  assert.equal(byCode.body.id, candidate.id, "pedido correto");
  const revalidated = await request(`/sales/${candidate.id}/receivable`, token);
  assert.equal(revalidated.response.status, 200, "revalidação antes de abrir");

  const searchTerms = [
    numericCode,
    candidate.customer?.internalCode,
    candidate.customer?.name,
    candidate.customer?.cpf,
    candidate.customer?.phone,
    candidate.pet?.name
  ].filter(Boolean);
  for (const term of searchTerms) {
    const searched = await request(`/sales/receivable/search?q=${encodeURIComponent(String(term))}&page=1&limit=15`, token);
    assert.equal(searched.response.status, 200, `busca por ${term}`);
    assert.ok(searched.body.items.some((sale) => sale.id === candidate.id), `pedido localizado por ${term}`);
  }
}

const missing = await request("/sales/by-code/999999999/receivable", token);
assert.equal(missing.response.status, 404, "pedido inexistente");
assert.equal(missing.body.code, "ORDER_NOT_FOUND", "código de pedido inexistente");

for (const status of ["PAID", "CANCELLED"]) {
  const candidates = await request(`/sales?status=${status}`, token);
  if (!candidates.body.length) continue;
  const blocked = await request(`/sales/by-code/${candidates.body[0].internalCode}/receivable`, token);
  assert.equal(blocked.response.status, 409, `${status} bloqueado`);
  assert.equal(blocked.body.code, status === "PAID" ? "ORDER_ALREADY_PAID" : "ORDER_CANCELLED");
}

console.log("Busca e validação de pedidos: OK");
