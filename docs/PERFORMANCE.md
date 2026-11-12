# Query performance: SQL, results, execution plans and indexing evidence

This document records how the Bike Dispatch API's main database queries perform at the PRD's target scale, what was changed to make them fast, and what that change costs. All numbers come from real runs. Raw evidence is committed alongside:

| Evidence | Location |
| --- | --- |
| The 15 SQL queries (paste-able into psql / pgAdmin) | [`sql/perf/queries.sql`](../sql/perf/queries.sql) |
| Synthetic dataset generator | [`sql/perf/seed.sql`](../sql/perf/seed.sql) |
| Index-set switches used for before/after | [`sql/perf/indexes_baseline.sql`](../sql/perf/indexes_baseline.sql), [`sql/perf/indexes_optimised.sql`](../sql/perf/indexes_optimised.sql) |
| Full `EXPLAIN (ANALYZE, BUFFERS)` plan per query, before / after (PostgreSQL 18) | [`docs/performance/baseline/plans/`](performance/baseline/plans/), [`docs/performance/optimised/plans/`](performance/optimised/plans/) |
| Timings, result samples, index inventory (machine-readable) | `docs/performance/{baseline,optimised}/results.json` |
| Generated before/after table (PostgreSQL 18) | [`docs/performance/comparison.md`](performance/comparison.md) |
| Cross-check run on PostgreSQL 17 with tuned memory | [`docs/performance/pg17/`](performance/pg17/) |
| The index change | [`prisma/migrations/20261112000100_query_performance_indexes`](../prisma/migrations/20261112000100_query_performance_indexes/migration.sql) |

## 1. Summary

Targets from the PRD: **NFR-PE-003** API response < 300 ms for 95% of requests; **NFR-SC-002** 1 million orders without performance degradation.

On the project's PostgreSQL 18 server with its install defaults, 2 of 15 queries missed the 300 ms p95 budget *at the database alone*, before any network, Prisma or Express overhead, and 2 more used most of it. One migration (2 new indexes, 3 replaced) brings 14 of the 15 under 10 ms p95. The remaining one, the rider leaderboard, improves 5× but still misses the target on default settings. §6.1 shows a measured fix that brings it to 26 ms.

| Query | Endpoint | p95 before | p95 after | Speed-up (p50) |
| --- | --- | ---: | ---: | ---: |
| Q10 Rider leaderboard (30 days) | `GET /analytics/riders` | **2,418 ms** | **460 ms** ✗ | 6.1× |
| Q11 QR analytics (30 days) | `GET /qr-codes/analytics` | **1,034 ms** | 9.6 ms | 110× |
| Q13 Search by recipient phone | `GET /orders?recipientPhone=` | **271 ms** | 0.72 ms | 561× |
| Q03 Newest 25 orders | `GET /orders` | **232 ms** | 0.95 ms | 320× |
| Q06 Orders filtered by rider | `GET /orders?riderId=` | 14 ms | 0.68 ms | 24× |
| Q04 Orders "Today" | `GET /orders?date=today` | 4.7 ms | 1.2 ms | 3.8× |
| 9 other queries (tracking page, order detail, fleet map, KPIs, trend, lookups) | | ≤ 7.6 ms | ≤ 9.6 ms | no change needed |

Q03 and Q13 were under budget on their own but used 77–90% of it before any application overhead, and both grow linearly with the tenant's order count.

Cost: `Order` indexes grow from 218 MB to 377 MB, and each order insert writes ~19% more WAL. See §6.

## 2. Method

**Environment (primary).** PostgreSQL **18.6** (Windows x64), the project's local server, with **install defaults**: `shared_buffers = 128MB`, `work_mem = 4MB`, `effective_cache_size = 4GB`, `random_page_cost = 4`, `io_method = worker`, `max_parallel_workers_per_gather = 2`, JIT on. Hardware: Intel Core i7-8650U (4 cores / 8 threads), 16 GB RAM, local SSD. The benchmark runs in a separate `bike_dispatch_perf` database so the development database stays clean.

**Environment (cross-check).** The same benchmark was first run on a throwaway PostgreSQL **17.5** cluster with `shared_buffers = 256MB` and `random_page_cost = 1.1`. Results are in `docs/performance/pg17/` and summarised in §6.3.

