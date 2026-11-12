-- Benchmark helper: switch a DISPOSABLE perf database to the ORIGINAL index set
-- (before migration 20261112000100_query_performance_indexes). Idempotent.
-- Undo with sql/perf/indexes_optimised.sql. Never run against a real database:
-- Prisma would report this as drift.
CREATE INDEX IF NOT EXISTS "Order_tenantId_riderId_idx" ON "Order"("tenantId", "riderId");
CREATE INDEX IF NOT EXISTS "Order_tenantId_qrCodeId_idx" ON "Order"("tenantId", "qrCodeId");
CREATE INDEX IF NOT EXISTS "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");
DROP INDEX IF EXISTS "Order_tenantId_createdAt_idx";
DROP INDEX IF EXISTS "Order_tenantId_recipientPhone_idx";
DROP INDEX IF EXISTS "Order_tenantId_riderId_createdAt_idx";
DROP INDEX IF EXISTS "Order_tenantId_qrCodeId_createdAt_idx";
DROP INDEX IF EXISTS "OrderEvent_orderId_status_createdAt_idx";
VACUUM ANALYZE "Order";
VACUUM ANALYZE "OrderEvent";
