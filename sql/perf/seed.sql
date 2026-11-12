-- =============================================================================
-- Bike Dispatch: synthetic performance dataset (DEVELOPMENT / TEST ONLY)
-- =============================================================================
-- Builds a deterministic dataset sized to PRD NFR-SC-002 ("1 million orders
-- without performance degradation"). Run through `npm run perf:seed`, which
-- refuses to touch a database that already contains tenants unless --reset.
--
-- Shape (approximate row counts):
--   Tenant 100 | User 2,200 | Rider 2,000 | Bike 2,000 | Customer 100,000
--   QrCode 1,000 | QrScan 2,500,000 | Order 1,000,000 | OrderEvent ~4.6M
--   TrackingPoint ~3.7M | Payment ~1.03M
--
-- Skew: tenants are drawn with floor(100 * random()^3), so tenant 0
-- ("Lagos Express") owns ~21% of all orders. Benchmarks use it as the
-- worst-case tenant. Orders span 365 days; only orders from the last 3 hours
-- can be in an active status (PENDING / ASSIGNED / PICKED_UP / IN_TRANSIT).
--
-- IDs are md5-derived UUIDs (md5('order' || n)::uuid) so benchmark queries
-- can reference fixed IDs and every run produces identical data.
-- =============================================================================

BEGIN;

SELECT setseed(0.20261112);

CREATE TEMP TABLE seed_clock ON COMMIT DROP AS SELECT now() AS t0;

-- ---------------------------------------------------------------- reference data
INSERT INTO "Tenant" (id, name, subdomain, "brandColor", "createdAt")
SELECT md5('tenant' || t)::uuid,
       CASE t WHEN 0 THEN 'Lagos Express' ELSE format('Courier %s', lpad(t::text, 3, '0')) END,
       format('courier%s', t),
       '#' || substr(md5('colour' || t), 1, 6),
       c.t0 - interval '400 days'
FROM generate_series(0, 99) t, seed_clock c;

-- staff: n 0..99 owners, 100..199 dispatchers (tenant = n % 100)
INSERT INTO "User" (id, "tenantId", email, "passwordHash", "firstName", "lastName", role, "createdAt", "updatedAt")
SELECT md5('user-staff' || n)::uuid, md5('tenant' || (n % 100))::uuid,
       format('%s@courier%s.test', CASE WHEN n < 100 THEN 'owner' ELSE 'dispatch' END, n % 100),
       'seed-not-a-real-hash', 'Staff', n::text,
       CASE WHEN n < 100 THEN 'OWNER' ELSE 'DISPATCHER' END::"Role",
       c.t0 - interval '400 days', c.t0 - interval '400 days'
FROM generate_series(0, 199) n, seed_clock c;

-- riders: r 0..1999, 20 per tenant (tenant = r % 100)
INSERT INTO "User" (id, "tenantId", email, "passwordHash", "firstName", "lastName", role, "createdAt", "updatedAt")
SELECT md5('user-rider' || r)::uuid, md5('tenant' || (r % 100))::uuid,
       format('rider%s@courier%s.test', r, r % 100),
       'seed-not-a-real-hash', 'Rider', r::text, 'RIDER',
       c.t0 - interval '380 days', c.t0 - interval '380 days'
FROM generate_series(0, 1999) r, seed_clock c;

INSERT INTO "Rider" (id, "tenantId", "userId", available)
SELECT md5('rider' || r)::uuid, md5('tenant' || (r % 100))::uuid, md5('user-rider' || r)::uuid, random() < 0.6
FROM generate_series(0, 1999) r;

INSERT INTO "Bike" (id, "tenantId", "serialNumber", "batteryPercent")
SELECT md5('bike' || b)::uuid, md5('tenant' || (b % 100))::uuid,
       'EB-' || lpad(b::text, 5, '0'), floor(random() * 101)::int
FROM generate_series(0, 1999) b;

-- customers: c 0..99999, 1,000 per tenant (tenant = c % 100), unique phone per customer
INSERT INTO "Customer" (id, "tenantId", name, phone, email)
SELECT md5('customer' || n)::uuid, md5('tenant' || (n % 100))::uuid,
       'Customer ' || n,
       '+23480' || lpad(n::text, 8, '0'),
       CASE WHEN n % 2 = 0 THEN format('customer%s@example.test', n) END
FROM generate_series(0, 99999) n;

-- QR codes: q 0..999, 10 per tenant (tenant = q % 100)
INSERT INTO "QrCode" (id, "tenantId", code, label, campaign, active)
SELECT md5('qr' || q)::uuid, md5('tenant' || (q % 100))::uuid,
       md5('qrcode' || q), 'QR ' || q,
       CASE q % 3 WHEN 0 THEN 'Summer2026' WHEN 1 THEN 'Launch' END,
       random() < 0.9
FROM generate_series(0, 999) q;

-- ---------------------------------------------------------------- order staging
CREATE TEMP TABLE g ON COMMIT DROP AS
WITH s AS (
  SELECT i,
         floor(100 * power(random(), 3))::int AS t,
         random() AS r_age, random() AS r_status, random() AS r_cust, random() AS r_rider,
         random() AS r_bike, random() AS r_qr, random() AS r_fee, random() AS r_phone,
         random() AS r_addr1, random() AS r_addr2,
         random() AS m1, random() AS m2, random() AS m3
  FROM generate_series(1, 1000000) i
), a AS (
  SELECT s.*, c.t0,
         s.r_age * interval '365 days' AS age
  FROM s, seed_clock c
), st AS (
  SELECT a.*,
         CASE
           WHEN age > interval '3 hours' THEN CASE WHEN r_status < 0.92 THEN 'DELIVERED' ELSE 'CANCELLED' END
           WHEN r_status < 0.15 THEN 'PENDING'
           WHEN r_status < 0.35 THEN 'ASSIGNED'
           WHEN r_status < 0.50 THEN 'PICKED_UP'
           WHEN r_status < 0.80 THEN 'IN_TRANSIT'
           WHEN r_status < 0.95 THEN 'DELIVERED'
           ELSE 'CANCELLED'
         END AS status
  FROM a
)
SELECT i, t, status,
       md5('order' || i)::uuid AS id,
       md5('tenant' || t)::uuid AS tenant_id,
       md5('customer' || (t + 100 * floor(r_cust * 1000)::int))::uuid AS customer_id,
       '+23480' || lpad((t + 100 * floor(r_cust * 1000)::int)::text, 8, '0') AS customer_phone,
       CASE WHEN status = 'PENDING' OR (status = 'CANCELLED' AND r_rider < 0.5) THEN NULL
            ELSE md5('rider' || (t + 100 * floor(r_rider * 20)::int))::uuid END AS rider_id,
       CASE WHEN status = 'PENDING' OR (status = 'CANCELLED' AND r_rider < 0.5) THEN NULL
            ELSE md5('bike' || (t + 100 * floor(r_bike * 20)::int))::uuid END AS bike_id,
       CASE WHEN r_qr < 0.6 THEN md5('qr' || (t + 100 * floor(r_qr / 0.6 * 10)::int))::uuid END AS qr_id,
       t0 - age AS created_at,
       age,
       r_phone, r_addr1, r_addr2,
       round((1500 + r_fee * 3500)::numeric, 0) AS fee,
       -- minute offsets from creation for each lifecycle step
       interval '1 minute' * (2 + 8 * m1)                                  AS o_assign,
       interval '1 minute' * (2 + 8 * m1 + 10 + 15 * m2)                   AS o_pickup,
       interval '1 minute' * (2 + 8 * m1 + 10 + 15 * m2 + 1)               AS o_transit,
       interval '1 minute' * (2 + 8 * m1 + 10 + 15 * m2 + 1 + 15 + 30 * m3) AS o_deliver,
       CASE status WHEN 'PENDING' THEN 0 WHEN 'ASSIGNED' THEN 1 WHEN 'PICKED_UP' THEN 2
                   WHEN 'IN_TRANSIT' THEN 3 WHEN 'DELIVERED' THEN 4
                   ELSE CASE WHEN r_rider < 0.5 THEN 0 ELSE 1 END END AS rank
FROM st;

-- An active order's step times are compressed so they never pass "now".
CREATE TEMP TABLE ev ON COMMIT DROP AS
SELECT g.i, g.id AS order_id, s.k, s.st,
       g.created_at + LEAST(s.off, g.age * s.k / 6.0) AS at
FROM g
CROSS JOIN LATERAL (VALUES (0, 'PENDING',    interval '0'),
                           (1, 'ASSIGNED',   g.o_assign),
                           (2, 'PICKED_UP',  g.o_pickup),
                           (3, 'IN_TRANSIT', g.o_transit),
                           (4, 'DELIVERED',  g.o_deliver)) AS s(k, st, off)
WHERE s.k <= g.rank
UNION ALL
SELECT g.i, g.id, 9, 'CANCELLED', g.created_at + LEAST(g.o_assign + interval '5 minutes', g.age / 2)
FROM g WHERE g.status = 'CANCELLED';

-- ---------------------------------------------------------------- orders + history
INSERT INTO "Order" (id, "tenantId", "customerId", "riderId", "bikeId", "qrCodeId", "trackingCode",
                     "pickupAddress", "deliveryAddress", "recipientName", "recipientPhone",
                     status, "deliveryFee", currency, "createdAt", "updatedAt")
SELECT g.id, g.tenant_id, g.customer_id, g.rider_id, g.bike_id, g.qr_id,
       md5('tracking' || g.i)::uuid::text,
       (1 + floor(g.r_addr1 * 200)::int) || ' ' || (ARRAY['Admiralty Way, Lekki','Allen Avenue, Ikeja','Adeola Odeku, Victoria Island',
         'Herbert Macaulay Way, Yaba','Awolowo Road, Ikoyi','Ago Palace Way, Okota','Opebi Road, Ikeja','Bode Thomas, Surulere',
         'Ozumba Mbadiwe, Victoria Island','Adetokunbo Ademola, Victoria Island','Isaac John, GRA Ikeja','Akin Adesola, Victoria Island'])
         [1 + floor(g.r_addr1 * 1000)::int % 12] || ', Lagos',
       (1 + floor(g.r_addr2 * 200)::int) || ' ' || (ARRAY['Admiralty Way, Lekki','Allen Avenue, Ikeja','Adeola Odeku, Victoria Island',
         'Herbert Macaulay Way, Yaba','Awolowo Road, Ikoyi','Ago Palace Way, Okota','Opebi Road, Ikeja','Bode Thomas, Surulere',
         'Ozumba Mbadiwe, Victoria Island','Adetokunbo Ademola, Victoria Island','Isaac John, GRA Ikeja','Akin Adesola, Victoria Island'])
         [1 + floor(g.r_addr2 * 1000)::int % 12] || ', Lagos',
       'Recipient ' || (g.i % 5000),
       CASE WHEN g.r_phone < 0.7 THEN g.customer_phone
            ELSE '+23481' || lpad(floor(g.r_phone * 1e8)::bigint::text, 8, '0') END,
       g.status::"OrderStatus", g.fee, 'NGN', g.created_at, last.at
FROM g
JOIN (SELECT i, max(at) AS at FROM ev GROUP BY i) last ON last.i = g.i;

INSERT INTO "OrderEvent" (id, "orderId", status, note, "createdAt")
SELECT md5('event' || i || '-' || k)::uuid, order_id, st::"OrderStatus",
       CASE WHEN st = 'CANCELLED' THEN 'Cancelled by customer' END, at
FROM ev;

-- Delivered history keeps a downsampled 4-point trail; live IN_TRANSIT orders get
-- 10-second samples (PRD NFR-PE-002) for up to the last 30 minutes.
INSERT INTO "TrackingPoint" (id, "orderId", latitude, longitude, "recordedAt")
SELECT md5('tp' || g.i || '-' || n)::uuid, g.id,
       round((6.45 + (random() - 0.5) * 0.3)::numeric, 6),
       round((3.40 + (random() - 0.5) * 0.3)::numeric, 6),
       g.created_at + g.o_transit + (g.o_deliver - g.o_transit) * n / 4.0
FROM g CROSS JOIN generate_series(1, 4) n
WHERE g.status = 'DELIVERED' AND g.age > interval '3 hours'
UNION ALL
SELECT md5('tp' || e.i || '-live-' || n)::uuid, e.order_id,
       round((6.45 + (random() - 0.5) * 0.3)::numeric, 6),
       round((3.40 + (random() - 0.5) * 0.3)::numeric, 6),
       c.t0 - interval '10 seconds' * n
FROM ev e
JOIN g ON g.i = e.i AND g.status = 'IN_TRANSIT'
CROSS JOIN seed_clock c
CROSS JOIN LATERAL generate_series(0, LEAST(180, floor(extract(epoch FROM c.t0 - e.at) / 10)::int)) n
WHERE e.st = 'IN_TRANSIT';

-- One attempt per order; every 33rd order has a FAILED attempt followed by a retry.
INSERT INTO "Payment" (id, "orderId", "providerReference", amount, currency, status, "createdAt")
SELECT md5('pay' || g.i || '-1')::uuid, g.id, 'PSK_' || md5('pay' || g.i || '-1'), g.fee, 'NGN',
       CASE WHEN g.i % 33 = 0 THEN 'FAILED'
            WHEN g.status = 'CANCELLED' THEN 'REFUNDED'
            WHEN g.status = 'PENDING' THEN 'PENDING'
            ELSE 'PAID' END::"PaymentStatus",
       g.created_at + LEAST(interval '1 minute', g.age / 10)
FROM g
UNION ALL
SELECT md5('pay' || g.i || '-2')::uuid, g.id, 'PSK_' || md5('pay' || g.i || '-2'), g.fee, 'NGN',
       CASE WHEN g.status = 'CANCELLED' THEN 'REFUNDED'
            WHEN g.status = 'PENDING' THEN 'PENDING'
            ELSE 'PAID' END::"PaymentStatus",
       g.created_at + LEAST(interval '3 minutes', g.age / 5)
FROM g WHERE g.i % 33 = 0;

-- Scans follow the same tenant skew as orders (~24% scan-to-order conversion).
INSERT INTO "QrScan" (id, "qrCodeId", "scannedAt")
SELECT md5('scan' || n)::uuid,
       md5('qr' || (floor(100 * power(random(), 3))::int + 100 * floor(random() * 10)::int))::uuid,
       c.t0 - random() * interval '365 days'
FROM generate_series(1, 2500000) n, seed_clock c;

COMMIT;