**Procedure** (`scripts/perf/bench.mjs`):

1. Schema from the committed Prisma migrations (`prisma migrate deploy`), then `npm run perf:seed`, then `VACUUM ANALYZE`.
2. **Baseline run** after `sql/perf/indexes_baseline.sql` (the original index set). For each query: execute once to capture the result, 5 warm-up runs, then 50 timed runs (client round trip over localhost via `pg`). Then `EXPLAIN (ANALYZE, BUFFERS)` once in text (committed) and once as JSON (for execution time and buffer counts).
3. `sql/perf/indexes_optimised.sql` (identical to the migration; `prisma migrate diff` reports no drift afterwards), then the **optimised run**.
4. `pg_stat_reset()` before each run so per-index scan counts reflect only the benchmark.

**What the numbers mean.** p50/p95 are warm-cache latencies of the SQL statement alone; an API request adds Prisma, serialisation and network time on top. *Buffers* is the number of 8 KB pages the query touched (shared hit + read). It is the most machine-independent measure here and the best predictor of behaviour on other hardware.

**Worst case on purpose.** Tenants are skewed: one tenant ("Lagos Express") owns 21.5% of all orders (214,767). Every tenant-scoped query runs against that tenant. Smaller tenants are faster.

## 3. Dataset

Generated deterministically by `sql/perf/seed.sql` (fixed `setseed`, md5-derived UUIDs), so the PG17 and PG18 runs used identical rows. Seeding took 10.6 minutes on PG18 with all FKs and CHECK constraints enforced, so every row is valid against the real schema.

| Table | Rows | Heap | Notes |
| --- | ---: | ---: | --- |
| Order | 1,000,000 | 297 MB | 365 days of history; 92% DELIVERED, 8% CANCELLED; 283 active (last 3 h) |
| OrderEvent | ~4.8M | 352 MB | one row per lifecycle step |
| TrackingPoint | ~3.7M | 327 MB | 4-point trail per historical delivery; 10-second samples for live orders |
| QrScan | 2,500,000 | 163 MB | ~25% scan-to-order conversion |
| Payment | 1,030,303 | 124 MB | every 33rd order has a FAILED attempt then a retry |
| Customer | 100,000 | 10 MB | 1,000 per tenant |
| Tenant / User / Rider / Bike / QrCode | 100 / 2,200 / 2,000 / 2,000 / 1,000 | < 1 MB each | 20 riders and 10 QR codes per tenant |

## 4. Query catalogue

Each query is the SQL behind one API endpoint and user story. Full SQL is in `sql/perf/queries.sql`; full plans are in `docs/performance/*/plans/Qxx.txt`. Plans below are from PostgreSQL 18.

| ID | Purpose (user story) | Rows | Plan before | Plan after |
| --- | --- | ---: | --- | --- |
| Q01 | Public tracking page + latest GPS point (US-09) | 1 | Index Scan `Order_trackingCode_key` + LATERAL backward scan `TrackingPoint_orderId_recordedAt_idx` | unchanged |
| Q02 | Order detail with timeline (`ordersRepository.findById`) | 5 | PK lookup + `OrderEvent` index | PK lookup + `OrderEvent` index-only scan |
| Q03 | Orders page, newest 25 (US-17) | 25 | Bitmap scan of **all 214,767** tenant orders + top-N sort | Index Scan Backward `Order_tenantId_createdAt_idx`, stops at 25 |
| Q04 | Orders "Today" (US-17) | 25 | **skip scan** over `Order_tenantId_status_createdAt_idx` (3 index searches) + sort | range scan `Order_tenantId_createdAt_idx` |
| Q05 | Orders with status = DELIVERED (US-17) | 25 | Index Scan `Order_tenantId_status_createdAt_idx` | Index Scan `Order_tenantId_createdAt_idx`¹ |
| Q06 | Orders for one rider (US-17) | 25 | fetch rider's 10,849 orders + sort | Index Scan Backward `Order_tenantId_riderId_createdAt_idx` |
| Q07 | Fleet map active orders (US-16) | 65 | `Order_tenantId_status_createdAt_idx` | unchanged |
| Q08 | Today's KPIs: orders, deliveries, revenue, AOV (US-18) | 1 | skip scan on status index, nested loop to `Payment_orderId_idx` | unchanged (same cost) |
| Q09 | Orders per day, last 7 days (US-18) | 8 | skip scan on status index | unchanged (same cost) |
| Q10 | Rider leaderboard, 30 days (US-18) | 10 | **Parallel Seq Scan of all 4.8M `OrderEvent` rows** + per-rider scans | 2 × 16,351 index-only `OrderEvent` lookups, 0 heap fetches |
| Q11 | QR scans / orders / conversion, 30 days (US-05) | 10 | per QR: fetch ~12,900 orders, discard 11,842 by date | per QR: index-only range of ~1,064 entries |
| Q12 | Find customer by phone (US-07) | 1 | Index Scan `Customer_tenantId_phone_idx` | unchanged |
| Q13 | Find orders by recipient phone (US-17) | 1 | scan of **all 214,767** tenant orders, filter | Index Scan `Order_tenantId_recipientPhone_idx` (4 pages) |
| Q14 | Rider app "My jobs" (US-21) | 7 | `Order_tenantId_status_createdAt_idx` | unchanged |
| Q15 | Live positions of orders on the road (US-16) | 33 | status index + LATERAL `TrackingPoint` backward scan | unchanged |

