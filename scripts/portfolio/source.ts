import pg from "pg";
import {
  emptySourceRows,
  fingerprint,
  requireImport,
  schemasForImport,
  selectOrders,
  type Entity,
  type SourceRow,
  type SourceSnapshot,
} from "./core.js";

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const strings = (rows: SourceRow[], key: string) => [
  ...new Set(
    rows.map((r) => r[key]).filter((v): v is string => typeof v === "string"),
  ),
];
export async function readSnapshot(url: string): Promise<SourceSnapshot> {
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 10000,
    query_timeout: 30000,
  });
  await client.connect();
  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    await client.query("SET LOCAL statement_timeout='30s'");
    const inventory = (
      await client.query<{ table_name: string; column_name: string }>(
        "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'",
      )
    ).rows;
    const columns = new Map<string, Set<string>>();
    for (const row of inventory) {
      if (!columns.has(row.table_name)) columns.set(row.table_name, new Set());
      columns.get(row.table_name)!.add(row.column_name);
    }
    requireImport(
      columns.has("Tenant") && columns.has("Order"),
      "SOURCE_SCHEMA",
      "Source Tenant and Order tables are required",
    );
    const specs = schemasForImport();
    const snapshot: SourceSnapshot = {
      sourceFingerprint: "",
      tenantName: "",
      rows: emptySourceRows(),
      sourceCounts: {},
      missingColumns: {},
      unavailable: [],
      selection: {
        limit: 20,
        candidates: 0,
        selected: 0,
        excludedActiveConflicts: 0,
      },
    };
    for (const spec of specs) {
      if (!columns.has(spec.name)) {
        snapshot.unavailable.push(spec.name);
        snapshot.sourceCounts[spec.name] = "unavailable";
        continue;
      }
      snapshot.sourceCounts[spec.name] = Number(
        (await client.query(`SELECT count(*) AS n FROM ${quote(spec.name)}`))
          .rows[0].n,
      );
    }
    const tenant = (
      await client.query<{ id: string }>(
        `SELECT t.id FROM "Tenant" t LEFT JOIN "Order" o ON o."tenantId"=t.id GROUP BY t.id ORDER BY count(o.id) DESC,t.id LIMIT 1`,
      )
    ).rows[0];
    requireImport(tenant, "NO_DATA", "No source organisation exists");
    const origin = new URL(url);
    snapshot.sourceFingerprint = fingerprint({
      host: origin.hostname,
      port: origin.port || "5432",
      database: origin.pathname,
      tenant: tenant.id,
    });
    async function read(
      name: Entity,
      where: string,
      params: unknown[],
      tail = "",
    ): Promise<SourceRow[]> {
      if (!columns.has(name)) return [];
      const spec = specs.find((s) => s.name === name)!;
      const existing = columns.get(name)!;
      const missing = Object.keys(spec.schema.paths)
        .map((k) => (k === "_id" ? "id" : k))
        .filter((k) => !existing.has(k));
      snapshot.missingColumns[name] = missing;
      for (const field of missing) {
        const path = spec.schema.paths[field === "id" ? "_id" : field];
        requireImport(
          !path.options.required ||
            (name === "TrackingPoint" && field === "source"),
          "SOURCE_SCHEMA",
          `Required source field unavailable: ${name}.${field}`,
        );
      }
      const fields = Object.entries(spec.schema.paths)
        .map(([key, path]) => ({
          key: key === "_id" ? "id" : key,
          decimal: path.instance === "Decimal128",
        }))
        .filter((p) => existing.has(p.key));
      const list = fields
        .map(
          (p) =>
            `${quote(p.key)}${p.decimal ? `::text AS ${quote(p.key)}` : ""}`,
        )
        .join(",");
      const result = (
        await client.query<SourceRow>(
          `SELECT ${list} FROM ${quote(name)} WHERE ${where} ${tail}`,
          params,
        )
      ).rows;
      requireImport(
        result.length <= 10000,
        "SAMPLE_LIMIT",
        `Linked ${name} records exceed the portfolio safety limit`,
      );
      if (name === "TrackingPoint" && !existing.has("source"))
        for (const row of result) row.source = "LEGACY";
      return result;
    }
    snapshot.rows.Tenant = await read("Tenant", "id=$1", [tenant.id]);
    snapshot.tenantName = String(snapshot.rows.Tenant[0].name);
    const pool = await read(
      "Order",
      '"tenantId"=$1',
      [tenant.id],
      `ORDER BY ${columns.has("TrackingPoint") ? `EXISTS(SELECT 1 FROM "TrackingPoint" p WHERE p."orderId"="Order".id) DESC,` : ""} "createdAt" DESC,id LIMIT 500`,
    );
    const tracked = columns.has("TrackingPoint")
      ? (
          await client.query<{ orderId: string }>(
            `SELECT DISTINCT "orderId" FROM "TrackingPoint" WHERE "orderId"=ANY($1::uuid[])`,
            [pool.map((o) => o.id)],
          )
        ).rows.map((r) => r.orderId)
      : [];
    const selection = selectOrders(pool, new Set(tracked));
    snapshot.rows.Order = selection.selected;
    snapshot.selection = {
      limit: 20,
      candidates: pool.length,
      selected: selection.selected.length,
      excludedActiveConflicts: selection.excludedActiveConflicts,
    };
    const orderIds = selection.selected.map((o) => o.id);
    snapshot.rows.Customer = await read("Customer", "id=ANY($1::uuid[])", [
      strings(selection.selected, "customerId"),
    ]);
    snapshot.rows.Rider = await read("Rider", "id=ANY($1::uuid[])", [
      strings(selection.selected, "riderId"),
    ]);
    snapshot.rows.Bike = await read("Bike", "id=ANY($1::uuid[])", [
      strings(selection.selected, "bikeId"),
    ]);
    snapshot.rows.QrCode = await read("QrCode", "id=ANY($1::uuid[])", [
      strings(selection.selected, "qrCodeId"),
    ]);
    for (const entity of ["OrderEvent", "TrackingPoint", "Payment"] as const)
      snapshot.rows[entity] = await read(entity, '"orderId"=ANY($1::uuid[])', [
        orderIds,
      ]);
    snapshot.rows.QrScan = await read("QrScan", '"qrCodeId"=ANY($1::uuid[])', [
      snapshot.rows.QrCode.map((q) => q.id),
    ]);
    snapshot.rows.StoredFile = await read(
      "StoredFile",
      "\"tenantId\"=$1 AND (id=ANY($2::uuid[]) OR (\"userId\"=ANY($3::uuid[]) AND purpose IN ('LICENSE','INSURANCE')))",
      [
        tenant.id,
        strings(selection.selected, "proofFileId"),
        strings(snapshot.rows.Rider, "userId"),
      ],
    );
    const owners = [
      ...new Set([
        ...strings(snapshot.rows.Rider, "userId"),
        ...strings(snapshot.rows.StoredFile, "userId"),
      ]),
    ];
    snapshot.rows.User = await read(
      "User",
      '"tenantId"=$1 AND (id=ANY($2::uuid[]) OR id IN (SELECT DISTINCT ON(role) id FROM "User" WHERE "tenantId"=$1 AND role IN (\'OWNER\',\'DISPATCHER\') ORDER BY role,id))',
      [tenant.id, owners],
    );
    await client.query("COMMIT");
    return snapshot;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}
