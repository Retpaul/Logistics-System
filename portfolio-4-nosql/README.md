# Portfolio 4 — NoSQL and Advanced Data Models

**Requirement:** a NoSQL model for the same case study, an example, implementation evidence and suitability.

- [13 typed Mongoose models](../models/mongo/), [mapping, suitability and enforcement differences](../docs/MONGODB_MODELS.md).
- [Redacted document example](evidence/order-example.json): illustrative values, not a newly captured record; [verified collection/index summary](evidence/verified-sample.json) copied from the timestamped receipt.
- [Importer](../scripts/import-portfolio.ts), [verifier](../scripts/verify-portfolio.ts), [implementation](../scripts/portfolio/), [import safety tests](../test/portfolio-import.test.ts) and [model tests](../test/mongo-models.test.ts).
- Executed receipts: [initial copy](../docs/portfolio/initial-import-summary.json), [repeat run](../docs/portfolio/import-summary.json), [independent verification](../docs/portfolio/verification-summary.json).

**Verified result:** 122 business documents, including 20 orders and 89 events; 42 indexes present; zero secret fields; zero repeat inserts. UUID strings retain relationships, Decimal128 preserves decimals, and growing histories stay separate. Password/invitation hashes and refresh tokens are excluded. Payment is empty in the source; StoredFile is unavailable, not verified empty. The single tracking point is legacy, not verified GPS.

From the server root: `npm run test:models` and `npm run test:portfolio` run offline. `npm run portfolio:verify` reconciles the configured databases read-only and writes a local receipt. `npm run portfolio:import` **writes MongoDB**; consult the guide before explicitly repeating it. Neither changes PostgreSQL records.

**Suitability/limits:** document collections support flexible reporting projections; retaining UUID references simplifies comparison. Mongoose references do not enforce relational FKs, cascades or tenant ownership. This is a reporting sample, not live replication or replacement authentication data. Additional graph/key-value implementations are unnecessary for this portfolio.

Optional screenshots: MongoDB collections, the active-rider partial index and a matching source/destination UUID. Hide personal fields and connection details. Existing receipts supply output evidence; no Compass screenshots are represented as captured.
