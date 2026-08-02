import assert from "node:assert/strict";

const apiUrl = process.env.TEST_API_URL ?? "http://127.0.0.1:3333";
const login = await fetch(`${apiUrl}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: process.env.TEST_ADMIN_EMAIL ?? "admin@ceopet.ai",
    password: process.env.TEST_ADMIN_PASSWORD ?? "admin123"
  })
});
assert.equal(login.status, 200, "login");
const session = await login.json();
const headers = { Authorization: `Bearer ${session.token}` };

const allResponse = await fetch(`${apiUrl}/customers`, { headers });
assert.equal(allResponse.status, 200, "listagem de clientes");
const customers = await allResponse.json();
assert.ok(customers.length, "cliente de teste");
const customer = customers.find((item) => item.pets?.length) ?? customers[0];

const cases = [
  ["nome", customer.name],
  ["CPF", customer.cpf],
  ["telefone", customer.phone],
  ["código", String(customer.internalCode).padStart(4, "0")],
  ["pet", customer.pets?.[0]?.name]
].filter(([, value]) => String(value ?? "").trim().length >= 2);

for (const [label, term] of cases) {
  const url = `${apiUrl}/customers/search?q=${encodeURIComponent(term)}`;
  const response = await fetch(url, { method: "GET", headers });
  const body = await response.json();
  assert.equal(response.status, 200, `${label}: ${JSON.stringify(body)}`);
  assert.ok(body.some((item) => item.id === customer.id), `${label}: cliente não localizado`);
  console.log(`${label}: GET /customers/search -> 200`);
}

const unauthorized = await fetch(`${apiUrl}/customers/search?q=teste`);
assert.equal(unauthorized.status, 401, "autenticação obrigatória");
console.log("autenticação: sem token -> 401");
console.log("Busca de clientes: OK");
