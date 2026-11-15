import "dotenv/config";
import pg from "pg";
const c=new pg.Client({connectionString:process.env.DATABASE_URL});
await c.connect();
try {
  const counts=await c.query(`SELECT count(*)::int riders,coalesce(sum(n-1),0)::int extra_assignments FROM
    (SELECT count(*)::int n FROM "Order" WHERE "riderId" IS NOT NULL AND status IN ('ASSIGNED','PICKED_UP','IN_TRANSIT') GROUP BY "riderId" HAVING count(*)>1) x`);
  const statuses=await c.query(`SELECT status,count(*)::int orders FROM "Order" WHERE "riderId" IN
    (SELECT "riderId" FROM "Order" WHERE "riderId" IS NOT NULL AND status IN ('ASSIGNED','PICKED_UP','IN_TRANSIT') GROUP BY "riderId" HAVING count(*)>1)
    AND status IN ('ASSIGNED','PICKED_UP','IN_TRANSIT') GROUP BY status`);
  console.log(JSON.stringify({conflicts:counts.rows[0],statuses:statuses.rows},null,2));
}finally{await c.end();}
