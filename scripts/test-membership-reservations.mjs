import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [schema, appointments, memberships, sales, migration] = await Promise.all([
  readFile(new URL("../apps/api/prisma/schema.prisma", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/routes/appointments.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/routes/memberships.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/routes/sales.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202607300002_membership_usage_reservations.sql", import.meta.url), "utf8")
]);

assert.match(schema, /enum MembershipUsageStatus[\s\S]*RESERVED[\s\S]*CONSUMED[\s\S]*RELEASED/);
assert.match(schema, /appointmentId\s+String\s+@unique/);
assert.match(schema, /@@unique\(\[membershipId, appointmentId\]\)/);
assert.match(migration, /MembershipUsage_appointmentId_key/);
assert.match(appointments, /pg_advisory_xact_lock/);
assert.match(appointments, /status: "RESERVED"/);
assert.match(appointments, /status: "CONSUMED"/);
assert.match(appointments, /status: "RELEASED"/);
assert.match(appointments, /remainingUses: \{ gt: 0 \}/);
assert.match(appointments, /membership\.plan\.serviceId !== body\.serviceId/);
assert.match(appointments, /membershipId: body\.paymentMode === "PACKAGE"/);
assert.match(memberships, /availableUses = Math\.max\(0, membership\.remainingUses - reservedUses\)/);
assert.match(memberships, /DIRECT_MEMBERSHIP_USE_DISABLED/);
assert.match(sales, /coveredByMembership/);
assert.match(sales, /if \(!transactionSale\.appointmentId\)/);

console.log("Reserva e consumo de mensalidade: estrutura validada");
