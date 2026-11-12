// Runs every query in sql/perf/queries.sql against DATABASE_URL and records evidence:
// result sample, EXPLAIN (ANALYZE, BUFFERS) plan, warm-cache latency percentiles,
// index inventory and write overhead. Read-only except the write test, which rolls back.
//
// Usage: npm run perf:bench -- --label baseline   (or --label optimised)
//        optional: --runs 50 --warmup 5
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import pg from "pg";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const label = arg("label");
if (!label) throw new Error("--label is required (e.g. baseline, optimised)");
const runs = Number(arg("runs", 50));
const warmup = Number(arg("warmup", 5));
const outDir = new URL(`../../docs/performance/${label}/`, import.meta.url);
await mkdir(new URL("plans/", outDir), { recursive: true });

// ---------------------------------------------------------------- parse queries.sql
const source = await readFile(new URL("../../sql/perf/queries.sql", import.meta.url), "utf8");
const queries = source.split(/^-- @id /m).slice(1).map((block) => {
  const [idLine, ...rest] = block.split(/\r?\n/);
  const meta = { id: idLine.trim() };
  const sqlLines = [];
  for (const line of rest) {
    const m = line.match(/^-- @(\w+)\s+(.*)$/);
    if (m) meta[m[1]] = m[2].trim();
    else sqlLines.push(line);
  }
  meta.sql = sqlLines.join("\n").replace(/--\s*=+.*$/gm, "").trim().replace(/;\s*$/, "");
  return meta;
});

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const ms = (start) => Number(process.hrtime.bigint() - start) / 1e6;
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
const round = (n) => Math.round(n * 1000) / 1000;

function summarisePlan(node, acc = { nodes: [], indexes: new Set() }) {
  let desc = node["Node Type"];
  if (node["Index Name"]) { desc += ` on ${node["Index Name"]}`; acc.indexes.add(node["Index Name"]); }
  else if (node["Relation Name"]) desc += ` on ${node["Relation Name"]}`;
  if (node["Sort Method"]) desc += ` (${node["Sort Method"]})`;
  acc.nodes.push(desc);
  for (const child of node.Plans ?? []) summarisePlan(child, acc);
  return acc;
}

try {
  try { await client.query("SELECT pg_stat_reset()"); } catch { /* needs privileges; optional */ }
  const settings = (await client.query(`
    SELECT name, current_setting(name) AS setting FROM pg_settings
    WHERE name IN ('server_version','shared_buffers','work_mem','effective_cache_size','random_page_cost','jit','max_parallel_workers_per_gather')
    ORDER BY name`)).rows;

  const results = [];
  for (const q of queries) {
    const first = await client.query(q.sql);
    for (let i = 0; i < warmup; i++) await client.query(q.sql);
    const times = [];
    for (let i = 0; i < runs; i++) {
      const start = process.hrtime.bigint();
      await client.query(q.sql);
      times.push(ms(start));
    }
    times.sort((a, b) => a - b);

    const text = (await client.query(`EXPLAIN (ANALYZE, BUFFERS) ${q.sql}`)).rows.map((r) => r["QUERY PLAN"]).join("\n");
    const json = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q.sql}`)).rows[0]["QUERY PLAN"][0];
    const plan = summarisePlan(json.Plan);
    const header = `-- ${q.id}: ${q.title}\n-- Endpoint: ${q.endpoint}\n-- Label: ${label}\n\n${q.sql};\n\n`;
    await writeFile(new URL(`plans/${q.id}.txt`, outDir), `${header}${text}\n`);

    const r = {
      id: q.id, title: q.title, endpoint: q.endpoint,
      rows: first.rowCount,
      sample: first.rows.slice(0, 5),
      planningMs: round(json["Planning Time"]),
      executionMs: round(json["Execution Time"]),
      sharedHit: json.Plan["Shared Hit Blocks"], sharedRead: json.Plan["Shared Read Blocks"],
      p50: round(pct(times, 50)), p95: round(pct(times, 95)), min: round(times[0]), max: round(times.at(-1)),
      planNodes: plan.nodes, indexesUsed: [...plan.indexes],
    };
    results.push(r);
    console.log(`${q.id.padEnd(4)} p50 ${r.p50.toFixed(2).padStart(8)} ms  p95 ${r.p95.toFixed(2).padStart(8)} ms  rows ${String(r.rows).padStart(4)}  ${plan.nodes.slice(0, 3).join(" > ")}`);
  }

  // ------------------------------------------------------------ write overhead
  // Inserts 10,000 orders for the large tenant inside a transaction, then rolls back.
  const writeTimes = [];
  for (let i = 0; i < 5; i++) {
    await client.query("BEGIN");
    const start = process.hrtime.bigint();
    await client.query(`
      INSERT INTO "Order" (id, "tenantId", "customerId", "qrCodeId", "trackingCode", "pickupAddress", "deliveryAddress",
                           "recipientName", "recipientPhone", status, "deliveryFee", "createdAt", "updatedAt")
      SELECT gen_random_uuid(), md5('tenant0')::uuid, md5('customer' || (100 * (n % 1000)))::uuid,
             md5('qr' || (100 * (n % 10)))::uuid, gen_random_uuid()::text, '1 Admiralty Way, Lekki', '2 Allen Avenue, Ikeja',
             'Write Test', '+23489' || lpad(n::text, 8, '0'), 'PENDING', 2500, now(), now()
      FROM generate_series(1, 10000) n`);
    writeTimes.push(ms(start));
    await client.query("ROLLBACK");
  }
  writeTimes.sort((a, b) => a - b);
  const write = { rows: 10000, medianMs: round(pct(writeTimes, 50)), perRowUs: round((pct(writeTimes, 50) * 1000) / 10000) };
  console.log(`Write test: 10,000 order inserts median ${write.medianMs} ms (${write.perRowUs} µs/row)`);

  // ------------------------------------------------------------ inventory
  try { await client.query("SELECT pg_stat_force_next_flush()"); await client.query("SELECT 1"); } catch { /* PG < 15 */ }
  const indexes = (await client.query(`
    SELECT s.relname AS table, s.indexrelname AS index, pg_relation_size(s.indexrelid) AS bytes,
           pg_size_pretty(pg_relation_size(s.indexrelid)) AS size, s.idx_scan AS scans,
           pg_get_indexdef(s.indexrelid) AS definition
    FROM pg_stat_user_indexes s WHERE s.schemaname = 'public' AND s.relname <> '_prisma_migrations'
    ORDER BY s.relname, s.indexrelname`)).rows;
  const tables = (await client.query(`
    SELECT relname AS table, n_live_tup::bigint AS rows,
           pg_size_pretty(pg_table_size(relid)) AS heap, pg_size_pretty(pg_indexes_size(relid)) AS indexes,
           pg_indexes_size(relid) AS index_bytes
    FROM pg_stat_user_tables WHERE schemaname = 'public' AND relname <> '_prisma_migrations'
    ORDER BY n_live_tup DESC`)).rows;

  const report = { label, capturedAt: new Date().toISOString(), runs, warmup, settings, results, write, indexes, tables };
  await writeFile(new URL("results.json", outDir), JSON.stringify(report, null, 2));
  console.log(`Wrote docs/performance/${label}/results.json and plans/`);
} finally {
  await client.end();
}
