import cors from "cors";
import express from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { authRouter } from "./routes/auth.js";
import { requireAuth, requirePermission } from "./middleware/auth.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { customersRouter } from "./routes/customers.js";
import { catalogRouter } from "./routes/catalog.js";
import { appointmentsRouter } from "./routes/appointments.js";
import { membershipsRouter } from "./routes/memberships.js";
import { salesRouter } from "./routes/sales.js";
import { cashRouter } from "./routes/cash.js";
import { financialRouter } from "./routes/financial.js";
import { managementRouter } from "./routes/management.js";
import { publicRegistrationRouter } from "./routes/public-registration.js";
import { notificationsRouter } from "./routes/notifications.js";
import { prisma, runWithPrismaScope } from "./lib/prisma.js";

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
      const isLocalDevelopment = Boolean(origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin));
      if (!origin || allowedOrigins.has(origin) || isLocalDevelopment) return callback(null, true);
      return callback(null, false);
    }
  })
);
app.use(express.json());
app.use((_req, res, next) => {
  runWithPrismaScope((client) => {
    res.once("finish", () => {
      void client.$disconnect();
    });
    next();
  });
});

app.get("/health", async (_req, res) => {
  try {
    await prisma.user.count();
    return res.json({ status: "ok", api: "running", database: "connected" });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "DATABASE_ERROR";
    console.error(`[${new Date().toISOString()}] HEALTH_DATABASE_DISCONNECTED`, { code });
    return res.status(503).json({ status: "error", api: "running", database: "disconnected", code: "DATABASE_UNREACHABLE" });
  }
});
app.use("/auth", authRouter);
app.use("/public-registration", publicRegistrationRouter);
app.use("/notifications", requireAuth, notificationsRouter);
app.use("/dashboard", requireAuth, requirePermission("dashboard"), dashboardRouter);
app.use("/customers", requireAuth, requirePermission("customers"), customersRouter);
app.use("/catalog", requireAuth, requirePermission("products"), catalogRouter);
app.use("/appointments", requireAuth, requirePermission("appointments"), appointmentsRouter);
app.use("/memberships", requireAuth, requirePermission("memberships"), membershipsRouter);
app.use("/sales", requireAuth, requirePermission("checkout"), salesRouter);
app.use("/cash", requireAuth, requirePermission("checkout"), cashRouter);
app.use("/financial", requireAuth, requirePermission("financial"), financialRouter);
app.use("/management", requireAuth, managementRouter);

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
  const technicalMessage = error instanceof Error ? error.message : String(error);
  if (technicalMessage.includes("EMAXCONNSESSION") || technicalMessage.includes("max clients reached")) {
    console.error("DATABASE_CONNECTION_LIMIT", { message: technicalMessage });
    return res.status(503).json({
      code: "DATABASE_BUSY",
      message: "O banco está temporariamente ocupado. Aguarde alguns segundos e tente novamente."
    });
  }
  console.error(error);
  return res.status(500).json({ message: "Erro interno" });
});
