import { describe, expect, it } from "vitest";
import { mongo } from "mongoose";
import { mongoSchemas } from "../models/mongo/index.js";
import {
  emptySourceRows,
  assertNoSecrets,
  canonical,
  copySnapshot,
  fingerprint,
  projectSnapshot,
  schemasForImport,
  selectOrders,
  type Manifest,
  type Row,
  type SourceSnapshot,
  type Spec,
  type Target,
} from "../scripts/portfolio/core.js";

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const when = new Date("2025-01-02T03:04:05.678Z");
function fixture(): SourceSnapshot {
  const rows = emptySourceRows();
  rows.Tenant = [
    {
      id: uuid(1),
      name: "Synthetic dataset",
      subdomain: "synthetic",
      createdAt: when,
    },
  ];
  rows.User = [
    {
      id: uuid(2),
      tenantId: uuid(1),
      email: "rider@example.test",
      firstName: "Test",
      lastName: "Rider",
      role: "RIDER",
      createdAt: when,
      updatedAt: when,
    },
  ];
  rows.Rider = [
    {
      id: uuid(3),
      tenantId: uuid(1),
      userId: uuid(2),
      available: true,
      onboardingStatus: "APPROVED",
    },
  ];
  rows.Customer = [
    { id: uuid(4), tenantId: uuid(1), name: "Synthetic", phone: "" },
  ];
  rows.QrCode = [
    { id: uuid(5), tenantId: uuid(1), code: "sample", label: "Synthetic" },
  ];
  rows.Order = [
    {
      id: uuid(6),
      tenantId: uuid(1),
      customerId: uuid(4),
      riderId: uuid(3),
      qrCodeId: uuid(5),
      trackingCode: "synthetic-order",
      pickupAddress: "Synthetic pickup",
      deliveryAddress: "Synthetic destination",
      recipientName: "Synthetic",
      recipientPhone: "",
      status: "IN_TRANSIT",
      deliveryFee: "1234567890.12",
      createdAt: when,
      updatedAt: when,
    },
  ];
  rows.OrderEvent = [
    { id: uuid(7), orderId: uuid(6), status: "IN_TRANSIT", createdAt: when },
  ];
  rows.TrackingPoint = [
    {
      id: uuid(8),
      orderId: uuid(6),
      latitude: "52.520000",
      longitude: "13.405000",
      recordedAt: when,
    },
  ];
  return {
    sourceFingerprint: "synthetic-source",
    tenantName: "Synthetic dataset",
    rows,
    sourceCounts: { Order: 1, Payment: 0, StoredFile: "unavailable" },
    missingColumns: { TrackingPoint: ["source", "accuracy"] },
    unavailable: ["StoredFile"],
    selection: {
      limit: 20,
      candidates: 3,
      selected: 1,
      excludedActiveConflicts: 2,
    },
  };
}
function clone<T>(value: T): T {
  return mongo.BSON.deserialize(mongo.BSON.serialize(value as object)) as T;
}
class MemoryTarget implements Target {
  records = new Map<string, Map<string, Row>>();
  manifests = new Map<string, Manifest>();
  indexes = new Map<string, Spec["indexes"]>();
  failAfter: number | null = null;
  writes = 0;
  busy = false;
  race: Row | null = null;
  async getManifest(id: string) {
    return this.manifests.get(id) ?? null;
  }
  async createManifest(m: Manifest) {
    this.manifests.set(m._id, clone(m));
  }
  async acquire(id: string, owner: string) {
    if (this.busy) return false;
    const m = this.manifests.get(id)!;
    if (m.leaseUntil && m.leaseUntil > new Date()) return false;
    Object.assign(m, {
      leaseOwner: owner,
      leaseUntil: new Date(Date.now() + 300000),
      status: "running",
    });
    return true;
  }
  async renew(id: string, owner: string) {
    expect(this.manifests.get(id)?.leaseOwner).toBe(owner);
  }
  async finish(
    id: string,
    owner: string,
    status: "complete" | "failed",
    errorCode?: string,
  ) {
    const m = this.manifests.get(id)!;
    expect(m.leaseOwner).toBe(owner);
    m.status = status;
    if (errorCode) m.errorCode = errorCode;
    delete m.leaseOwner;
    delete m.leaseUntil;
  }
  async ensureCollection(spec: Spec) {
    if (!this.records.has(spec.collection))
      this.records.set(spec.collection, new Map());
    this.indexes.set(spec.collection, spec.indexes);
  }
  async findRows(collection: string, ids: string[]) {
    return [...(this.records.get(collection)?.values() ?? [])]
      .filter((r) => ids.includes(r._id))
      .map(clone);
  }
  async insertMissing(collection: string, rows: Row[]) {
    const map = this.records.get(collection)!;
    let inserted = 0;
    for (const row of rows) {
      if (this.race && row._id === this.race._id)
        map.set(row._id, clone(this.race));
      if (!map.has(row._id)) {
        map.set(row._id, clone(row));
        inserted++;
        this.writes++;
        if (this.failAfter !== null && this.writes >= this.failAfter)
          throw new Error("Injected interruption");
      }
    }
    return inserted;
  }
}
describe("safe portfolio sample copy", () => {
  it("prefers a tracked active order, covers available statuses and preserves originals", () => {
    const pool = [
      "PENDING",
      "ASSIGNED",
      "PICKED_UP",
      "IN_TRANSIT",
      "DELIVERED",
      "CANCELLED",
    ].map((status, n) => ({
      id: uuid(n + 10),
      status,
      riderId: status === "PENDING" ? null : uuid(3),
      createdAt: new Date(when.getTime() + n),
    }));
    const before = fingerprint(pool);
    const r = selectOrders(pool, new Set([uuid(13)]));
    expect(r.selected[0].status).toBe("IN_TRANSIT");
    expect(r.selected.map((o) => o.status).sort()).toEqual([
      "CANCELLED",
      "DELIVERED",
      "IN_TRANSIT",
      "PENDING",
    ]);
    expect(r.excludedActiveConflicts).toBe(2);
    expect(fingerprint(pool)).toBe(before);
    const large = Array.from({ length: 30 }, (_, n) => ({
      id: uuid(n + 100),
      status: "PENDING",
      createdAt: new Date(when.getTime() + n),
    }));
    expect(selectOrders(large, new Set()).selected).toHaveLength(20);
  });
  it("uses explicit redacted profile schemas without weakening the authentication model", async () => {
    const result = await projectSnapshot(fixture());
    expect(result.User[0]).not.toHaveProperty("passwordHash");
    expect(result.Rider[0]).not.toHaveProperty("invitationHash");
    expect(mongoSchemas.User.path("passwordHash").options.required).toBe(true);
    expect(mongoSchemas.Rider.path("invitationHash")).toBeDefined();
    expect(result.TrackingPoint[0].source).toBe("LEGACY");
    expect(result.TrackingPoint[0].accuracy).toBeNull();
    expect(result.Order[0].pickupLatitude).toBeNull();
    expect(
      schemasForImport().some((s) => s.collection === "refreshtokens"),
    ).toBe(false);
    expect(
      schemasForImport()
        .find((s) => s.name === "Rider")!
        .indexes.some((i) => "invitationHash" in i.keys),
    ).toBe(false);
  });
  it("copies exact UUIDs, dates and decimal strings and produces a private-data-free receipt", async () => {
    const source = fixture(),
      data = await projectSnapshot(source),
      target = new MemoryTarget();
    const receipt = await copySnapshot(source, data, target);
    expect(receipt.status).toBe("verified");
    expect(receipt.collections.Payment).toMatchObject({
      source: "available",
      selected: 0,
      verified: 0,
    });
    expect(receipt.collections.StoredFile).toMatchObject({
      source: "unavailable",
      selected: 0,
    });
    const row = (await target.findRows("orders", [uuid(6)]))[0];
    expect(row._id).toBe(uuid(6));
    expect(canonical(row.deliveryFee)).toEqual({ $decimal: "1234567890.12" });
    expect(canonical(row.createdAt)).toEqual({ $date: when.toISOString() });
    const text = JSON.stringify(receipt);
    for (const privateValue of [
      "rider@example.test",
      "52.520000",
      "Synthetic pickup",
      uuid(6),
      "mongodb://",
    ])
      expect(text).not.toContain(privateValue);
    expect(target.manifests.get(receipt.importId)?.status).toBe("complete");
  });
  it("reruns idempotently with zero additional inserts", async () => {
    const s = fixture(),
      data = await projectSnapshot(s),
      t = new MemoryTarget();
    const a = await copySnapshot(s, data, t),
      b = await copySnapshot(s, data, t);
    expect(b.importId).toBe(a.importId);
    expect(
      Object.values(b.collections).reduce((n, r) => n + r.inserted, 0),
    ).toBe(0);
    expect(t.records.get("orders")?.size).toBe(1);
  });
  it("rejects foreign UUID collisions and never changes the existing row", async () => {
    const s = fixture(),
      data = await projectSnapshot(s),
      t = new MemoryTarget();
    t.records.set(
      "orders",
      new Map([[uuid(6), { _id: uuid(6), status: "DO_NOT_TOUCH" }]]),
    );
    await expect(copySnapshot(s, data, t)).rejects.toMatchObject({
      code: "COLLISION",
    });
    expect(t.records.get("orders")!.get(uuid(6))!.status).toBe("DO_NOT_TOUCH");
    expect(t.writes).toBe(0);
  });
  it("marks interruption as failed and safely resumes without duplicating partial inserts", async () => {
    const s = fixture(),
      data = await projectSnapshot(s),
      t = new MemoryTarget();
    t.failAfter = 2;
    await expect(copySnapshot(s, data, t)).rejects.toThrow(
      "Injected interruption",
    );
    expect([...t.manifests.values()][0].status).toBe("failed");
    expect(t.writes).toBe(2);
    t.failAfter = null;
    const receipt = await copySnapshot(s, data, t);
    expect(t.manifests.get(receipt.importId)?.status).toBe("complete");
    expect(t.records.get("users")?.size).toBe(1);
    expect(t.records.get("tenants")?.size).toBe(1);
  });
  it("does not overwrite a manually changed imported record", async () => {
    const s = fixture(),
      data = await projectSnapshot(s),
      t = new MemoryTarget();
    await copySnapshot(s, data, t);
    t.records.get("orders")!.get(uuid(6))!.status = "MANUAL_CHANGE";
    await expect(copySnapshot(s, data, t)).rejects.toMatchObject({
      code: "CONTENT_CONFLICT",
    });
    expect(t.records.get("orders")!.get(uuid(6))!.status).toBe("MANUAL_CHANGE");
  });
  it("uses insert-only writes so a racing unrelated insert is preserved and verification fails", async () => {
    const s = fixture(),
      data = await projectSnapshot(s),
      t = new MemoryTarget();
    t.race = { _id: uuid(6), status: "RACING_INSERT" };
    await expect(copySnapshot(s, data, t)).rejects.toMatchObject({
      code: "RECONCILIATION",
    });
    expect(t.records.get("orders")!.get(uuid(6))!.status).toBe("RACING_INSERT");
    expect([...t.manifests.values()][0].status).toBe("failed");
  });
  it("rejects concurrent import ownership", async () => {
    const s = fixture(),
      data = await projectSnapshot(s),
      t = new MemoryTarget();
    t.busy = true;
    await expect(copySnapshot(s, data, t)).rejects.toMatchObject({
      code: "BUSY",
    });
    expect(t.writes).toBe(0);
  });
  it("rejects invalid records, missing dependencies and cross-tenant links before copying", async () => {
    const s = fixture();
    s.rows.Order[0].deliveryFee = "-1";
    await expect(projectSnapshot(s)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const missing = fixture();
    missing.rows.Customer = [];
    await expect(projectSnapshot(missing)).rejects.toMatchObject({
      code: "REFERENCE",
    });
    const foreign = fixture();
    foreign.rows.Rider[0].tenantId = uuid(999);
    await expect(projectSnapshot(foreign)).rejects.toMatchObject({
      code: "TENANT_REFERENCE",
    });
    const file = fixture();
    file.rows.Order[0].proofFileId = uuid(123);
    await expect(projectSnapshot(file)).rejects.toMatchObject({
      code: "REFERENCE",
    });
    const secret = fixture();
    secret.rows.User[0].passwordHash = "never-export";
    await expect(projectSnapshot(secret)).rejects.toMatchObject({
      code: "SECRET_FIELD",
    });
    expect(() =>
      assertNoSecrets({ nested: { tokenHash: "never-export" } }),
    ).toThrow();
  });
});
