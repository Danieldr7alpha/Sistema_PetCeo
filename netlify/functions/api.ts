import express from "express";
import serverless from "serverless-http";
import { app } from "../../apps/api/src/server.js";

const netlifyApp = express();
netlifyApp.use("/api", app);

export const handler = serverless(netlifyApp);
