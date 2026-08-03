import "dotenv/config";
import "express-async-errors";
import cors from "cors";
import express from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { authRouter } from "./routes/auth.js";
import { requireAuth } from "./middleware/auth.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { customersRouter } from "./routes/customers.js";
import { catalogRouter } from "./routes/catalog.js";
import { appointmentsRouter } from "./routes/appointments.js";
import { membershipsRouter } from "./routes/memberships.js";
import { salesRouter } from "./routes/sales.js";
import { cashRouter } from "./routes/cash.js";
import { financialRouter } from "./routes/financial.js";
import { prisma } from "./lib/prisma.js";

export const app = express();
const allowedOrigins = new Set(
  ["http://localhost:5173", "http://127.0.0.1:5173", process.env.WEB_ORIGIN]
    .filter(Boolean)
    .join(",")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(null, false);
    }
  })
);
app.use(express.json());

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ status: "ok", api: "running", database: "connected" });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "DATABASE_ERROR";
    console.error(`[${new Date().toISOString()}] HEALTH_DATABASE_DISCONNECTED`, { code });
    return res.status(503).json({ status: "error", api: "running", database: "disconnected", code: "DATABASE_UNREACHABLE" });
  }
});
app.use("/auth", authRouter);
app.use("/dashboard", requireAuth, dashboardRouter);
app.use("/customers", requireAuth, customersRouter);
app.use("/catalog", requireAuth, catalogRouter);
app.use("/appointments", requireAuth, appointmentsRouter);
app.use("/memberships", requireAuth, membershipsRouter);
app.use("/sales", requireAuth, salesRouter);
app.use("/cash", requireAuth, cashRouter);
app.use("/financial", requireAuth, financialRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) return res.status(400).json({ message: "Dados invalidos", issues: error.issues });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P1001") {
    console.error("DATABASE_UNREACHABLE", { code: error.code, model: error.meta?.modelName });
    return res.status(503).json({
      code: "DATABASE_UNREACHABLE",
      message: "Não foi possível conectar ao banco de dados. Verifique a conexão configurada para o Supabase."
    });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2022") {
    console.error("DATABASE_SCHEMA_OUTDATED", { code: error.code, model: error.meta?.modelName });
    return res.status(503).json({
      code: "DATABASE_SCHEMA_OUTDATED",
      message: "O banco de dados precisa ser atualizado antes de usar esta função."
    });
  }
  console.error(error);
  return res.status(500).json({ message: "Erro interno" });
});

if (!process.env.NETLIFY) {
  const port = Number(process.env.PORT ?? 3333);
  app.listen(port, () => {
    console.log(`CEO Pet AI API running on http://localhost:${port}`);
  });
}
