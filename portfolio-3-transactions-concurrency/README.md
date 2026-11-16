# Portfolio 3 — Transactions and Concurrency

**Requirement:** commit, rollback, isolation and a concurrency issue/control mechanism, supported by executed output.

| Concept | Captured result |
| --- | --- |
| Commit | Customer, order and initial event persist together |
| Rollback | Deliberate fee-check failure leaves all three absent |
| READ COMMITTED | No dirty read; next reader statement sees the committed fee |
| Concurrency | Same expected PENDING status: one winner, one conflict, one cancellation event |

Read the [explanation and SQL](../docs/TRANSACTIONS.md), [full timestamped output](../docs/transactions/output.txt), [runner](../scripts/transactions/evidence.mjs) and [output highlight](evidence/transaction-output.txt). The second writer waits on a row lock, then affects zero rows after the first commits; the application maps that result to a conflict. The successful update and audit insertion share a transaction.

From the server root: `npm run transactions:evidence`. It requires PostgreSQL credentials with database-creation permission, creates a uniquely named disposable database, applies migrations and asserts the results before dropping only its own database. It must not be rewritten to target application tables.

**Limit:** existing output was captured on 12 November 2026 (PostgreSQL 18.6). It demonstrates the controlled scenario, not every isolation anomaly. No application assignments were changed for this portfolio arrangement.