¹ Q05 switched to the new index because 92% of the tenant's orders are DELIVERED: walking newest-first and filtering finds 25 matches almost immediately (97 pages vs 28, both ~0.6 ms). For a rare status the planner would still use the status index.

### Sample results (PostgreSQL 18, optimised run)

**Q08 dashboard KPIs, today** (Lagos local day, run mid-morning):

| orders_today | delivered_today | revenue_today | avg_order_value |
| ---: | ---: | ---: | ---: |
| 265 | 189 | 784,575.00 | 3,279.34 |

**Q10 rider leaderboard, last 30 days (top 3 of 10):**

| rider | deliveries | avg_minutes (pickup → drop) |
| --- | ---: | ---: |
| Rider 1600 | 859 | 30.6 |
| Rider 900 | 853 | 31.0 |
| Rider 200 | 843 | 30.7 |

**Q11 QR analytics, last 30 days (top 3 of 10):**

| label | campaign | scans | orders | conversion_pct |
| --- | --- | ---: | ---: | ---: |
| QR 600 | Summer2026 | 4,403 | 1,111 | 25.2 |
| QR 800 | (none) | 4,379 | 1,102 | 25.2 |
| QR 400 | Launch | 4,357 | 1,100 | 25.2 |

Q11 counts scans and orders in separate `LATERAL` subqueries. Joining `QrScan` and `Order` directly would produce scans × orders rows per QR code and inflate both counts: a correctness issue, not only a performance one.

**Q01 tracking page:** one row, `IN_TRANSIT`, tenant "Lagos Express", brand colour, and the latest GPS fix taken seconds before the query.

## 5. Indexing changes

### 5.1 Findings from the baseline plans

1. **No index led with `(tenantId, createdAt)`.** The existing `(tenantId, status, createdAt)` index orders rows by date *within each status*, so it cannot return a tenant's newest orders across all statuses. For Q03 PostgreSQL read every one of the tenant's 214,767 orders (36,869 pages) to sort and keep 25:

   ```
   -- Q03 baseline (PostgreSQL 18)
   Limit  (actual time=235.225..249.406 rows=25.00 loops=1)
     Buffers: shared hit=44 read=36825
     ->  Gather Merge  (Workers Launched: 2)
           ->  Sort  Sort Key: "createdAt" DESC  Sort Method: top-N heapsort
                 ->  Parallel Bitmap Heap Scan on "Order" o  (actual rows=71589.00 loops=3)
                       Recheck Cond: ("tenantId" = '7636…44af'::uuid)
                       ->  Bitmap Index Scan on "Order_tenantId_qrCodeId_idx"  (actual rows=214767.00 loops=1)
   Execution Time: 249.443 ms
   ```
   ```
   -- Q03 optimised (PostgreSQL 18)
   Limit  (actual time=0.010..0.025 rows=25.00 loops=1)
     Buffers: shared hit=28
     ->  Index Scan Backward using "Order_tenantId_createdAt_idx" on "Order" o
           Index Cond: ("tenantId" = '7636…44af'::uuid)
   Execution Time: 0.035 ms
   ```
   PostgreSQL 18's new **B-tree skip scan** partly hides this gap for *range* queries: Q04, Q08 and Q09 used the status index efficiently by jumping between status values (`Index Searches: 3` in their plans; 275 pages for Q04 versus 1,936 on PG17). Skip scan cannot produce a single newest-first order across statuses, so Q03 still needed the new index.

