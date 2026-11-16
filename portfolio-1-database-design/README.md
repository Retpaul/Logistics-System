# Portfolio 1 — Database Design and Modelling

**Requirement:** case study, ERD, relational schema, keys, constraints and normalisation.

| Item | Implementation / evidence |
| --- | --- |
| Organisation, users and operations | [Case study](case-study.md) |
| All 13 models, keys, checks and 1NF–3NF discussion | [Database guide](../docs/DATABASE.md) |
| Relational schema and executable constraints | [Prisma schema](../prisma/schema.prisma), [SQL migrations](../prisma/migrations/) |
| Current ER export | [Diagram](evidence/er-diagram.svg), [editable source](evidence/er-diagram.mmd) |

From the server root: `npm run db:validate` validates Prisma; `node scripts/check-portfolio-docs.mjs` checks portfolio links and ER model coverage. These do not deploy migrations.

**Limit:** the diagram represents the committed design. Local migration conflict remains unresolved. Composite tenant FKs, the active-rider partial index, RefreshToken delete cascade and the unenforced proofFileId reference are explained explicitly in the guide.
