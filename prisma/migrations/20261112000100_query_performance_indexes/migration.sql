-- Query-performance indexes. Evidence: docs/PERFORMANCE.md and docs/performance/.
-- Generated with `prisma migrate diff`, then reordered so each replacement index exists
-- before the index it supersedes is dropped (composite FKs are never left unindexed).
--
-- Production note: plain CREATE INDEX blocks writes to the table while it builds
-- (about 1-3 s per index at 1M orders on a laptop). On a busy production database,
-- build the indexes beforehand with CREATE INDEX CONCURRENTLY under the same names,
-- then use `prisma migrate resolve --applied` for this migration.

-- New: newest-first order lists, "today" filters, KPI and trend ranges (Q03, Q04, Q08, Q09)
CREATE INDEX "Order_tenantId_createdAt_idx" ON "Order"("tenantId", "createdAt");

-- New: dispatcher search by recipient phone (Q13)
CREATE INDEX "Order_tenantId_recipientPhone_idx" ON "Order"("tenantId", "recipientPhone");

-- Widened: rider filter ordered by date (Q06); still serves the (tenantId, riderId) FK
CREATE INDEX "Order_tenantId_riderId_createdAt_idx" ON "Order"("tenantId", "riderId", "createdAt");
DROP INDEX "Order_tenantId_riderId_idx";

-- Widened: QR conversions within a date range (Q11); still serves the (tenantId, qrCodeId) FK
CREATE INDEX "Order_tenantId_qrCodeId_createdAt_idx" ON "Order"("tenantId", "qrCodeId", "createdAt");
DROP INDEX "Order_tenantId_qrCodeId_idx";

-- Replaced: status lookups per order answered from the index alone (Q10); still serves the orderId FK
CREATE INDEX "OrderEvent_orderId_status_createdAt_idx" ON "OrderEvent"("orderId", "status", "createdAt");
DROP INDEX "OrderEvent_orderId_createdAt_idx";
