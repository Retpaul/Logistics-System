// Creates and migrates the throwaway bike_dispatch_test database, then empties it.
import { execSync } from "node:child_process";
import pg from "pg";
import { testDatabaseUrl } from "./testDb.js";

export default async function setup() {
  const url = testDatabaseUrl();
  const admin = new URL(url);
  admin.pathname = "/postgres";

  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = 'bike_dispatch_test'");
  if (!rowCount) await client.query("CREATE DATABASE bike_dispatch_test");
  await client.end();

  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await db.query(`TRUNCATE "RefreshToken","QrScan","TrackingPoint","OrderEvent","Payment","Order","QrCode",
                  "Customer","Bike","Rider","User","Tenant"`);
  await db.end();
}
