import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { config } from "./config/index.js";
import { checkDatabase } from "./startup/db.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import { authRouter, ordersRouter, publicRouter, tenantRouter } from "./routes/index.js";

/** Builds the Express app without listening, so tests can drive it with supertest. */
export function createApp() {
  const app = express();
  const api = config.apiVersion;

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(cors({ origin: config.clientUrl, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.get(`${api}/health`, (_req, res) => {
    res.json({ status: "ok" });
  });
  app.get(`${api}/ready`, async (_req, res) => {
    try {
      await checkDatabase();
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });

  app.use(`${api}/auth`, authRouter);
  app.use(`${api}/tenant`, tenantRouter);
  app.use(`${api}/orders`, ordersRouter);
  app.use(`${api}/public`, publicRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
