-- Benchmark helper: restore the index set defined by migration
-- 20261112000100_query_performance_indexes (same names, so Prisma sees no drift). Idempotent.
CREATE INDEX IF NOT EXISTS "Order_tenantId_createdAt_idx" ON "Order"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "Order_tenantId_recipientPhone_idx" ON "Order"("tenantId", "recipientPhone");
CREATE INDEX IF NOT EXISTS "Order_tenantId_riderId_createdAt_idx" ON "Order"("tenantId", "riderId", "createdAt");
CREATE INDEX IF NOT EXISTS "Order_tenantId_qrCodeId_createdAt_idx" ON "Order"("tenantId", "qrCodeId", "createdAt");
CREATE INDEX IF NOT EXISTS "OrderEvent_orderId_status_createdAt_idx" ON "OrderEvent"("orderId", "status", "createdAt");
DROP INDEX IF EXISTS "Order_tenantId_riderId_idx";
DROP INDEX IF EXISTS "Order_tenantId_qrCodeId_idx";
DROP INDEX IF EXISTS "OrderEvent_orderId_createdAt_idx";
VACUUM ANALYZE "Order";
VACUUM ANALYZE "OrderEvent";
