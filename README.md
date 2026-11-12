# Bike Dispatch backend: PostgreSQL + Prisma

Uses the layered approach in `../BACKEND_QUICKSTART.md`, replacing MongoDB/Mongoose with Prisma repositories. That original document is a Mongo reference, not the installation guide for this backend. Express 5 already forwards async handler failures; do not add Express 4's `express-async-errors` patch. It provides JWT authentication with rotating refresh cookies, organisations (tenants), orders, public QR booking and public tracking. Email verification, 2FA, riders, payments and live updates are later phases.

## Run locally

Use Node 22.12+ and PostgreSQL. Dependencies use the Prisma 7 line to retain schema.prisma and PrismaClient APIs. `package-lock.json` pins the installed versions.

From `server`:

```powershell
npm install
Copy-Item .env.example .env
```

Create an empty development database using pgAdmin or psql:

```sql
CREATE DATABASE bike_dispatch;
```

Set DATABASE_URL in `.env` to your actual PostgreSQL username/password/host/database. URL-encode special characters in credentials. Use provider-required TLS settings for hosted databases. Do not commit credentials. No working database credentials are supplied by this repository.

```powershell
npm run db:generate
npm run db:validate
npm run db:deploy
npm run typecheck
npm run db:seed:dev   # optional demo organisation, logins and QR codes
npm run dev
```

Set `JWT_ACCESS_SECRET` in `.env` (see `.env.example`). Without it, development uses a random secret and everyone is signed out whenever the server restarts; production refuses to start.

Demo logins after `db:seed:dev` (password `Demo1234!`): `owner@demo.test`, `dispatcher@demo.test`, `rider@demo.test`. QR booking links: `/book?qr=demo-lekki`, `/book?qr=demo-ikeja`.

`npm test` runs the API tests (Vitest + Supertest). It creates, migrates and empties a separate `bike_dispatch_test` database on the same server as `DATABASE_URL`.

`db:deploy` applies committed migrations. For subsequent schema edits use `npm run db:migrate -- --name describe_change` against a development database, then `npm run db:generate`. Development migration creation requires permission to create a shadow database (or a separately configured shadow database). Do not run migration resets against production. Do not use db push as a substitute for the migration containing CHECK constraints.

GET http://localhost:8001/api/v1/health reports process health. GET `/api/v1/ready` runs SELECT 1 and returns 503 on connection failure. Readiness checks connectivity, not migration currency. The HTTP server starts even when PostgreSQL is unavailable. Startup logs avoid printing connection strings.

Build with `npm run build`, then `npm start` (entry point `build/server.js`). Generate Prisma Client before building in CI. `npm run db:studio` opens the data browser.

## API (`/api/v1`)

Every response uses the envelope in `contracts/envelope.ts`: `{ success: true, data }` or `{ success: false, code, message, details? }`.

| Method & path | Who | Purpose |
| --- | --- | --- |
| `POST /auth/signup` | public | Create an organisation and its OWNER; returns an access token and sets the `bd_refresh` httpOnly cookie |
| `POST /auth/login` | public | `409 TENANT_REQUIRED` lists organisations when one email belongs to several; resend with `tenantSlug` |
| `POST /auth/refresh` · `POST /auth/logout` | refresh cookie | Rotate the refresh token (reuse revokes the session family) · end the session |
| `GET /auth/me` | signed in | User, role and organisation branding |
| `GET /tenant` · `PATCH /tenant` | signed in · OWNER | Read or update name, tagline, colours, currency |
| `GET /orders` · `POST /orders` | OWNER, DISPATCHER | Newest-first list with `status`, `riderId`, `from`/`to`, `q`, `cursor`, `limit` · create an order |
| `GET /orders/:id` · `POST /orders/:id/cancel` | OWNER, DISPATCHER | Detail with timeline · cancel (PENDING or ASSIGNED only) |
| `GET /public/qr/:code` · `POST /public/qr/:code/orders` | public | QR landing data (branding, prices) · customer booking |
| `GET /public/track/:trackingCode` | public | Status, timeline and last GPS point; no phone numbers |

Tenant isolation: the tenant comes from the access token (staff and riders) or from the QR or tracking code (public pages), never from a request body. Every repository function takes `tenantId` first, and another tenant's id answers 404.

## Structure

- `prisma/schema.prisma`: models, keys, enums, relations and indexes.
- `prisma/migrations`: executable PostgreSQL schema and additional CHECK constraints.
- `prisma.config.ts`: Prisma CLI connection configuration (loads .env).
- `contracts/`: the shared API contract (Zod schemas, enums, envelope). The client copies it with `npm run contracts:sync`; `lib/contractParity.ts` fails the typecheck if its enums drift from Prisma's.
- `config/`: runtime environment configuration.
- `startup/db.ts`: one shared Prisma client using the PostgreSQL driver adapter.
- `routes/` → `controllers/` → `services/` → `repositories/`: request handling layers; `services/orderStatus.ts` owns the order status rules.
- `middleware/`: authentication, role guard, rate limits, error envelope.
- `lib/`: errors, response helper, tokens, password hashing.
- `app.ts`: builds the Express app (used by tests); `server.ts`: listens and shuts down gracefully.
- `test/`: API tests; `scripts/seed-dev.ts`: demo data.
- `docs/DATABASE.md`: ER diagram, relational schema, normalisation and diagram tooling.
- `docs/PERFORMANCE.md`: API SQL queries, results, execution plans, indexing evidence and performance analysis at 1M orders.
- `sql/perf/`, `scripts/perf/`: synthetic dataset, query catalogue and benchmark runner (`npm run perf:seed`, `perf:bench`, `perf:compare`). Development databases only.

The CLI configuration reads DATABASE_URL independently of runtime config. Application code reads environment variables only in config. Follow routes → validation/middleware → controllers → services → repositories when adding business endpoints. Hash passwords explicitly (`lib/password.ts`) before creating users: Prisma does not run Mongoose pre-save hooks.
