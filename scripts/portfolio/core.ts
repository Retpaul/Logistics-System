import { createHash, randomUUID } from "node:crypto";
import { createConnection, type Schema } from "mongoose";
import { mongoSchemas } from "../../models/mongo/index.js";

export type Entity = Exclude<keyof typeof mongoSchemas, "RefreshToken">;
export type SourceRow = Record<string, unknown> & { id: string };
export type Row = Record<string, unknown> & { _id: string };
export const emptySourceRows = (): Record<Entity, SourceRow[]> => ({
  Tenant: [],
  User: [],
  Rider: [],
  Bike: [],
  Customer: [],
  QrCode: [],
  QrScan: [],
  Order: [],
  StoredFile: [],
  OrderEvent: [],
  TrackingPoint: [],
  Payment: [],
});
export const ACTIVE = new Set(["ASSIGNED", "PICKED_UP", "IN_TRANSIT"]);
export class ImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export function requireImport(
  condition: unknown,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new ImportError(code, message);
}
export function schemasForImport() {
  return Object.entries(mongoSchemas)
    .filter(([name]) => name !== "RefreshToken")
    .map(([name, base]) => {
      // Separate profile projection. Never remove required hashes from the application's model.
      const schema: Schema =
        name === "User"
          ? mongoSchemas.User.omit(["passwordHash"])
          : name === "Rider"
            ? mongoSchemas.Rider.omit(["invitationHash"])
            : base.clone();
      schema.set("timestamps", false);
      schema.eachPath((_key, path) => {
        if (path.instance === "String" && !Object.hasOwn(path, "checkRequired"))
          Object.defineProperty(path, "checkRequired", {
            value: (v: unknown) => typeof v === "string",
          });
      });
      const indexes = schema
        .indexes()
        .filter(([keys]) => Object.keys(keys).every((key) => schema.paths[key]))
        .map(([keys, opts]) => ({
          keys: keys as Record<string, 1 | -1>,
          options: {
            ...(opts.name ? { name: opts.name } : {}),
            ...(opts.unique ? { unique: true } : {}),
            ...(opts.partialFilterExpression
              ? {
                  partialFilterExpression:
                    opts.partialFilterExpression as Record<string, unknown>,
                }
              : {}),
          },
        }));
      return {
        name: name as Entity,
        schema,
        collection: String(schema.options.collection),
        indexes,
      };
    });
}
export type Spec = ReturnType<typeof schemasForImport>[number];
export function selectOrders(
  pool: SourceRow[],
  tracked: Set<string>,
  limit = 20,
) {
  const epoch = (value: unknown) =>
    value instanceof Date ? value.getTime() : Date.parse(String(value));
  const sorted = [...pool].sort(
    (a, b) =>
      epoch(b.createdAt) - epoch(a.createdAt) || a.id.localeCompare(b.id),
  );
  const selected: SourceRow[] = [],
    activeRiders = new Set<string>();
  const add = (o: SourceRow | undefined) => {
    if (!o || selected.length >= limit || selected.some((x) => x.id === o.id))
      return false;
    const rider = String(o.riderId ?? "");
    if (rider && ACTIVE.has(String(o.status)) && activeRiders.has(rider))
      return false;
    selected.push(o);
    if (rider && ACTIVE.has(String(o.status))) activeRiders.add(rider);
    return true;
  };
  // Prefer a tracked active order so available location evidence is retained, then status coverage.
  add(
    sorted.find((o) => tracked.has(o.id) && ACTIVE.has(String(o.status))) ??
      sorted.find((o) => tracked.has(o.id)),
  );
  for (const status of [
    "PENDING",
    "ASSIGNED",
    "PICKED_UP",
    "IN_TRANSIT",
    "DELIVERED",
    "CANCELLED",
  ]) {
    for (const o of sorted.filter((o) => o.status === status))
      if (add(o)) break;
  }
  for (const o of sorted) add(o);
  return {
    selected,
    excludedActiveConflicts: sorted.filter(
      (o) =>
        !selected.some((x) => x.id === o.id) &&
        ACTIVE.has(String(o.status)) &&
        o.riderId &&
        activeRiders.has(String(o.riderId)),
    ).length,
  };
}

