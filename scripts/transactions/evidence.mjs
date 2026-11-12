import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

// No application query ever uses the source database. Only connection credentials are reused.
const source = process.env.TRANSACTION_ADMIN_URL ?? process.env.DATABASE_URL;
assert(source, "Set DATABASE_URL or TRANSACTION_ADMIN_URL with CREATE DATABASE permission");
const name = `bike_dispatch_tx_${Date.now()}_${randomUUID().slice(0, 8)}`;
assert(/^bike_dispatch_tx_[0-9]+_[a-f0-9]{8}$/.test(name));
const target = new URL(source);
target.pathname = `/${name}`;
const adminUrl = new URL(source);
adminUrl.pathname = "/postgres";
const admin = new pg.Client({ connectionString: adminUrl.toString() });
const clients = [];
const lines = [`Captured at: ${new Date().toISOString()}`, `Disposable database: ${name}`];
const log = text => { lines.push(text); console.log(text); };
async function connect(label) {
  const client = new pg.Client({ connectionString: target.toString(), application_name: `tx-evidence-${label}` });
  await client.connect();
  client.evidenceLabel = label;
  clients.push(client);
  await client.query("SET statement_timeout='10s'");
  await client.query("SET lock_timeout='5s'");
  return client;
}
async function sql(client, text, params = []) {
  log(`[${client.evidenceLabel}] SQL: ${text}\nParameters: ${JSON.stringify(params)}`);
  const r = await client.query(text, params);
  log(`[${client.evidenceLabel}] Output: ${JSON.stringify({ command: r.command, rowCount: r.rowCount, rows: r.rows })}`);
  return r;
}
let created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  log("Created isolated database; source database receives no application queries.");
  try {
    execFileSync(process.execPath, [fileURLToPath(new URL("../../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "deploy"], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)), env: { ...process.env, DATABASE_URL: target.toString() }, stdio: "pipe",
    });
  } catch { throw new Error("Disposable database migration failed; subprocess output suppressed to protect credentials"); }
  log("Applied committed Prisma migrations.");
  const a = await connect("A"), b = await connect("B"), observer = await connect("observer");
  await sql(observer, "SELECT version(), current_setting('default_transaction_isolation') AS default_isolation");
  const tenant = randomUUID(), customer = randomUUID(), order = randomUUID();
  await sql(a, 'INSERT INTO "Tenant" (id,name,subdomain) VALUES ($1,$2,$3)', [tenant, "Synthetic Transaction Tenant", `tx-${randomUUID()}`]);
  const addCustomer = id => sql(a, 'INSERT INTO "Customer" (id,"tenantId",name,phone) VALUES ($1,$2,$3,$4)', [id, tenant, "Synthetic Customer", "+2340000000000"]);
  const addOrder = (id, customerId) => sql(a, 'INSERT INTO "Order" (id,"tenantId","customerId","trackingCode","pickupAddress","deliveryAddress","recipientName","recipientPhone","deliveryFee","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,2500,now())', [id, tenant, customerId, randomUUID(), "Synthetic pickup", "Synthetic destination", "Synthetic Recipient", "+2340000000001"]);
  const addEvent = (id, status) => sql(a, 'INSERT INTO "OrderEvent" (id,"orderId",status) VALUES ($1,$2,$3)', [randomUUID(), id, status]);
  const counts = (customerId, orderId) => sql(observer, 'SELECT (SELECT count(*)::int FROM "Customer" WHERE id=$1) AS customers,(SELECT count(*)::int FROM "Order" WHERE id=$2) AS orders,(SELECT count(*)::int FROM "OrderEvent" WHERE "orderId"=$2) AS events', [customerId, orderId]);

  log("\nCASE 1: COMMIT");
  await sql(a, "BEGIN ISOLATION LEVEL READ COMMITTED");
  await addCustomer(customer);
  await addOrder(order, customer);
  await addEvent(order, "PENDING");
  assert.deepEqual((await counts(customer, order)).rows[0], { customers: 0, orders: 0, events: 0 });
  await sql(a, "COMMIT");
  assert.deepEqual((await counts(customer, order)).rows[0], { customers: 1, orders: 1, events: 1 });
  log("PASS commit: all three records persisted, verified from an independent connection.");

  log("\nCASE 2: ROLLBACK");
  const rollbackCustomer = randomUUID(), rollbackOrder = randomUUID();
  await sql(a, "BEGIN");
  await addCustomer(rollbackCustomer);
  await addOrder(rollbackOrder, rollbackCustomer);
  await addEvent(rollbackOrder, "PENDING");
  try {
    await sql(a, 'UPDATE "Order" SET "deliveryFee"=-1 WHERE id=$1', [rollbackOrder]);
    assert.fail("Expected constraint failure");
  } catch (error) {
    assert.equal(error.code, "23514");
    assert.equal(error.constraint, "Order_fee_nonnegative");
    log(`Expected PostgreSQL error: ${error.code}, constraint: ${error.constraint}`);
  }
  await sql(a, "ROLLBACK");
  assert.deepEqual((await counts(rollbackCustomer, rollbackOrder)).rows[0], { customers: 0, orders: 0, events: 0 });
  log("PASS rollback: customer, order and event all absent.");

  log("\nCASE 3: READ COMMITTED isolation");
  await sql(a, "BEGIN ISOLATION LEVEL READ COMMITTED");
  await sql(b, "BEGIN ISOLATION LEVEL READ COMMITTED");
  assert.equal((await sql(b, "SHOW transaction_isolation")).rows[0].transaction_isolation, "read committed");
  await sql(a, 'UPDATE "Order" SET "deliveryFee"=3000 WHERE id=$1', [order]);
  const read = () => sql(b, 'SELECT "deliveryFee"::text AS fee FROM "Order" WHERE id=$1', [order]);
  assert.equal((await read()).rows[0].fee, "2500.00");
  await sql(a, "COMMIT");
  assert.equal((await read()).rows[0].fee, "3000.00");
  await sql(b, "COMMIT");
  log("PASS isolation: no dirty read; next statement in the same reader transaction sees the committed change.");

  log("\nCASE 4: concurrent optimistic status update");
  await sql(a, "BEGIN ISOLATION LEVEL READ COMMITTED");
  await sql(b, "BEGIN ISOLATION LEVEL READ COMMITTED");
  for (const client of [a, b]) assert.equal((await sql(client, 'SELECT status FROM "Order" WHERE id=$1', [order])).rows[0].status, "PENDING");
  const update = 'UPDATE "Order" SET status=\'CANCELLED\' WHERE id=$1 AND "tenantId"=$2 AND status=\'PENDING\' RETURNING status';
  assert.equal((await sql(a, update, [order, tenant])).rowCount, 1);
  const pid = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  const competing = sql(b, update, [order, tenant]).then(result => ({ result }), error => ({ error }));
  let blocked = false;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const row = (await observer.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0];
    if (row?.wait_event_type === "Lock") { blocked = true; break; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert(blocked, "Competing writer must actually wait on a database lock");
  log("Observed B wait_event_type=Lock while A holds the order row.");
  await addEvent(order, "CANCELLED");
  await sql(a, "COMMIT");
  const outcome = await competing;
  if (outcome.error) throw outcome.error;
  assert.equal(outcome.result.rowCount, 0);
  await sql(b, "ROLLBACK");
  log("Conflict: B affected zero rows. The application maps this condition to HTTP 409 CONFLICT.");
  const final = await sql(observer, 'SELECT status,(SELECT count(*)::int FROM "OrderEvent" WHERE "orderId"=$1 AND status=\'CANCELLED\') AS cancellation_events FROM "Order" WHERE id=$1', [order]);
  assert.deepEqual(final.rows[0], { status: "CANCELLED", cancellation_events: 1 });
  log("PASS concurrency: one winner, one conflict, exactly one cancellation event.");
} catch (error) {
  log(`FAIL: ${error.code ?? error.name ?? "Error"}${error.name === "AssertionError" ? `: ${error.message}` : " (check database access and migration prerequisites)"}`);
  process.exitCode = 1;
} finally {
  await Promise.all(clients.map(async client => { try { await client.query("ROLLBACK"); } catch {} await client.end(); }));
  if (created) {
    try { await admin.query(`DROP DATABASE "${name}"`); log("Cleanup: dropped only the disposable database created by this invocation."); }
    catch { log(`Cleanup failed: remove disposable database ${name} manually.`); process.exitCode = 1; }
  }
  await admin.end();
  const out = new URL("../../docs/transactions/", import.meta.url);
  await mkdir(out, { recursive: true });
  await writeFile(new URL("output.txt", out), `${lines.join("\n")}\n`);
}
