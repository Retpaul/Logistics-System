-- =============================================================================
-- Bike Dispatch: API query catalogue used for performance evidence
-- =============================================================================
-- Each block is the SQL an API endpoint issues (Prisma generates equivalent
-- statements). Literal fixture values refer to rows created by sql/perf/seed.sql,
-- so every block can be pasted into psql / pgAdmin as-is. All tenant-scoped
-- queries use the largest tenant ("Lagos Express", ~21% of 1M orders) as the
-- worst case.
--
-- scripts/perf/bench.mjs parses the "-- @id" / "-- @title" / "-- @endpoint"
-- headers; keep one statement per block.
-- =============================================================================

-- @id Q01
-- @title Public tracking page: order, tenant branding, latest GPS point (US-09, polled every 10 s)
-- @endpoint GET /track/:trackingCode
SELECT o.id, o.status, o."deliveryAddress", o."recipientName", o."createdAt",
       t.name AS tenant_name, t."brandColor",
       lp.latitude, lp.longitude, lp."recordedAt" AS last_seen_at
FROM "Order" o
JOIN "Tenant" t ON t.id = o."tenantId"
LEFT JOIN LATERAL (
  SELECT tp.latitude, tp.longitude, tp."recordedAt"
  FROM "TrackingPoint" tp
  WHERE tp."orderId" = o.id
  ORDER BY tp."recordedAt" DESC
  LIMIT 1
) lp ON true
WHERE o."trackingCode" = '1769131c-bd48-5264-34b5-983c6fa675e7';

-- @id Q02
-- @title Order detail with customer and status timeline (ordersRepository.findById)
-- @endpoint GET /orders/:id
SELECT o.id, o.status, o."trackingCode", o."deliveryFee", c.name AS customer, c.phone,
       e.status AS event_status, e."createdAt" AS event_at
FROM "Order" o
JOIN "Customer" c ON c."tenantId" = o."tenantId" AND c.id = o."customerId"
LEFT JOIN "OrderEvent" e ON e."orderId" = o.id
WHERE o.id = '000035f6-2cc4-1785-a39b-1331175d5bb0' AND o."tenantId" = '76369a2d-016f-7bbd-d447-684b65cb44af'
ORDER BY e."createdAt";

-- @id Q03
-- @title Orders page, default view: newest 25 orders for the tenant (US-17)
-- @endpoint GET /orders?limit=25
SELECT o.id, o."trackingCode", o.status, o."recipientName", o."deliveryAddress", o."deliveryFee", o."createdAt"
FROM "Order" o
WHERE o."tenantId" = '76369a2d-016f-7bbd-d447-684b65cb44af'
ORDER BY o."createdAt" DESC
LIMIT 25;

-- @id Q04
-- @title Orders page, "Today" filter, Lagos local day (US-17)
-- @endpoint GET /orders?date=today
SELECT o.id, o."trackingCode", o.status, o."recipientName", o."deliveryAddress", o."deliveryFee", o."createdAt"
FROM "Order" o
WHERE o."tenantId" = '76369a2d-016f-7bbd-d447-684b65cb44af'
  AND o."createdAt" >= date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos'
ORDER BY o."createdAt" DESC
LIMIT 25;

-- @id Q05
-- @title Orders page, status filter "Delivered" (US-17)
-- @endpoint GET /orders?status=DELIVERED
SELECT o.id, o."trackingCode", o.status, o."recipientName", o."deliveryAddress", o."deliveryFee", o."createdAt"
FROM "Order" o
WHERE o."tenantId" = '76369a2d-016f-7bbd-d447-684b65cb44af' AND o.status = 'DELIVERED'
ORDER BY o."createdAt" DESC
LIMIT 25;

-- @id Q06
-- @title Orders page, rider filter (US-17)
-- @endpoint GET /orders?riderId=:id
SELECT o.id, o."trackingCode", o.status, o."recipientName", o."deliveryAddress", o."deliveryFee", o."createdAt"
FROM "Order" o
WHERE o."tenantId" = '76369a2d-016f-7bbd-d447-684b65cb44af' AND o."riderId" = '91203792-8dc8-3c7c-5827-0a3be5e682dc'
ORDER BY o."createdAt" DESC
LIMIT 25;