export interface SourceSnapshot {
  sourceFingerprint: string;
  tenantName: string;
  rows: Record<Entity, SourceRow[]>;
  sourceCounts: Record<string, number | "unavailable">;
  missingColumns: Partial<Record<Entity, string[]>>;
  unavailable: Entity[];
  selection: {
    limit: number;
    candidates: number;
    selected: number;
    excludedActiveConflicts: number;
  };
}
export function assertNoSecrets(value: unknown): void {
  if (!value || typeof value !== "object" || value instanceof Date) return;
  for (const [key, item] of Object.entries(value)) {
    requireImport(
      ![
        "passwordHash",
        "tokenHash",
        "invitationHash",
        "refreshToken",
        "password",
      ].includes(key),
      "SECRET_FIELD",
      "An excluded authentication field reached the reporting projection",
    );
    assertNoSecrets(item);
  }
}
export async function projectSnapshot(
  snapshot: SourceSnapshot,
  specs = schemasForImport(),
) {
  const connection = createConnection();
  const data = {} as Record<Entity, Row[]>;
  try {
    for (const spec of specs) {
      const Model = connection.model(
        `Portfolio${spec.name}`,
        spec.schema,
        spec.collection,
      );
      data[spec.name] = [];
      for (const original of snapshot.rows[spec.name]) {
        const { id, ...rest } = original;
        requireImport(!!id, "SOURCE_ID", "A source UUID is missing");
        assertNoSecrets(rest);
        const document = new Model({ _id: id, ...rest });
        try {
          await document.validate();
        } catch {
          throw new ImportError(
            "VALIDATION",
            `Source ${spec.name} record failed schema validation; values omitted`,
          );
        }
        const row = document.toObject({
          transform: false,
          virtuals: false,
          getters: false,
        }) as Row;
        assertNoSecrets(row);
        data[spec.name].push(row);
      }
    }
  } finally {
    await connection.destroy();
  }
  validateLinks(data);
  return data;
}
export function validateLinks(data: Record<Entity, Row[]>) {
  const lookup = Object.fromEntries(
    Object.entries(data).map(([name, rows]) => [
      name,
      new Map(rows.map((row) => [row._id, row])),
    ]),
  ) as Record<Entity, Map<string, Row>>;
  requireImport(
    data.Tenant.length === 1,
    "TENANT",
    "A portfolio sample must contain exactly one organisation",
  );
  const tenantId = data.Tenant[0]._id;
  const edge = (row: Row, field: string, target: Entity, nullable = false) => {
    const value = row[field];
    if (value == null && nullable) return;
    requireImport(
      typeof value === "string" && lookup[target].has(value),
      "REFERENCE",
      `Missing linked ${target} record; identifiers omitted`,
    );
    const parent = lookup[target].get(value)!;
    if ("tenantId" in row && "tenantId" in parent)
      requireImport(
        row.tenantId === parent.tenantId,
        "TENANT_REFERENCE",
        "Cross-organisation reference rejected",
      );
  };
  const active = new Set<string>();
  for (const [name, rows] of Object.entries(data)) {
    const ids = new Set<string>();
    for (const row of rows) {
      requireImport(
        !ids.has(row._id),
        "DUPLICATE_ID",
        `Duplicate source identity in ${name}`,
      );
      ids.add(row._id);
      if ("tenantId" in row)
        requireImport(
          row.tenantId === tenantId,
          "TENANT_REFERENCE",
          "Unexpected organisation in sample",
        );
      if (name === "Rider" || name === "StoredFile")
        edge(row, "userId", "User");
      if (name === "QrScan") edge(row, "qrCodeId", "QrCode");
      if (["OrderEvent", "TrackingPoint", "Payment"].includes(name))
        edge(row, "orderId", "Order");
      if (name === "Order") {
        edge(row, "customerId", "Customer");
        edge(row, "riderId", "Rider", true);
        edge(row, "bikeId", "Bike", true);
        edge(row, "qrCodeId", "QrCode", true);
        edge(row, "proofFileId", "StoredFile", true);
        if (row.riderId && ACTIVE.has(String(row.status))) {
          requireImport(
            !active.has(String(row.riderId)),
            "ACTIVE_CONFLICT",
            "Sample includes competing active rider assignments",
          );
          active.add(String(row.riderId));
        }
      }
    }
  }
}
export function canonical(value: unknown): unknown {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (
    value &&
    typeof value === "object" &&
    "_bsontype" in value &&
    value._bsontype === "Decimal128"
  )
    return { $decimal: String(value) };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export const fingerprint = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
export interface Manifest {
  _id: string;
  version: 1;
  sourceFingerprint: string;
  contentHash: string;
  status: "pending" | "running" | "failed" | "complete";
  entries: Record<string, { id: string; hash: string }[]>;
  leaseOwner?: string;
  leaseUntil?: Date;
  errorCode?: string;
}
export interface Target {
  getManifest(id: string): Promise<Manifest | null>;
  createManifest(manifest: Manifest): Promise<void>;
  acquire(id: string, owner: string): Promise<boolean>;
  renew(id: string, owner: string): Promise<void>;
  finish(
    id: string,
    owner: string,
    status: "complete" | "failed",
    errorCode?: string,
  ): Promise<void>;
  ensureCollection(spec: Spec): Promise<void>;
  findRows(collection: string, ids: string[]): Promise<Row[]>;
  insertMissing(collection: string, rows: Row[]): Promise<number>;
}
export interface Receipt {
  capturedAt: string;
  importId: string;
  status: "verified";
  sourceDataset: string;
  selection: SourceSnapshot["selection"];
  sourceCounts: SourceSnapshot["sourceCounts"];
  collections: Record<
    string,
    {
      collection: string;
      source: "available" | "unavailable";
      selected: number;
      inserted: number;
      verified: number;
      missingColumns: string[];
    }
  >;
  checks: {
    contentEquality: true;
    uuidAndReferences: true;
    secretsExcluded: true;
    legacyLocationHonest: true;
    sourceReadOnly: true;
  };
}
/** Insert-once upserts never replace target documents, even after a race or a partial failure. */
export async function copySnapshot(
  snapshot: SourceSnapshot,
  data: Record<Entity, Row[]>,
  target: Target,
  specs = schemasForImport(),
): Promise<Receipt> {
  assertNoSecrets(data);
  validateLinks(data);
  const ordered = Object.fromEntries(
    Object.entries(data).map(([name, rows]) => [
      name,
      [...rows].sort((a, b) => a._id.localeCompare(b._id)),
    ]),
  );
  const contentHash = fingerprint(ordered),
    importId = fingerprint({
      version: 1,
      source: snapshot.sourceFingerprint,
      contentHash,
    });
  const entries = Object.fromEntries(
    specs.map((spec) => [
      spec.collection,
      data[spec.name].map((row) => ({ id: row._id, hash: fingerprint(row) })),
    ]),
  );
  const previous = await target.getManifest(importId);
  if (previous) {
    requireImport(
      previous.version === 1 &&
        previous.sourceFingerprint === snapshot.sourceFingerprint &&
        previous.contentHash === contentHash &&
        fingerprint(previous.entries) === fingerprint(entries),
      "MANIFEST",
      "Import manifest differs from this source projection",
    );
  }
  for (const spec of specs) {
    const existing = await target.findRows(
      spec.collection,
      data[spec.name].map((r) => r._id),
    );
    requireImport(
      previous || existing.length === 0,
      "COLLISION",
      "A target UUID already exists outside this import; nothing will be overwritten",
    );
    for (const row of existing) {
      const expected = data[spec.name].find((r) => r._id === row._id);
      requireImport(
        expected && fingerprint(expected) === fingerprint(row),
        "CONTENT_CONFLICT",
        "A target record differs from its expected import content; nothing will be overwritten",
      );
    }
  }
  if (!previous)
    await target.createManifest({
      _id: importId,
      version: 1,
      sourceFingerprint: snapshot.sourceFingerprint,
      contentHash,
      status: "pending",
      entries,
    });
  const owner = randomUUID();
  requireImport(
    await target.acquire(importId, owner),
    "BUSY",
    "This sample import is already running; retry after its lease expires",
  );
  const receipt: Receipt = {
    capturedAt: new Date().toISOString(),
    importId,
    status: "verified",
    sourceDataset: snapshot.tenantName,
    selection: snapshot.selection,
    sourceCounts: snapshot.sourceCounts,
    collections: {},
    checks: {
      contentEquality: true,
      uuidAndReferences: true,
      secretsExcluded: true,
      legacyLocationHonest: true,
      sourceReadOnly: true,
    },
  };
  try {
    for (const spec of specs) {
      await target.renew(importId, owner);
      await target.ensureCollection(spec);
      const rows = data[spec.name];
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 100) {
        await target.renew(importId, owner);
        inserted += await target.insertMissing(
          spec.collection,
          rows.slice(i, i + 100),
        );
      }
      const actual = await target.findRows(
        spec.collection,
        rows.map((r) => r._id),
      );
      requireImport(
        actual.length === rows.length,
        "COUNT",
        "Target row count does not match the selected source sample",
      );
      for (const row of actual) {
        assertNoSecrets(row);
        const expected = rows.find((r) => r._id === row._id);
        requireImport(
          expected && fingerprint(expected) === fingerprint(row),
          "RECONCILIATION",
          "Target field values differ; no success receipt will be written",
        );
      }
      receipt.collections[spec.name] = {
        collection: spec.collection,
        source: snapshot.unavailable.includes(spec.name)
          ? "unavailable"
          : "available",
        selected: rows.length,
        inserted,
        verified: actual.length,
        missingColumns: snapshot.missingColumns[spec.name] ?? [],
      };
    }
    await target.finish(importId, owner, "complete");
    return receipt;
  } catch (error) {
    await target
      .finish(
        importId,
        owner,
        "failed",
        error instanceof ImportError ? error.code : "TARGET_ERROR",
      )
      .catch(() => {});
    throw error;
  }
}