2. **Unindexed search column.** Q13 had to filter all of the tenant's orders on `recipientPhone` (36,869 pages → 4 pages after).

3. **FK indexes that stop one column short.** `(tenantId, qrCodeId)` and `(tenantId, riderId)` exist to support the composite foreign keys, but they cannot narrow by date. Q11 fetched ~12,900 orders per QR code to keep ~1,064 (`Rows Removed by Filter: 11842`), and Q06 sorted all 10,849 of a rider's orders to return 25. Adding `createdAt` as a trailing column turns both into ordered range scans; the leading columns still serve the FKs.

4. **Status lookups hitting the heap.** Q10 needs the PICKED_UP and DELIVERED times for each delivered order. With `(orderId, createdAt)` each lookup must visit the table to check `status`. With the default `random_page_cost = 4` the PG18 planner judged 16k such lookups too expensive and **sequentially scanned all 4.8M `OrderEvent` rows instead** (653,294 pages, 2.1 s). `(orderId, status, createdAt)` contains every column the query needs, so lookups become index-only (`Heap Fetches: 0`) and the planner uses them: 144,544 pages, 0.37 s.

### 5.2 The migration

Defined in `prisma/schema.prisma` and generated with `prisma migrate diff`. `migrate diff` reports no drift afterwards. Statements were reordered so each replacement index is built before the one it supersedes is dropped.

| Index | Change | Serves |
| --- | --- | --- |
| `Order(tenantId, createdAt)` | **new** | Q03, Q04 (and Q05) |
| `Order(tenantId, recipientPhone)` | **new** | Q13 |
| `Order(tenantId, riderId, createdAt)` | replaces `(tenantId, riderId)` | Q06 + Rider FK |
| `Order(tenantId, qrCodeId, createdAt)` | replaces `(tenantId, qrCodeId)` | Q11 + QrCode FK |
| `OrderEvent(orderId, status, createdAt)` | replaces `(orderId, createdAt)` | Q10, Q02 + Order FK |

The net index count went up by two. Building the five indexes on 1M orders / 4.8M events took 21 s on PG18, including `VACUUM ANALYZE`.

### 5.3 Deliberately not indexed

- **Partial "active orders" index.** Q07, Q14 and Q15 already run in about 1 ms. Only 283 of 1M orders are active, and `(tenantId, status, createdAt)` isolates them directly. (Prisma 7.10 supports partial indexes behind the `partialIndexes` preview flag; this was tested but not needed.)
- **`Payment` indexes.** Revenue (Q08) is driven from the tenant's orders and joins `Payment` through the existing `Payment_orderId_idx`; there is no tenant-wide scan of payments.
- **Small tables** (`Rider`, `Bike`, `QrCode`, `User`: ≤ 2,200 rows). Sequential or bitmap scans of a few pages are cheaper than maintaining extra indexes.
- **`Order_tenantId_customerId_idx` and `Order_tenantId_bikeId_idx`** recorded 0 scans in the benchmark but are kept: they back the composite foreign keys, so a `RESTRICT` check on deleting a customer or bike doesn't scan `Order`.

## 6. Performance analysis

**Cost of the change** (PostgreSQL 18 sizes):

| Measure | Before | After | Change |
| --- | ---: | ---: | ---: |
| `Order` index size | 218 MB | 377 MB | +159 MB (+73%) |
| `OrderEvent` index size | 371 MB | 413 MB | +42 MB |
| All indexes, all tables | 1,311 MB | 1,511 MB | +200 MB (+15%) |
| WAL written per order insert² | ~966 B | ~1,148 B | +19% |
| WAL written per order-event insert² | ~333 B | ~344 B | ≈ +3% |

