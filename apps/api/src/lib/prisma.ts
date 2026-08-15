import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";
import { AsyncLocalStorage } from "node:async_hooks";

const requestPrisma = new AsyncLocalStorage<PrismaClient>();
let standaloneClient: PrismaClient | undefined;

function createPrismaClient() {
  if (!process.env.DATABASE_URL) {
    dotenv.config();
    dotenv.config({ path: "apps/api/.env" });
  }

  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
  });
  return new PrismaClient({ adapter });
}

function prismaClient() {
  const scoped = requestPrisma.getStore();
  if (scoped) return scoped;
  standaloneClient ??= createPrismaClient();
  return standaloneClient;
}

export function runWithPrismaScope<T>(callback: (client: PrismaClient) => T) {
  const current = requestPrisma.getStore();
  if (current) return callback(current);
  const scoped = createPrismaClient();
  return requestPrisma.run(scoped, () => callback(scoped));
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const current = prismaClient();
    const value = Reflect.get(current, property, current);
    return typeof value === "function" ? value.bind(current) : value;
  }
});
