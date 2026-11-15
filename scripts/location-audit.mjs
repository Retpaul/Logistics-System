// Read-only audit. Prints counts, never addresses, credentials or precise device coordinates.
import "dotenv/config";
import pg from "pg";
const c=new pg.Client({connectionString:process.env.DATABASE_URL});
await c.connect();
try{
  const addresses=await c.query(`SELECT count(*)::int AS orders_with_berlin_or_germany_text FROM "Order" WHERE "pickupAddress" ~* '(berlin|germany)' OR "deliveryAddress" ~* '(berlin|germany)'`);
  const migration=await c.query(`SELECT migration_name,finished_at IS NOT NULL AS applied FROM "_prisma_migrations" WHERE migration_name IN ('20261112000300_phase_two','20261112000500_real_locations') ORDER BY migration_name`);
  console.log(JSON.stringify({addressAudit:addresses.rows[0],migrationState:migration.rows},null,2));
}finally{await c.end();}
