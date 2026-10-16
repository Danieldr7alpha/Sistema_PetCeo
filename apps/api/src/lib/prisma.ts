import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";

function createPrismaClient() {
  if (!process.env.DATABASE_URL) {
    dotenv.config();
    dotenv.config({ path: "apps/api/.env" });
  }

  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    // Supabase's session pool has a small connection budget. One shared client
    // keeps the API below that limit even when the frontend loads several views.
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
  });
  return new PrismaClient({ adapter });
}

export const prisma = createPrismaClient();
