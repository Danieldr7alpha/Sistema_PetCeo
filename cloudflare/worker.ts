import { httpServerHandler } from "cloudflare:node";
import express from "express";

import { app } from "../apps/api/src/server.js";

const cloudflareApp = express();
cloudflareApp.use(express.json());
cloudflareApp.get("/api/_edge-health", (_req, res) => {
  res.json({ status: "ok", runtime: "cloudflare-workers" });
});
cloudflareApp.use("/api", app);
cloudflareApp.listen(3002);

const apiHandler = httpServerHandler({ port: 3002 });

export default {
  fetch(request: Request, env: { HYPERDRIVE: Hyperdrive }, ctx: ExecutionContext) {
    process.env.DATABASE_URL = env.HYPERDRIVE.connectionString;
    return apiHandler.fetch(request, env, ctx);
  }
};
