// Loads sql/perf/seed.sql into DATABASE_URL. DEVELOPMENT / TEST DATABASES ONLY.
// Usage: npm run perf:seed [-- --reset]
//   --reset  truncates every application table first (destroys all data in the target DB).
import "dotenv/config";
import { readFile } from "node:fs/promises";
import pg from "pg";

const reset = process.argv.includes("--reset");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const target = new URL(url);
console.log(`Target: ${target.hostname}:${target.port || 5432}${target.pathname} (credentials hidden)`);

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM "Tenant"`);
  if (rows[0].n > 0 && !reset) {
    console.error(`Refusing to seed: "Tenant" already has ${rows[0].n} rows. Re-run with --reset on a disposable database.`);
    process.exitCode = 1;
  } else {
    if (reset) {
      console.log("Truncating application tables...");
      await client.query(`TRUNCATE "QrScan","TrackingPoint","OrderEvent","Payment","Order","QrCode","Customer","Bike","Rider","User","Tenant"`);
    }
    const sql = await readFile(new URL("../../sql/perf/seed.sql", import.meta.url), "utf8");
    const started = performance.now();
    console.log("Seeding (several minutes on a laptop)...");
    await client.query(sql);
    console.log(`Seeded in ${((performance.now() - started) / 1000).toFixed(1)} s. Running VACUUM ANALYZE...`);
    await client.query("VACUUM ANALYZE");
    const counts = await client.query(`
      SELECT relname AS table, n_live_tup::bigint AS rows
      FROM pg_stat_user_tables WHERE schemaname = 'public' AND relname <> '_prisma_migrations'
      ORDER BY n_live_tup DESC`);
    console.table(counts.rows);
  }
} finally {
  await client.end();
}
