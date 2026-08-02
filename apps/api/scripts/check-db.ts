import { appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "../src/lib/prisma.js";

function errorCode(error: unknown) {
  const visited = new Set<unknown>();
  function findOriginalCode(value: unknown): string | null {
    if (!value || typeof value !== "object" || visited.has(value)) return null;
    visited.add(value);
    const record = value as Record<string, unknown>;
    if (record.originalCode) return String(record.originalCode);
    for (const nested of Object.values(record)) {
      const found = findOriginalCode(nested);
      if (found) return found;
    }
    return null;
  }
  const originalCode = findOriginalCode(error);
  if (originalCode) return originalCode;
  if (typeof error === "object" && error) {
    const record = error as Record<string, unknown>;
    if (record.code) return String(record.code);
  }
  return "DATABASE_ERROR";
}

async function writeSanitizedLog(code: string) {
  const logsDirectory = resolve(process.cwd(), "../../logs");
  await mkdir(logsDirectory, { recursive: true });
  await appendFile(
    resolve(logsDirectory, "api.log"),
    `[${new Date().toISOString()}] DB_CHECK_FAILED code=${code}\n`,
    "utf8"
  );
}

try {
  await prisma.$queryRaw`SELECT 1`;
  console.log("Conexão com o Supabase confirmada.");
} catch (error) {
  const code = errorCode(error);
  await writeSanitizedLog(code);
  console.error(`Não foi possível conectar ao Supabase. Consulte logs/api.log. Código: ${code}.`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
