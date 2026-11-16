# EcoDispatch — Logistics System: Portfolio Report

**Selected organisation/project:** EcoDispatch — Logistics System  
**Student name / ID:** ________________________  
**GitHub repository:** [Retpaul/Logistics-System](https://github.com/Retpaul/Logistics-System.git)  
**Evidence date:** 15 November 2026

## 1. Organisation, problem and system scope

EcoDispatch is the logistics system developed for this portfolio. Its purpose is to organise delivery requests, allocate couriers, maintain delivery histories and give customers visibility of their orders. The intended users are business owners, dispatchers, couriers and customers. Typical objectives include reducing fragmented manual records, preventing conflicting assignments and making operational information easier to retrieve and audit.

The project addresses the logistics side of the ride-hailing/logistics brief. Drivers are represented as couriers with the RIDER role; customers are bookers or recipients; trips correspond to delivery orders. It does not implement passenger ride-hailing. The demonstration organisation stored in the database remains named **Demo Couriers**; it has not been renamed or presented as a live commercial customer.

Customers can request deliveries through a business QR booking link, while staff can create orders directly. Request matching is implemented through dispatcher assignment or rider claiming, rather than automatic nearest-driver allocation. The intended lifecycle is PENDING → ASSIGNED → PICKED_UP → IN_TRANSIT → DELIVERED, with cancellation and pre-pickup decline rules. Related events retain an audit history. Tenant identity comes from authenticated context or the public booking/tracking code, separating organisations' records.

## 2. Portfolio 1 — Database design

PostgreSQL is the operational database, accessed through Prisma. Thirteen models cover organisations, user profiles, refresh tokens, riders, bikes, customers, QR codes, scans, orders, files, events, tracking points and payments. Foreign keys, checks and indexes support relationships and stored-data integrity. Delivery fees and payment amounts use exact decimals; dates and UUIDs provide consistent record identification and ordering.

## 3. Portfolio 4 — NoSQL model and verified sample

MongoDB provides a document-based portfolio copy using Mongoose schemas. One collection per model preserves references and simplifies comparison with PostgreSQL. Events and tracking points remain separate rather than growing indefinitely inside an order document. Decimal128 preserves monetary precision, and source UUIDs become string `_id` values. MongoDB is suitable for a later read model or reporting experiment, but this work does not establish that it is faster or a replacement for PostgreSQL. References do not automatically enforce foreign keys or tenant ownership.

On the evidence date, PostgreSQL contained 32 orders across three organisations. The importer selected Demo Couriers, the organisation with the largest order dataset, and copied 20 of its 30 candidate orders with linked records. Selection prioritised status coverage and available tracking evidence. Two conflicting active assignments were excluded from the sample to retain at most one active order per rider. Their PostgreSQL records and history were preserved.

| MongoDB record group | Verified documents |
| --- | ---: |
| Organisation / user profiles | 1 / 3 |
| Rider / bike / customers | 1 / 1 / 5 |
| QR code / linked scans | 1 / 0 |
| Delivery orders / status events | 20 / 89 |
| Legacy tracking points | 1 |
| Payments / stored files | 0 / 0 |
| **Total business documents** | **122** |

Zero payments reflects an empty source table. Stored files were unavailable because the source table was missing; these are different findings. Source location-provenance and endpoint-coordinate columns were also unavailable. Unknown endpoints remain null, and the historical location is labelled LEGACY, not live GPS. No transactions, files or coordinates were fabricated to improve the demonstration.

The source was read in a consistent, read-only transaction. Validation and reconciliation checked UUIDs, references, statuses, decimals, dates and complete projected document contents. Password hashes, invitation hashes and refresh tokens were excluded; a separate redacted User projection avoided weakening the authentication model. MongoDB writes use insert-only upserts and an import manifest. The first run inserted 122 documents; the repeat run verified the same sample and inserted zero. The [initial receipt](portfolio/initial-import-summary.json), [repeat receipt](portfolio/import-summary.json) and [read-only verification](portfolio/verification-summary.json) contain counts and checks without personal record values or connection credentials.

## 4. Portfolios 2–3 — Optimisation and transactions

The implementation separates HTTP handling, business rules, persistence and shared contracts. Assignment and claiming use transactions and conditional updates; the database design additionally defines one active order per rider. Existing [transaction evidence](TRANSACTIONS.md) demonstrates commit, rollback, READ COMMITTED visibility and one winning concurrent status update with one audit event.

Historical [performance evidence](PERFORMANCE.md) uses a separate synthetic one-million-order dataset. For example, the newest-orders query's recorded p95 improved from 232 ms to 0.95 ms after indexing. These are database benchmark results, not timings for this MongoDB sample or proof of end-to-end API latency. Keeping benchmark evidence separate from migration evidence avoids misleading comparisons.

A key technical lesson is that successful data transfer requires more than matching counts. Identity, relationship closure, nullability, precision and confidential fields must also be checked. A schema can express structure while still failing to reproduce another database's referential or transactional guarantees. Repeatable imports and refusal to overwrite unrelated target records make recovery safer than unconditional replacement.

Current limitations remain visible. The application still reads and writes PostgreSQL; the MongoDB copy is not continuously synchronised or usable as a login database. Local Phase 2 activation remains blocked by preserved conflicting assignments. Foreground GPS, map updates and proof-upload code exist, but this imported historical point does not prove real-device tracking or deployed AWS operation. Payment records are modelled; Stripe/card processing and collected-payment evidence are not implemented.

## 5. Individual reflection — personalise before submission

My main contribution was **[describe the work you personally completed]**. The most significant challenge I encountered was **[describe your actual experience]**, which I addressed by **[explain your approach and evidence]**. This project helped me understand the distinction between relational integrity and document validation, and why a retry must not duplicate or silently replace records. My next improvement would be **[choose and justify a realistic next step]**, supported by testing rather than assumptions about production readiness.

## 6. Suggested screenshots and supporting evidence

Choose **3–4** figures for the report; place additional evidence separately to retain approximately 2–3 pages, depending on formatting.

1. **Copy verification:** initial/repeat receipts showing 122 verified documents and zero repeat inserts. Hide connection details.
2. **Linked records:** PostgreSQL and MongoDB order UUIDs alongside the matching rider/customer references. Hide names, phones, addresses and precise coordinates.
3. **Database design:** the relational ER diagram and corresponding MongoDB collections/indexes.
4. **Correctness:** commit/rollback output and the concurrent-update result with one winner.
5. **Optimisation:** an execution-plan excerpt and its matching before/after timing, labelled historical.
6. **Application workflow:** assignment, status and tracking screens only after local rollout works; use real-device evidence before calling a map live.

References and AI-use details: [declaration](../final-documentation/references-and-ai-use.md). Portfolio 5 remains outside this arrangement; deployment and cloud-database assessment evidence are not claimed complete.
