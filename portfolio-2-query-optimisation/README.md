# Portfolio 2 — Query Processing and Optimisation

**Requirement:** SQL, results, execution plans, indexing evidence and brief analysis.

- [15 SQL queries](../sql/perf/queries.sql); [baseline](../sql/perf/indexes_baseline.sql) / [optimised indexes](../sql/perf/indexes_optimised.sql).
- [Method, index costs and analysis](../docs/PERFORMANCE.md); [PG18 comparison](../docs/performance/comparison.md); [PG17 cross-check](../docs/performance/pg17/comparison.md).
- Raw PG18 [before results](../docs/performance/baseline/results.json) / [after results](../docs/performance/optimised/results.json), including result samples; [before plans](../docs/performance/baseline/plans/) / [after plans](../docs/performance/optimised/plans/).
- [Evidence figure](evidence/comparison.svg): selected historical timings; use with the Q03 [before](../docs/performance/baseline/plans/Q03.txt) / [after](../docs/performance/optimised/plans/Q03.txt) plans.

Q03 newest orders and Q13 phone search benefit from selective ordered indexes. Q10 rider analytics improves but still misses the 300 ms p95 target on default settings; Q05 is effectively unchanged/slightly slower. Indexes also increase storage (218→377 MB) and insert WAL (~19%). Current analytics uses stored delivery timestamps; the historical event-join plans remain unchanged for traceability.

**Reproduction:** commands run from the server root. Follow the exact configuration/arguments in the [performance guide](../docs/PERFORMANCE.md) using a **separate disposable performance database**: `npm run perf:seed`, `npm run perf:bench`, `npm run perf:compare`. Inspect [seed](../scripts/perf/seed.mjs), [benchmark](../scripts/perf/bench.mjs) and [comparison](../scripts/perf/compare.mjs) before running; seeding/index changes are not read-only. Never point these at development data.

**Limit:** this is a historical synthetic million-order benchmark, not the current application database, MongoDB sample or end-to-end API latency. No new benchmark was run for this arrangement.
