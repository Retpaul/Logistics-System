# Bike Dispatch backend: PostgreSQL + Prisma

Uses the layered approach in `../BACKEND_QUICKSTART.md`, replacing MongoDB/Mongoose with Prisma repositories. That original document is a Mongo reference, not the installation guide for this backend. Express 5 already forwards async handler failures; do not add Express 4's `express-async-errors` patch. This starter supplies the database foundation and health endpoints, not the reference guide's complete authentication implementation.

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
npm run dev
```

`db:deploy` applies committed migrations. For subsequent schema edits use `npm run db:migrate -- --name describe_change` against a development database, then `npm run db:generate`. Development migration creation requires permission to create a shadow database (or a separately configured shadow database). Do not run migration resets against production. Do not use db push as a substitute for the migration containing CHECK constraints.

GET http://localhost:8001/api/v1/health reports process health. GET `/api/v1/ready` runs SELECT 1 and returns 503 on connection failure. Readiness checks connectivity, not migration currency. The HTTP server starts even when PostgreSQL is unavailable. Startup logs avoid printing connection strings.

Build with `npm run build`, then `npm start`. Generate Prisma Client before building in CI. `npm run db:studio` opens the data browser.

## Structure

- `prisma/schema.prisma`: models, keys, enums, relations and indexes.
- `prisma/migrations`: executable PostgreSQL schema and additional CHECK constraints.
- `prisma.config.ts`: Prisma CLI connection configuration (loads .env).
- `config/`: runtime environment configuration.
- `startup/db.ts`: one shared Prisma client using the PostgreSQL driver adapter.
- `repositories/`: database access; the order example always filters by tenant.
- `app.ts`: Express startup, health/readiness and graceful shutdown.
- `docs/DATABASE.md`: ER diagram, relational schema, normalisation and diagram tooling.

The CLI configuration reads DATABASE_URL independently of runtime config. Application code reads environment variables only in config. Follow routes → validation/middleware → controllers → services → repositories when adding business endpoints. Hash passwords explicitly before creating users: Prisma does not run Mongoose pre-save hooks.
