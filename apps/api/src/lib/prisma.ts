import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";

if (!process.env.DATABASE_URL) {
  dotenv.config();
  dotenv.config({ path: "apps/api/.env" });
}

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL
});

export const prisma = new PrismaClient({ adapter });
