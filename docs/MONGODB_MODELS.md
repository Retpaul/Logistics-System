# MongoDB models

**Models plus an explicitly invoked portfolio sample copy.** PostgreSQL remains the application's database. The 13 Mongoose models stay isolated from server startup; no MongoDB connection or data copy runs automatically.

## Suitability

MongoDB is suitable as a future document-based copy or read model for orders, events and GPS history. Its document structure allows those records to evolve, and aggregation can support reporting. This is a design fit, not evidence that it is faster than PostgreSQL.

One collection per PostgreSQL model preserves UUID references and makes a later import easier to reconcile. Events, tracking points and payments remain separate to avoid growing arrays inside orders. See [MongoDB relationship guidance](https://www.mongodb.com/docs/manual/data-modeling/referencing/).

PostgreSQL remains the stronger fit for the current application's existing relational constraints and SQL workflows. MongoDB references do not enforce foreign keys, tenant ownership or cascade/restrict deletes; future repositories must implement these checks. This schema is a migration-friendly starting point, not a completed MongoDB-native optimization or database replacement.

## Connection URI

Yes—a data import will need **both** the existing PostgreSQL `DATABASE_URL` and a MongoDB target:

```dotenv
# server/.env — leave blank until MongoDB is ready
MONGODB_URI=
```

Examples (choose one and specify the target database):

```dotenv
# Local development
MONGODB_URI=mongodb://127.0.0.1:27017/bike_dispatch_mongo
# Atlas — replace placeholders; use database-user credentials
# MONGODB_URI=mongodb+srv://USER:PASSWORD@YOUR_CLUSTER.mongodb.net/bike_dispatch_mongo
```

For Atlas, use **Connect → Drivers**, configure a database user and permitted network access, and URL-encode special characters in credentials. Keep this server-side and out of Git. [Connection-string documentation](https://www.mongodb.com/docs/manual/reference/connection-string/).

A placeholder is provided in `.env.example`. Setting it **does not connect or migrate anything automatically**; only the explicit import command below uses it. Offline model tests need no credentials.

## Verified portfolio copy

`npm run portfolio:import` copies up to 20 linked orders from the largest source organisation using a read-only PostgreSQL snapshot. On 15 November 2026 it copied **122 business documents** from Demo Couriers; a second run inserted **zero** additional documents. See the [report](PORTFOLIO_REPORT.md), [initial receipt](portfolio/initial-import-summary.json) and [repeat receipt](portfolio/import-summary.json).

The `users` collection contains a **redacted profile projection**, not complete authentication documents. The importer uses a separate schema without required password hashes; the original User model remains unchanged. Refresh tokens and invitation hashes are excluded. Dates, UUIDs and exact decimals are reconciled. Missing nullable columns are listed in the receipt; unavailable tracking provenance becomes LEGACY, never fabricated GPS. Payment was empty; StoredFile was unavailable.

Indexes are explicitly installed for the import collections. Insert-only upserts never replace documents; unrelated UUID collisions or changed imported content cause failure. `_portfolio_imports` holds ownership/checksums and a five-minute lease; failed runs retain their partial inserts for safe retry. Rerun only an unchanged sample: changed source content requires a separately reviewed refresh, not implicit overwriting. A copy is not atomic across collections, and the receipt is written only after full verification.

`npm run test:portfolio` checks selection, validation, redaction, collisions, interrupted-run recovery and idempotence in memory. `npm run portfolio:verify` independently rechecks source/target contents without database writes and saves a [verification summary](portfolio/verification-summary.json). This is a reporting sample, not a complete migration, backup, runtime switch or live replication.

## Model decisions

- PostgreSQL `id` maps to the same canonical UUID string in MongoDB `_id`; reference names remain unchanged.
- Money and decimal coordinates use exact `Decimal128`; timestamps use `Date`; nullable fields default to `null`. New-document defaults mirror Prisma.
- Stored hashes are excluded from ordinary selection and redacted from document serialization. They are never rehashed; explicit/raw queries still require access control.
- Validation mirrors SQL storage rules, including empty-string compatibility, coordinate ranges/pairs and enums. API rules such as approval, delivery proof and valid status transitions stay in services.
- Models declare unique, compound and partial indexes; only the explicit importer provisions relevant target indexes. Nullable unique strings exclude nulls; the active-order index covers ASSIGNED/PICKED_UP/IN_TRANSIT rider assignments. No TTL or geospatial indexes are added.
- Automatic collection/index creation and command buffering are disabled. Use `createMongoModels(connection)` only with an explicitly supplied connection.

## Verification and limits

```powershell
npm run test:models   # offline schema/parity checks; no database
npm run typecheck
npm run build
npm run docs:models  # regenerate the reference below; no database
```

Tests check fields, types, defaults, enums, index declarations, validation and redaction. They do not prove database uniqueness, foreign-key equivalence, transactions or performance. Mongoose validation can be bypassed by raw writes; future deployment must provision indexes and server-side safeguards explicitly.

Before importing: validate canonical UUIDs, CHAR padding/collation differences and unsupported dates; preserve source timestamps with `timestamps: false`; supply decimals as exact strings without rounding. PostgreSQL numeric NaN is retained for money where SQL allows it; coordinate NaN is rejected. S3 files remain in S3—MongoDB holds metadata only.

The existing PostgreSQL migration conflict and preserved assignments are unchanged; see [Phase 2 rollout](PHASE_TWO.md). A full migration or continuous mirror still needs separate scope and operational testing. See the [server guide](SERVER_GUIDE.md) for application setup.

<details>
<summary>Field-by-field model and index reference (13 collections)</summary>

<!-- BEGIN MODEL CATALOGUE -->

### Tenant

Collection: `tenants`.

| PostgreSQL field | MongoDB field | Storage mapping | Nullable | Source default | Model reference |
| --- | --- | --- | --- | --- | --- |
| `id` | `_id` | Uuid → String | no | `uuid()` | — |
| `name` | `name` | VarChar(150) → String | no | `none` | — |
| `subdomain` | `subdomain` | VarChar(63) → String | no | `none` | — |
| `tagline` | `tagline` | VarChar(200) → String | yes | `null` | — |
| `logoUrl` | `logoUrl` | TEXT → String | yes | `null` | — |
| `brandColor` | `brandColor` | VarChar(7) → String | yes | `null` | — |
| `secondaryColor` | `secondaryColor` | VarChar(7) → String | yes | `null` | — |
| `currency` | `currency` | VarChar(3) → String | no | `"NGN"` | — |
| `createdAt` | `createdAt` | Timestamptz(3) → Date | no | `now()` | — |

Declared indexes (in addition to MongoDB `_id` uniqueness):

- `{"subdomain":1}` — unique.

### User

Collection: `users`.

| PostgreSQL field | MongoDB field | Storage mapping | Nullable | Source default | Model reference |
| --- | --- | --- | --- | --- | --- |
| `id` | `_id` | Uuid → String | no | `uuid()` | — |
| `tenantId` | `tenantId` | Uuid → String | no | `none` | `Tenant` |
| `email` | `email` | VarChar(254) → String | no | `none` | — |
| `passwordHash` | `passwordHash` | TEXT → String | no | `none` | — |
| `firstName` | `firstName` | VarChar(80) → String | no | `none` | — |
| `lastName` | `lastName` | VarChar(80) → String | no | `none` | — |
| `role` | `role` | Role → String | no | `DISPATCHER` | — |
| `emailVerifiedAt` | `emailVerifiedAt` | Timestamptz(3) → Date | yes | `null` | — |
| `createdAt` | `createdAt` | Timestamptz(3) → Date | no | `now()` | — |
| `updatedAt` | `updatedAt` | Timestamptz(3) → Date | no | `Prisma-managed updatedAt` | — |

Declared indexes (in addition to MongoDB `_id` uniqueness):

- `{"tenantId":1,"email":1}` — unique.
- `{"tenantId":1,"_id":1}` — unique.
- `{"email":1}`.

### RefreshToken

Collection: `refreshtokens`.

| PostgreSQL field | MongoDB field | Storage mapping | Nullable | Source default | Model reference |
| --- | --- | --- | --- | --- | --- |
| `id` | `_id` | Uuid → String | no | `uuid()` | — |
| `tenantId` | `tenantId` | Uuid → String | no | `none` | `Tenant` |
| `userId` | `userId` | Uuid → String | no | `none` | `User` |
| `familyId` | `familyId` | Uuid → String | no | `none` | — |
| `tokenHash` | `tokenHash` | Char(64) → String | no | `none` | — |
| `expiresAt` | `expiresAt` | Timestamptz(3) → Date | no | `none` | — |
| `revokedAt` | `revokedAt` | Timestamptz(3) → Date | yes | `null` | — |
| `createdAt` | `createdAt` | Timestamptz(3) → Date | no | `now()` | — |

Declared indexes (in addition to MongoDB `_id` uniqueness):

- `{"tokenHash":1}` — unique.
- `{"tenantId":1,"userId":1}`.
- `{"familyId":1}`.

### Rider

Collection: `riders`.

| PostgreSQL field | MongoDB field | Storage mapping | Nullable | Source default | Model reference |
| --- | --- | --- | --- | --- | --- |
| `id` | `_id` | Uuid → String | no | `uuid()` | — |
| `tenantId` | `tenantId` | Uuid → String | no | `none` | `Tenant` |
| `userId` | `userId` | Uuid → String | no | `none` | `User` |
| `available` | `available` | BOOLEAN → Boolean | no | `false` | — |
| `onboardingStatus` | `onboardingStatus` | VarChar(20) → String | no | `"PENDING"` | — |
| `phone` | `phone` | VarChar(25) → String | yes | `null` | — |
| `invitationHash` | `invitationHash` | Char(64) → String | yes | `null` | — |
| `invitationExpiresAt` | `invitationExpiresAt` | Timestamptz(3) → Date | yes | `null` | — |
| `latitude` | `latitude` | Decimal(9, 6) → Decimal128 | yes | `null` | — |
| `longitude` | `longitude` | Decimal(9, 6) → Decimal128 | yes | `null` | — |
| `locationAt` | `locationAt` | Timestamptz(3) → Date | yes | `null` | — |
| `locationSource` | `locationSource` | VarChar(10) → String | yes | `null` | — |
| `bikeSerial` | `bikeSerial` | VarChar(100) → String | yes | `null` | — |

Declared indexes (in addition to MongoDB `_id` uniqueness):

- `{"userId":1}` — unique.
- `{"tenantId":1,"userId":1}` — unique.
- `{"tenantId":1,"_id":1}` — unique.
- `{"invitationHash":1}` — unique; filter `{"invitationHash":{"$type":"string"}}`.

### Bike

Collection: `bikes`.

| PostgreSQL field | MongoDB field | Storage mapping | Nullable | Source default | Model reference |
| --- | --- | --- | --- | --- | --- |
| `id` | `_id` | Uuid → String | no | `uuid()` | — |
| `tenantId` | `tenantId` | Uuid → String | no | `none` | `Tenant` |
| `serialNumber` | `serialNumber` | VarChar(100) → String | no | `none` | — |
| `batteryPercent` | `batteryPercent` | INTEGER → Number | no | `100` | — |

Declared indexes (in addition to MongoDB `_id` uniqueness):

- `{"tenantId":1,"serialNumber":1}` — unique.
- `{"tenantId":1,"_id":1}` — unique.

### Customer

Collection: `customers`.

| PostgreSQL field | MongoDB field | Storage mapping | Nullable | Source default | Model reference |
| --- | --- | --- | --- | --- | --- |
| `id` | `_id` | Uuid → String | no | `uuid()` | — |
| `tenantId` | `tenantId` | Uuid → String | no | `none` | `Tenant` |
| `name` | `name` | VarChar(150) → String | no | `none` | — |
| `phone` | `phone` | VarChar(25) → String | no | `none` | — |
| `email` | `email` | VarChar(254) → String | yes | `null` | — |

Declared indexes (in addition to MongoDB `_id` uniqueness):

- `{"tenantId":1,"_id":1}` — unique.
- `{"tenantId":1,"phone":1}`.

### QrCode

Collection: `qrcodes`.

| PostgreSQL field | MongoDB field | Storage mapping | Nullable | Source default | Model reference |
| --- | --- | --- | --- | --- | --- |
| `id` | `_id` | Uuid → String | no | `uuid()` | — |
| `tenantId` | `tenantId` | Uuid → String | no | `none` | `Tenant` |
| `code` | `code` | TEXT → String | no | `uuid()` | — |
| `label` | `label` | VarChar(150) → String | no | `none` | — |
| `campaign` | `campaign` | VarChar(150) → String | yes | `null` | — |
| `active` | `active` | BOOLEAN → Boolean | no | `true` | — |

Declared indexes (in addition to MongoDB `_id` uniqueness):

- `{"code":1}` — unique.
- `{"tenantId":1,"_id":1}` — unique.

### QrScan

Collection: `qrscans`.

| PostgreSQL field | MongoDB field | Storage mapping | Nullable | Source default | Model reference |
| --- | --- | --- | --- | --- | --- |
| `id` | `_id` | Uuid → String | no | `uuid()` | — |
| `qrCodeId` | `qrCodeId` | Uuid → String | no | `none` | `QrCode` |
| `scannedAt` | `scannedAt` | Timestamptz(3) → Date | no | `now()` | — |

Declared indexes (in addition to MongoDB `_id` uniqueness):

- `{"qrCodeId":1,"scannedAt":1}`.

### Order

Collection: `orders`.

| PostgreSQL field | MongoDB field | Storage mapping | Nullable | Source default | Model reference |
| --- | --- | --- | --- | --- | --- |
| `id` | `_id` | Uuid → String | no | `uuid()` | — |
| `tenantId` | `tenantId` | Uuid → String | no | `none` | `Tenant` |
| `customerId` | `customerId` | Uuid → String | no | `none` | `Customer` |
| `riderId` | `riderId` | Uuid → String | yes | `null` | `Rider` |
| `bikeId` | `bikeId` | Uuid → String | yes | `null` | `Bike` |
| `qrCodeId` | `qrCodeId` | Uuid → String | yes | `null` | `QrCode` |
| `trackingCode` | `trackingCode` | TEXT → String | no | `uuid()` | — |
| `pickupAddress` | `pickupAddress` | TEXT → String | no | `none` | — |
| `deliveryAddress` | `deliveryAddress` | TEXT → String | no | `none` | — |
| `recipientName` | `recipientName` | VarChar(150) → String | no | `none` | — |
| `recipientPhone` | `recipientPhone` | VarChar(25) → String | no | `none` | — |
| `packageSize` | `packageSize` | PackageSize → String | no | `MEDIUM` | — |
| `notes` | `notes` | VarChar(1000) → String | yes | `null` | — |
| `status` | `status` | OrderStatus → String | no | `PENDING` | — |
| `deliveryFee` | `deliveryFee` | Decimal(12, 2) → Decimal128 | no | `none` | — |
| `currency` | `currency` | VarChar(3) → String | no | `"NGN"` | — |
| `createdAt` | `createdAt` | Timestamptz(3) → Date | no | `now()` | — |
| `updatedAt` | `updatedAt` | Timestamptz(3) → Date | no | `Prisma-managed updatedAt` | — |
| `pickedUpAt` | `pickedUpAt` | Timestamptz(3) → Date | yes | `null` | — |
| `deliveredAt` | `deliveredAt` | Timestamptz(3) → Date | yes | `null` | — |
| `proofFileId` | `proofFileId` | Uuid → String | yes | `null` | `StoredFile` |
| `proofRecipient` | `proofRecipient` | VarChar(150) → String | yes | `null` | — |
| `pickupLatitude` | `pickupLatitude` | Decimal(9, 6) → Decimal128 | yes | `null` | — |
| `pickupLongitude` | `pickupLongitude` | Decimal(9, 6) → Decimal128 | yes | `null` | — |
| `deliveryLatitude` | `deliveryLatitude` | Decimal(9, 6) → Decimal128 | yes | `null` | — |
| `deliveryLongitude` | `deliveryLongitude` | Decimal(9, 6) → Decimal128 | yes | `null` | — |

Declared indexes (in addition to MongoDB `_id` uniqueness):

- `{"trackingCode":1}` — unique.
- `{"tenantId":1,"status":1,"createdAt":1}`.
- `{"tenantId":1,"createdAt":1}`.
- `{"tenantId":1,"deliveredAt":1}`.
- `{"tenantId":1,"customerId":1}`.
- `{"tenantId":1,"riderId":1,"createdAt":1}`.
- `{"tenantId":1,"bikeId":1}`.
- `{"tenantId":1,"qrCodeId":1,"createdAt":1}`.
- `{"tenantId":1,"recipientPhone":1}`.
- `{"riderId":1}` — unique; filter `{"riderId":{"$type":"string"},"status":{"$in":["ASSIGNED","PICKED_UP","IN_TRANSIT"]}}`.

### StoredFile

Collection: `storedfiles`.

| PostgreSQL field | MongoDB field | Storage mapping | Nullable | Source default | Model reference |
| --- | --- | --- | --- | --- | --- |
| `id` | `_id` | Uuid → String | no | `uuid()` | — |
| `tenantId` | `tenantId` | Uuid → String | no | `none` | `Tenant` |
| `userId` | `userId` | Uuid → String | no | `none` | `User` |
| `key` | `key` | TEXT → String | no | `none` | — |
| `filename` | `filename` | VarChar(120) → String | no | `none` | — |
| `contentType` | `contentType` | VarChar(127) → String | no | `none` | — |
| `size` | `size` | INTEGER → Number | no | `none` | — |
| `purpose` | `purpose` | VarChar(20) → String | no | `none` | — |
| `createdAt` | `createdAt` | Timestamptz(3) → Date | no | `now()` | — |

Declared indexes (in addition to MongoDB `_id` uniqueness):

- `{"key":1}` — unique.
- `{"tenantId":1,"userId":1,"purpose":1}`.

### OrderEvent

Collection: `orderevents`.

| PostgreSQL field | MongoDB field | Storage mapping | Nullable | Source default | Model reference |
| --- | --- | --- | --- | --- | --- |
| `id` | `_id` | Uuid → String | no | `uuid()` | — |
| `orderId` | `orderId` | Uuid → String | no | `none` | `Order` |
| `status` | `status` | OrderStatus → String | no | `none` | — |
| `note` | `note` | TEXT → String | yes | `null` | — |
| `createdAt` | `createdAt` | Timestamptz(3) → Date | no | `now()` | — |

Declared indexes (in addition to MongoDB `_id` uniqueness):

- `{"orderId":1,"status":1,"createdAt":1}`.

### TrackingPoint

Collection: `trackingpoints`.

| PostgreSQL field | MongoDB field | Storage mapping | Nullable | Source default | Model reference |
| --- | --- | --- | --- | --- | --- |
| `id` | `_id` | Uuid → String | no | `uuid()` | — |
| `orderId` | `orderId` | Uuid → String | no | `none` | `Order` |
| `latitude` | `latitude` | Decimal(9, 6) → Decimal128 | no | `none` | — |
| `longitude` | `longitude` | Decimal(9, 6) → Decimal128 | no | `none` | — |
| `recordedAt` | `recordedAt` | Timestamptz(3) → Date | no | `now()` | — |
| `source` | `source` | VarChar(10) → String | no | `"LEGACY"` | — |
| `accuracy` | `accuracy` | DOUBLE PRECISION → Number | yes | `null` | — |

Declared indexes (in addition to MongoDB `_id` uniqueness):

- `{"orderId":1,"recordedAt":1}`.

### Payment

Collection: `payments`.

| PostgreSQL field | MongoDB field | Storage mapping | Nullable | Source default | Model reference |
| --- | --- | --- | --- | --- | --- |
| `id` | `_id` | Uuid → String | no | `uuid()` | — |
| `orderId` | `orderId` | Uuid → String | no | `none` | `Order` |
| `providerReference` | `providerReference` | TEXT → String | yes | `null` | — |
| `amount` | `amount` | Decimal(12, 2) → Decimal128 | no | `none` | — |
| `currency` | `currency` | VarChar(3) → String | no | `"NGN"` | — |
| `status` | `status` | PaymentStatus → String | no | `PENDING` | — |
| `createdAt` | `createdAt` | Timestamptz(3) → Date | no | `now()` | — |

Declared indexes (in addition to MongoDB `_id` uniqueness):

- `{"providerReference":1}` — unique; filter `{"providerReference":{"$type":"string"}}`.
- `{"orderId":1}`.

<!-- END MODEL CATALOGUE -->

</details>
