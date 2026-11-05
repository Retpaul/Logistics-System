import express from "express";
import cors from "cors";
import { config } from "./config/index.js";
import { checkDatabase, prisma } from "./startup/db.js";

export const app = express();
app.use(cors({ origin: config.clientUrl }));
app.use(express.json({ limit: "1mb" }));
app.get(`${config.apiVersion}/health`, (_req, res) => {
  res.json({ status: "ok" });
});
app.get(`${config.apiVersion}/ready`, async (_req, res) => {
  try {
    await checkDatabase();
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});

const server = app.listen(config.port, () => {
  console.log(`Bike Dispatch listening on port ${config.port}`);
  void checkDatabase().catch(() => console.error("Database unavailable; check DATABASE_URL and PostgreSQL"));
});

async function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
