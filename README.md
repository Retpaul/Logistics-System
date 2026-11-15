# Bike Dispatch server

Express 5 + TypeScript. **PostgreSQL + Prisma remains the running application's database.** MongoDB currently has isolated Mongoose schemas/models only—no connection, data migration, replication or API database switch.

## Run locally

Use Node 22.12+ and PostgreSQL. From `server/`:

```powershell
npm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# Configure DATABASE_URL and JWT_ACCESS_SECRET; create an empty development database.
npm run db:generate
npm run db:deploy
npm run dev
```

See the [server guide](docs/SERVER_GUIDE.md) for complete setup, configuration, API and architecture. For an existing database with a failed Phase 2 migration, follow the [recovery notes](docs/PHASE_TWO.md) before deploying further migrations. No order assignments are reset automatically.

## Checks

```powershell
npm run test:models   # MongoDB models: offline, no database credentials
npm run test:storage  # S3 helpers: mocked, no AWS calls
npm run typecheck
npm run build
# npm test           # API suite: creates/migrates/empties bike_dispatch_test
```

## Server documentation

| Guide | Contents |
| --- | --- |
| [Server guide](docs/SERVER_GUIDE.md) | Detailed installation, environment, core API, scripts and architecture |
| [PostgreSQL database](docs/DATABASE.md) | ER diagram, relational schema, constraints and normalization |
| [MongoDB models](docs/MONGODB_MODELS.md) | All 13 schema/model mappings, index declarations, offline tests and future migration boundaries |
| [Transaction evidence](docs/TRANSACTIONS.md) | Commit, rollback, isolation and concurrent-update output |
| [Performance analysis](docs/PERFORMANCE.md) | SQL catalogue, dataset, execution plans, indexes and historical analysis |
| [PostgreSQL 18 comparison](docs/performance/comparison.md) | Captured baseline/optimized benchmark results |
| [PostgreSQL 17 comparison](docs/performance/pg17/comparison.md) | Historical cross-check results |
| [S3 storage](docs/STORAGE.md) | Private bucket/IAM setup, configuration, blob helpers and smoke test |
| [Phase 2 integration](docs/PHASE_TWO.md) | Riders, invitations, assignment, QR management, analytics, live updates and migration recovery |
| [Location tracking](docs/LOCATION_TRACKING.md) | Confirmed pickup/delivery points, device GPS, map trails and deployment |

[Historical backend blueprint](../BACKEND_QUICKSTART.md) is an older MongoDB/auth reference, **not** the installation guide for this server.
