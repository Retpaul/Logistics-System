# Transaction and concurrency evidence

This report demonstrates commit, rollback, `READ COMMITTED` isolation and optimistic concurrency against the committed PostgreSQL schema. The [evidence runner](../scripts/transactions/evidence.mjs) executes SQL with assertions; [full captured output](transactions/output.txt) includes statements, synthetic parameters, database responses, database version and a UTC capture timestamp.

## Reproduce

From `server/`, with dependencies installed and PostgreSQL available:

```powershell
npm run transactions:evidence
```

The runner loads `.env`. It reuses the connection credentials from `DATABASE_URL`, or `TRANSACTION_ADMIN_URL` when supplied, but replaces the database name. The database role needs access to the `postgres` maintenance database and permission to create databases and apply migrations. No application queries or migrations run against the development database.

Each invocation creates a uniquely named `bike_dispatch_tx_<timestamp>_<random>` database, applies the real Prisma migrations and inserts synthetic data. Three independent connections perform the examples and verification. Finally, the runner closes these connections and drops only the database it created. It never truncates an existing database. A cleanup failure is reported with the disposable database name. Statement and lock timeouts prevent indefinite waits.

A failed assertion sets a nonzero exit code. Every invocation replaces `transactions/output.txt`; check for all four `PASS` lines and successful cleanup before treating it as evidence. Connection strings, credentials and subprocess migration output are excluded. UUIDs, names, addresses and phone values in the transcript are synthetic.

## 1. Commit: persist related records together

The runner begins a transaction, inserts a customer, order and initial `PENDING` event, then commits. An independent connection verifies that none is visible before commit and all three exist afterward.

Captured result excerpts:

```text
Before COMMIT: {"customers":0,"orders":0,"events":0}
After COMMIT:  {"customers":1,"orders":1,"events":1}
PASS commit: all three records persisted, verified from an independent connection.
```

This demonstrates the atomic write pattern used by [`placeOrder`](../services/orders.ts): `prisma.$transaction` encloses customer creation and order creation with its nested initial event. Prisma commits when the callback succeeds; an exception causes rollback. The runner executes explicit SQL against the real schema rather than calling the HTTP API or Prisma service.

## 2. Rollback: undo earlier successful writes

After inserting another customer, order and initial event inside a transaction, the runner attempts to set the delivery fee to `-1`. PostgreSQL rejects this using the real `Order_fee_nonnegative` CHECK constraint. The runner checks the error and explicitly rolls back the aborted transaction.

```sql
UPDATE "Order" SET "deliveryFee" = -1 WHERE id = $1;
ROLLBACK;
```

Captured result excerpts:

```text
Expected PostgreSQL error: 23514, constraint: Order_fee_nonnegative
After ROLLBACK: {"customers":0,"orders":0,"events":0}
PASS rollback: customer, order and event all absent.
```

The failed statement does not leave the earlier successful inserts behind. This is a real database constraint failure, not a mocked exception. The CHECK constraint is defined in the [schema migration](../prisma/migrations/20261105000200_checks/migration.sql).

## 3. Isolation: no dirty reads, fresh statement snapshots

Both connections explicitly begin with `ISOLATION LEVEL READ COMMITTED`. The transcript records both the server default and `SHOW transaction_isolation`; the demonstration does not assume the server default.

| Sequence | Connection A: writer | Connection B: reader |
| --- | --- | --- |
| 1 | Begin; change fee from 2500 to 3000 without committing | Begin |
| 2 | Keep transaction open | Read fee: `2500.00` |
| 3 | Commit | Keep the same reader transaction open |
| 4 | | Read fee again: `3000.00`; commit |

```text
transaction_isolation: read committed
PASS isolation: no dirty read; next statement in the same reader transaction sees the committed change.
```

B cannot see A's uncommitted change. After A commits, B's next statement sees the new value, even within the same transaction. `READ COMMITTED` provides statement snapshots; it does not promise repeatable reads across a whole transaction. Therefore reading a status and later updating solely by ID would leave a stale-read concurrency risk.

## 4. Concurrency: expected-status update prevents a duplicate event

Both writers read the same `PENDING` order. A then changes it using the conditional update below. Before A commits, B submits the identical update. The observer polls `pg_stat_activity` and asserts that B actually waits on a database lock; this is an overlapping two-connection test, not sequential requests.

```sql
UPDATE "Order"
SET status = 'CANCELLED'
WHERE id = $1 AND "tenantId" = $2 AND status = 'PENDING'
RETURNING status;
```

A inserts a `CANCELLED` event in the same transaction and commits. PostgreSQL then rechecks B's update against the committed row. Its expected-status predicate no longer matches, so B affects zero rows, inserts no event and rolls back.

Captured result excerpts:

```text
Writer A rowCount: 1
Observed B wait_event_type=Lock while A holds the order row.
Writer B rowCount: 0
Final: {"status":"CANCELLED","cancellation_events":1}
PASS concurrency: one winner, one conflict, exactly one cancellation event.
```

The SQL reproduces the control mechanism in [`ordersRepository.transition`](../repositories/orders.ts): tenant + ID + expected-status conditional update, followed by event insertion only when a row changed. [`cancelOrder`](../services/orders.ts) supplies the transaction and maps a zero-row result to `409 CONFLICT`. The runner verifies the SQL outcome; it does **not** claim to capture an HTTP 409 response.

The transaction makes status and audit history atomic; the conditional update detects a stale writer. A transaction alone would not make an unconditional update safe from lost-update behaviour. This status predicate is not a universal version counter: it would not detect a status changing away and back between requests. Future rider assignment must additionally enforce one active order per rider and exclusive claiming; those features are not implemented or evidenced here.

## Evidence boundaries

- Full executed SQL and responses: [transactions/output.txt](transactions/output.txt). The abbreviated excerpts above summarize those responses; the raw transcript is authoritative.
- Application source links explain how the demonstrated SQL corresponds to existing service behaviour. This runner is database evidence, not an end-to-end API test.
- These scenarios verify atomicity, visibility and a specific conflicting update. They do not establish throughput, serializable isolation, crash recovery or correctness for every possible interleaving.
- Screenshots are unnecessary for reproduction: the plain-text transcript is searchable and retains exact statements and outcomes.
- S3 configuration and the remaining Phase 2 implementation are outside this step.