² Measured on the PG17 cluster as WAL bytes for 10,000-row inserts with full-page writes temporarily disabled, so the figure counts index maintenance and not checkpoint timing. The index definitions are identical on PG18. Wall-clock insert timings varied by more than 2× between identical runs on this laptop (checkpoints and FK checks dominated), so they are not reported as evidence.

**Why the widened indexes are larger than expected.** The old `(tenantId, riderId)` and `(tenantId, qrCodeId)` indexes were only 7.6 MB and 8.4 MB for 1M rows. With only ~2,000 distinct key pairs, PostgreSQL's B-tree **deduplication** stored each repeated key once. Adding `createdAt` makes every entry unique and disables deduplication, so they grew to 56 MB and 53 MB. For Q11 this was clearly worth it (1,034 ms → 9.6 ms). For Q06 it is a judgement call: the query was 14 ms before, within budget. Reverting that index would save ~48 MB if storage becomes a concern.

**Net assessment.** The order list, search and QR analytics paths went from hundreds of milliseconds and tens of thousands of pages to about 1 ms and tens of pages. Their response time is now governed by the size of the page being returned, not by the size of the tenant. The cost is roughly 1 KB of extra WAL per 5 order inserts and ~200 MB of index at 1M orders. Bike dispatch is read-heavy (dashboards, tracking pages polled every 10 s, rider apps refreshing), so this is a favourable trade.

### 6.1 Remaining hotspot: rider leaderboard (Q10)

Q10 still does two lookups into a 4.8M-row table for each of the ~16k delivered orders in the 30-day window. Even index-only, those lookups touch ~144k pages. The 227 MB `OrderEvent` index does not fit in the default 128 MB `shared_buffers`, so every run still reads ~26k pages from outside the cache (`read=25832`). Three remedies were measured on the same data:

| Q10 variant (optimised indexes; 50 timed runs, PG17 row 30) | p50 | p95 | Meets 300 ms? |
| --- | ---: | ---: | :---: |
| As written, PG18 defaults (128 MB cache) | 333 ms | 442 ms | ✗ |
| Single-probe rewrite (below), PG18 defaults | 456 ms | 482 ms | ✗ |
| As written, PG17 with 256 MB cache, `random_page_cost = 1.1` | 103 ms | 217 ms | ✓ |
| Denormalised `pickedUpAt` / `deliveredAt` on `Order`, PG18 defaults³ | **19 ms** | **26 ms** | ✓ |

³ Experiment on the perf database only: the two columns were added, backfilled from `OrderEvent`, measured against the same 50-run protocol (identical results to the original query, 17,435 pages, all cache hits), then dropped again. The schema and migrations in this repository do not include them.

The single-probe rewrite merges the two lookups into one conditional aggregate and returns identical results with 38% fewer page touches (89,524). It helps when the index is cached (on PG17 it cut p95 from 217 ms to 122 ms), but on a cache-starved server it is still I/O-bound:

```sql
SELECT u."firstName" || ' ' || u."lastName" AS rider, count(*) AS deliveries,
       round(avg(extract(epoch FROM ev.dropped - ev.picked)) / 60, 1) AS avg_minutes
FROM "Order" o
CROSS JOIN LATERAL (
  SELECT max(e."createdAt") FILTER (WHERE e.status = 'PICKED_UP') AS picked,
         max(e."createdAt") FILTER (WHERE e.status = 'DELIVERED') AS dropped
  FROM "OrderEvent" e
  WHERE e."orderId" = o.id AND e.status IN ('PICKED_UP', 'DELIVERED')
) ev
JOIN "Rider" r ON r."tenantId" = o."tenantId" AND r.id = o."riderId"
JOIN "User"  u ON u."tenantId" = r."tenantId" AND u.id = r."userId"
WHERE o."tenantId" = $1 AND o.status = 'DELIVERED' AND o."createdAt" >= now() - interval '30 days'
  AND ev.picked IS NOT NULL AND ev.dropped IS NOT NULL
GROUP BY u.id, u."firstName", u."lastName"
ORDER BY deliveries DESC
LIMIT 10;
```