-- @id Q07
-- @title Fleet map: all active orders for the tenant (US-16)
-- @endpoint GET /dispatch/active-orders
SELECT o.id, o.status, o."riderId", o."pickupAddress", o."deliveryAddress", o."createdAt"
FROM "Order" o
WHERE o."tenantId" = '76369a2d-016f-7bbd-d447-684b65cb44af'
  AND o.status IN ('PENDING', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT')
ORDER BY o."createdAt" DESC
LIMIT 200;

-- @id Q08
-- @title Analytics dashboard KPIs for today: orders, deliveries, revenue, average order value (US-18)
-- @endpoint GET /analytics/today
SELECT count(*) AS orders_today,
       count(*) FILTER (WHERE o.status = 'DELIVERED') AS delivered_today,
       coalesce(sum(p.amount), 0) AS revenue_today,
       round(avg(o."deliveryFee"), 2) AS avg_order_value
FROM "Order" o
LEFT JOIN "Payment" p ON p."orderId" = o.id AND p.status = 'PAID'
WHERE o."tenantId" = '76369a2d-016f-7bbd-d447-684b65cb44af'
  AND o."createdAt" >= date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos';

-- @id Q09
-- @title Analytics "This Week": orders and gross fees per day for the last 7 days (US-18)
-- @endpoint GET /analytics/trend?range=7d
SELECT (o."createdAt" AT TIME ZONE 'Africa/Lagos')::date AS day,
       count(*) AS orders,
       sum(o."deliveryFee") AS gross_fees
FROM "Order" o
WHERE o."tenantId" = '76369a2d-016f-7bbd-d447-684b65cb44af' AND o."createdAt" >= now() - interval '7 days'
GROUP BY 1
ORDER BY 1;

-- @id Q10
-- @title Rider leaderboard, last 30 days: deliveries and average pickup-to-drop minutes (US-18)
-- @endpoint GET /analytics/riders
SELECT u."firstName" || ' ' || u."lastName" AS rider,
       count(*) AS deliveries,
       round(avg(extract(epoch FROM d."createdAt" - pu."createdAt")) / 60, 1) AS avg_minutes
FROM "Order" o
JOIN "Rider" r ON r."tenantId" = o."tenantId" AND r.id = o."riderId"
JOIN "User" u ON u."tenantId" = r."tenantId" AND u.id = r."userId"
JOIN "OrderEvent" pu ON pu."orderId" = o.id AND pu.status = 'PICKED_UP'
JOIN "OrderEvent" d ON d."orderId" = o.id AND d.status = 'DELIVERED'
WHERE o."tenantId" = '76369a2d-016f-7bbd-d447-684b65cb44af'
  AND o.status = 'DELIVERED'
  AND o."createdAt" >= now() - interval '30 days'
GROUP BY u.id, u."firstName", u."lastName"
ORDER BY deliveries DESC
LIMIT 10;

-- @id Q11
-- @title QR analytics, last 30 days: scans, orders and conversion per QR code (US-05)
-- @endpoint GET /qr-codes/analytics?range=30d
-- Counts are aggregated in separate LATERAL subqueries: joining scans and orders
-- directly would multiply rows (scans x orders) and inflate both counts.
SELECT q.label, q.campaign,
       s.scans, oc.orders,
       round(100.0 * oc.orders / nullif(s.scans, 0), 1) AS conversion_pct
FROM "QrCode" q
CROSS JOIN LATERAL (
  SELECT count(*) AS scans FROM "QrScan" s
  WHERE s."qrCodeId" = q.id AND s."scannedAt" >= now() - interval '30 days'
) s
CROSS JOIN LATERAL (
  SELECT count(*) AS orders FROM "Order" o
  WHERE o."tenantId" = q."tenantId" AND o."qrCodeId" = q.id AND o."createdAt" >= now() - interval '30 days'
) oc
WHERE q."tenantId" = '76369a2d-016f-7bbd-d447-684b65cb44af'
ORDER BY oc.orders DESC;

-- @id Q12
-- @title Manual order entry: find existing customer by phone (US-07)
-- @endpoint GET /customers?phone=
SELECT c.id, c.name, c.phone, c.email
FROM "Customer" c
WHERE c."tenantId" = '76369a2d-016f-7bbd-d447-684b65cb44af' AND c.phone = '+2348000000000';

-- @id Q13
-- @title Dispatcher search: orders by recipient phone (support call lookup, US-17)
-- @endpoint GET /orders?recipientPhone=
SELECT o.id, o."trackingCode", o.status, o."recipientName", o."createdAt"
FROM "Order" o
WHERE o."tenantId" = '76369a2d-016f-7bbd-d447-684b65cb44af' AND o."recipientPhone" = '+2348170000267'
ORDER BY o."createdAt" DESC
LIMIT 25;

-- @id Q14
-- @title Rider app "My jobs": rider's current assigned / in-progress orders (US-21, polled)
-- @endpoint GET /rider/me/jobs
SELECT o.id, o.status, o."pickupAddress", o."deliveryAddress", o."recipientPhone", o."createdAt"
FROM "Order" o
WHERE o."tenantId" = '76369a2d-016f-7bbd-d447-684b65cb44af' AND o."riderId" = 'fa056a41-f9a4-a0d3-a786-9db475ecc82e'
  AND o.status IN ('ASSIGNED', 'PICKED_UP', 'IN_TRANSIT')
ORDER BY o."createdAt";

-- @id Q15
-- @title Fleet map: latest GPS position of every order on the road (US-16)
-- @endpoint GET /dispatch/live-positions
SELECT o.id, o."riderId", o.status, lp.latitude, lp.longitude, lp."recordedAt"
FROM "Order" o
CROSS JOIN LATERAL (
  SELECT tp.latitude, tp.longitude, tp."recordedAt"
  FROM "TrackingPoint" tp
  WHERE tp."orderId" = o.id
  ORDER BY tp."recordedAt" DESC
  LIMIT 1
) lp
WHERE o."tenantId" = '76369a2d-016f-7bbd-d447-684b65cb44af' AND o.status IN ('PICKED_UP', 'IN_TRANSIT');
