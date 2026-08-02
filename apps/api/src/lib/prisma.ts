import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";

dotenv.config({ path: new URL("../../.env", import.meta.url) });

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL
});

export const prisma = new PrismaClient({ adapter });