**Recommendation:** store `pickedUpAt` and `deliveredAt` on `Order`. This is the only option measured here that meets the target on default settings, and it is 17× faster than the indexed query. It follows the same pattern the schema already uses for `Order.status`, a cached copy of the latest `OrderEvent`: the service that records a PICKED_UP or DELIVERED event sets the matching column in the same Prisma transaction, so `OrderEvent` stays the audit history and `Order` carries what the dashboards read. The leaderboard then reads only the ~16k matching `Order` rows through the existing `(tenantId, status, createdAt)` index. Until that schema change lands, increase `shared_buffers` (§6.2) so the `OrderEvent` index stays cached.

### 6.2 Further recommendations

1. **Tune the server, not just the schema.** The PG18 install defaults are sized for a small machine: `shared_buffers = 128MB` and `random_page_cost = 4` (a spinning-disk value). On an SSD with 16 GB RAM, `shared_buffers` of about 25% of RAM and `random_page_cost = 1.1` are standard; with those settings the PG17 run kept every page of the query working set in cache. Managed PostgreSQL services usually set these for you; check before deploying.
2. **Production rollout.** A plain `CREATE INDEX` blocks writes to the table while it builds. On a live database, create the indexes with `CREATE INDEX CONCURRENTLY` under the same names, then mark the migration applied with `prisma migrate resolve --applied 20261112000100_query_performance_indexes`.
3. **Time-ordered IDs.** IDs are random UUIDv4 (`@default(uuid())`), so a day's orders are scattered across the whole primary key and `OrderEvent` index; this is why Q10's lookups are random I/O. Prisma supports `@default(uuid(7))`, and PostgreSQL 18 adds a native `uuidv7()`. Time-ordered keys keep recent rows physically close. Consider switching before production data accumulates.
4. **TrackingPoint growth.** At the PRD's 10-second GPS cadence (NFR-PE-002), a 30-minute delivery produces ~180 points, about 45× the downsampled history used here. Plan a retention job (downsample delivered orders) or monthly range partitioning on `recordedAt`.
5. **Row-level security** (NFR-SE-003, not yet configured). RLS policies add a `tenantId = current_setting(...)` predicate. Every index above already leads with `tenantId`, so RLS should not change these plans; re-run the benchmark once it is enabled.
6. **Monitor in production.** Enable `pg_stat_statements` and review the top statements by total time. Use `pg_stat_user_indexes.idx_scan` to find indexes that never get used.

### 6.3 Cross-check: PostgreSQL 17, 256 MB cache, `random_page_cost = 1.1`

The same queries, data and index change on the earlier throwaway PG17 cluster (`docs/performance/pg17/`) gave the same conclusions. Absolute times differ with cache size and planner costs:

| Query | PG17 p95 before → after | PG18 p95 before → after |
| --- | ---: | ---: |
| Q03 newest orders | 505 → 0.88 ms | 232 → 0.95 ms |
| Q04 "Today" | 16 → 1.0 ms | 4.7 → 1.2 ms (skip scan) |
| Q10 rider leaderboard | 887 → 166 ms | 2,418 → 460 ms |
| Q11 QR analytics | 386 → 8.3 ms | 1,034 → 9.6 ms |
| Q13 phone search | 380 → 0.54 ms | 271 → 0.72 ms |

Q10 and Q11 are 2–3× slower before the change on PG18 because its default cache is half the size and its default `random_page_cost` pushes the planner towards sequential scans. After the change, every query except Q10 performs the same on both versions, because the new plans touch only a few dozen pages.

## 7. Reproducing

Use a **disposable** database: the seed loads ~13M rows, and `--reset` truncates every table. With `DATABASE_URL` pointing at it (from `server/`):

```powershell
npm run db:deploy                                   # schema, including the performance indexes
npm run perf:seed                                   # ~10 min; refuses to run if data exists (-- --reset to wipe)

psql "<perf database URL>" -f sql/perf/indexes_baseline.sql
npm run perf:bench -- --label baseline
psql "<perf database URL>" -f sql/perf/indexes_optimised.sql
npm run perf:bench -- --label optimised
npm run perf:compare -- --before baseline --after optimised
```

Fixture IDs in `queries.sql` (tenant, rider, order, tracking code, phones) are stable because the seed is deterministic. Time-relative queries (Q04, Q08, Q09) depend on the time of day the benchmark runs.
