import dotenv from "dotenv";
import pg from "pg";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(scriptDirectory, "../apps/api/.env") });

const connectionString = process.env.DATABASE_URL;
if (!connectionString?.startsWith("postgresql://")) {
  console.log("DATABASE_URL ausente ou invalida.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  connectionTimeoutMillis: 8000,
  query_timeout: 8000
});

try {
  await client.connect();
  await client.query("SELECT 1");
  console.log("Conexao confirmada.");
  process.exitCode = 0;
} catch (error) {
  console.log(`Falha de conexao (${error?.code ?? "sem codigo"}).`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
