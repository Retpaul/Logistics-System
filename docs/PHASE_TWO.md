# Phase 2 APIs and integration

## Setup and rollout

**Current local rollout:** the development database contains one rider with three active orders (ASSIGNED, PICKED_UP and IN_TRANSIT). At the user's request these assignments and their audit history are preserved. The initial migration attempt failed at the uniqueness constraint after some additive schema changes; the complete new schema is not yet active locally. The migration now has an explicit transaction so future fresh deployments roll back atomically on failure. No order resets are performed automatically.

Run `npm run phase2:preflight` to inspect conflict counts without changing records. After the operator resolves the assignments, run `npm run phase2:recover` for this known partial local migration, then restart the server. Recovery refuses to run while any duplicate active assignment remains, completes only the missing schema/indexes, and updates Prisma bookkeeping. It never updates orders, assignments or events. Normal fresh deployments should use `db:deploy`, not recovery.

To identify orders needing the operator's decision in pgAdmin:

```sql
SELECT id, "riderId", status, "createdAt"
FROM "Order"
WHERE "riderId" IN (
  SELECT "riderId" FROM "Order"
  WHERE "riderId" IS NOT NULL AND status IN ('ASSIGNED','PICKED_UP','IN_TRANSIT')
  GROUP BY "riderId" HAVING count(*) > 1
)
AND status IN ('ASSIGNED','PICKED_UP','IN_TRANSIT')
ORDER BY "riderId", "createdAt";
```

From `server/`, install dependencies, run `npm run db:generate`, then `npm run db:deploy`, then restart the server. From `client/`, run `npm install` and restart Vite. `npm run contracts:sync` updates the client contracts after server contract changes.

The migration backfills `Order.pickedUpAt` and `deliveredAt` from the earliest matching audit events, preserving unknown timestamps as null. It adds a partial unique index preventing more than one `ASSIGNED`, `PICKED_UP` or `IN_TRANSIT` order per rider. If existing data violates this rule, migration stops: resolve those assignments explicitly before retrying; do not delete audit history. Existing rider accounts start pending approval and unavailable. Review their licence/insurance before approving them.

Configure S3 as described in [STORAGE.md](STORAGE.md). Rider document/proof uploads require a working private bucket. Configure SMTP in server `.env`:

```dotenv
SMTP_HOST=your-smtp-host
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=Dispatch <dispatch@your-verified-domain.example>
```

Port 465 uses implicit TLS; other ports require STARTTLS. SMTP credentials never enter frontend variables. No test sends real email: integration tests replace the transporter and S3 calls. Invitation generation without SMTP fails; it does not pretend an email was sent. If sending fails after account creation, use **Resend invitation** after fixing SMTP. Resending invalidates the previous link. Tokens are hashed in the database, single-use, expire after 48 hours, and travel in the URL fragment so they are not sent to web server access logs. The invitation page removes the fragment after reading it. Configure `CLIENT_URL` to the real frontend origin.

## Endpoint catalogue

Location tracking now also requires confirmed endpoint pins for new orders, timestamp/accuracy metadata for GPS, and exposes a staff endpoint editor. See [LOCATION_TRACKING.md](LOCATION_TRACKING.md) for the updated payloads and migration.

All `/dispatch` routes require bearer authentication and derive tenant identity from the token. Staff means OWNER or DISPATCHER. Existing `/orders` and `/public` routes remain compatible.

