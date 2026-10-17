import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";

type PrismaGlobal = typeof globalThis & { ceoPetPrisma?: PrismaClient };
const prismaGlobal = globalThis as PrismaGlobal;

function createPrismaClient() {
  if (!process.env.DATABASE_URL) {
    dotenv.config();
    dotenv.config({ path: "apps/api/.env" });
  }

  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    // Netlify can serve simultaneous requests in separate function instances.
    // Keep one database connection per instance and release it quickly so the
    // Supabase session pool is not exhausted when the dashboard loads data.
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000
  });
  return new PrismaClient({ adapter });
}

export const prisma = prismaGlobal.ceoPetPrisma ?? createPrismaClient();
prismaGlobal.ceoPetPrisma = prisma;
