import { createApp } from "./app.js";
import { config } from "./config/index.js";
import { checkDatabase, prisma } from "./startup/db.js";
import { attachRealtime } from "./startup/realtime.js";

const server = createApp().listen(config.port, () => {
  console.log(`Bike Dispatch listening on port ${config.port}`);
  void checkDatabase().catch(() => console.error("Database unavailable; check DATABASE_URL and PostgreSQL"));
});
const realtime = attachRealtime(server);

async function shutdown() {
  realtime.disconnectSockets(true);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