| Method and path, below `/api/v1` | Access | Behaviour |
| --- | --- | --- |
| `POST /invitations/accept` | Token in request body | Set password, consume invitation, move to pending review |
| `GET /dispatch/riders` | Staff | Rider status, documents, latest GPS, active assignment |
| `POST /dispatch/riders/invite` | Staff | Create rider and email invitation |
| `POST /dispatch/riders/:id/resend` | Staff | Rotate and resend invitation |
| `POST /dispatch/riders/:id/approval` | Staff | Approve/reject; approval requires licence and insurance |
| `GET /dispatch/rider/workspace` | Rider | Own profile, latest 100 jobs plus active job, up to 50 unclaimed jobs |
| `PATCH /dispatch/rider/availability` | Rider | Only approved riders can become available |
| `POST /dispatch/orders/:id/assign` | Staff | Assign approved, available rider without active work |
| `POST /dispatch/rider/orders/:id/claim` | Rider | Claim an unassigned pending job |
| `POST /dispatch/rider/orders/:id/status` | Assigned rider | Decline before pickup, confirm pickup, start transit, complete with proof |
| `POST /dispatch/rider/location` | Available approved rider | Validate GPS, store latest rider location and active-order tracking point |
| `POST /dispatch/rider/files` | Rider | Multipart `file` and `purpose`: LICENSE, INSURANCE or PROOF |
| `GET /dispatch/files/:id/download` | Staff or file owner | Authorized short-lived S3 download URL |
| `GET /dispatch/analytics` | Staff | `from`, `to`, IANA `timezone`; uncapped aggregates, trend, hourly fees, leaderboard |
| `GET /dispatch/qr-codes` | Staff | QR list with independent scan/order aggregates |
| `POST /dispatch/qr-codes` | Staff | Create label/campaign |
| `PATCH /dispatch/qr-codes/:id` | Staff | Edit label/campaign or active status |
| `GET /dispatch/qr-codes/:id/image` | Staff | PNG encoding the actual branded booking URL |

File uploads are at most 10 MiB and accept JPEG/PNG signatures, plus PDF for onboarding documents. MIME headers and filenames alone are not trusted. Signature checking is not malware scanning; downloads remain attachments. S3 keys and file owners are recorded server-side. Foreign-tenant files are never signed; riders can read only their own files. A metadata-save failure triggers best-effort S3 compensation. Failed/retried proof submissions can leave unlinked uploads: production retention must include orphan reconciliation.

## Concurrency and status rules

Dispatcher assignment and self-claiming run through the same transaction: lock the rider row, verify approval and availability, check active work, conditionally update the pending unassigned order, then insert its event. The database partial unique index independently enforces one active job per rider. Conflicting claims return 409; no duplicate assignment event is committed.

Assigned riders can decline to PENDING, clearing rider assignment. Otherwise the flow is ASSIGNED → PICKED_UP → IN_TRANSIT → DELIVERED. Timestamps and events change atomically. Completion requires a rider-owned proof photo uploaded after order creation and a recipient name; one proof cannot be attached twice. Delivery completion is not a payment confirmation. Staff cannot suspend a rider with active work.

## Analytics and live updates

Dashboard totals aggregate in PostgreSQL, independent of list pagination. Orders/fees use booking time and exclude cancelled fees; deliveries use `deliveredAt`; in-progress counts all active tenant orders. Fees are booked delivery charges, not collected revenue. The leaderboard reads materialized pickup/delivery timestamps instead of repeatedly joining the event table; historical performance reports remain historical evidence, not a benchmark of this new deployment.

QR scan and order counts aggregate independently to avoid join multiplication. Conversion is bookings divided by scans, may exceed 100% if links are reused without another landing scan, and is not an estimate of unique visitors.

Socket.io is attached to the HTTP server. Authenticated sockets join only their verified tenant room; public tracking sockets can join only an existing tracking code's room. Events contain no customer or file data and trigger query invalidation. Expired access tokens disconnect, and clients refresh before reconnecting. REST polling remains as reconnect/missed-event fallback. Deploy one server process for this in-memory broadcaster; multiple processes require a shared adapter such as Redis before scaling horizontally.

The rider app reports foreground browser GPS roughly every 10 seconds while available. It pauses when hidden/offline, stops on unmount, and shows permission errors. This does not promise background tracking on mobile. Fleet positions older than 60 seconds show stale; no simulated distance, route or ETA is displayed. HTTPS is required for deployed browser geolocation. The development proxy forwards `/socket.io`; production proxies must forward WebSocket upgrades and long polling too.

## Verification

`npm test` in server covers competing claims/assignments, decline and status order, proof requirements, invitation expiry/reuse, required documents, tenant restrictions, uploads, GPS, totals above 100 orders, QR images/deactivation, and Socket.io authorization/isolation. Tests use only the dedicated test database. Client `npm run typecheck`, `npm run lint`, and both production builds validate integration.

Live AWS/SMTP delivery and browser GPS depend on deployment credentials/permissions and must also be smoke-tested in the deployed environment. Stripe/card payments, automatic nearest-rider dispatch, timed offers, SMS verification, background GPS, routing/ETA, earnings commission and payouts remain outside this phase. The rider activity screen shows recent delivered jobs and their delivery fees, explicitly not earnings.
