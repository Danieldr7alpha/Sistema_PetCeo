import express from "express";
import serverless from "serverless-http";
import { app } from "../../apps/api/src/server.js";

// Keep the function bundle aligned with the generated Prisma client on deploys.

const netlifyApp = express();
netlifyApp.use("/api", app);

export const handler = serverless(netlifyApp);
