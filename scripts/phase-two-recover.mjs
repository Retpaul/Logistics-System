// Recover only the partial local migration after an operator resolves active assignments.
// Never alters an order, rider assignment or event. Refuses to run while conflicts remain.
import "dotenv/config";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import pg from "pg";
const migration="20261112000300_phase_two";
const c=new pg.Client({connectionString:process.env.DATABASE_URL});
await c.connect();
try {
  const conflict=await c.query(`SELECT 1 FROM "Order" WHERE "riderId" IS NOT NULL AND status IN ('ASSIGNED','PICKED_UP','IN_TRANSIT') GROUP BY "riderId" HAVING count(*)>1 LIMIT 1`);
  assert.equal(conflict.rowCount,0,"Resolve duplicate active assignments first. No records have been changed.");
  const failed=await c.query('SELECT 1 FROM "_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NULL AND rolled_back_at IS NULL',[migration]);
  assert.equal(failed.rowCount,1,"This command is only for the documented partially applied Phase 2 migration");
  // Verify that this is the known partial state; never skip missing earlier migration steps.
  await c.query('SELECT "onboardingStatus","invitationHash","locationAt","bikeSerial" FROM "Rider" LIMIT 0');
  await c.query('SELECT "pickedUpAt","deliveredAt","proofFileId","proofRecipient" FROM "Order" LIMIT 0');
  const script=await readFile(new URL(`../prisma/migrations/${migration}/migration.sql`,import.meta.url),'utf8');
  const start=script.indexOf('CREATE UNIQUE INDEX "Order_one_active_per_rider"');
  assert(start>0);
  const tail=script.slice(start).replace(/COMMIT;\s*$/,'').replace('CREATE UNIQUE INDEX "Order_one_active_per_rider"','CREATE UNIQUE INDEX IF NOT EXISTS "Order_one_active_per_rider"').replace('CREATE TABLE "StoredFile"','CREATE TABLE IF NOT EXISTS "StoredFile"').replace('CREATE INDEX "StoredFile_tenantId_userId_purpose_idx"','CREATE INDEX IF NOT EXISTS "StoredFile_tenantId_userId_purpose_idx"');
  await c.query('BEGIN');
  try{await c.query(tail);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}
  try{
    const cli=fileURLToPath(new URL('../node_modules/prisma/build/index.js',import.meta.url));
    const cwd=fileURLToPath(new URL('../',import.meta.url));
    execFileSync(process.execPath,[cli,'migrate','resolve','--applied',migration],{cwd,env:process.env,stdio:'pipe'});
    execFileSync(process.execPath,[cli,'migrate','deploy'],{cwd,env:process.env,stdio:'pipe'});
  }catch{throw new Error('Schema recovery completed, but migration bookkeeping/deploy failed; inspect Prisma status without exposing credentials');}
  console.log('Recovered Phase 2 schema and applied remaining migrations. No orders, assignments or events were changed.');
}catch(error){console.error(error instanceof assert.AssertionError?error.message:'Recovery failed; no order data was modified. Inspect migration state.');process.exitCode=1;}
finally{await c.end();}
