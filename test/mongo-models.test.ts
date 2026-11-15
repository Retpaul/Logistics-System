import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import mongoose, { Types, type Model } from "mongoose";
import { afterAll, describe, expect, it } from "vitest";
import { createMongoModels, mongoSchemas } from "../models/mongo/index.js";
import { decimalUnits } from "../models/mongo/shared.js";

const connection = mongoose.createConnection(); // No URI: disconnected and no network.
const models = createMongoModels(connection);
// Heterogeneous, deliberately invalid fixture payloads use only the shared UUID identity type.
const testModels = models as unknown as {
  [K in keyof typeof models]: Model<{ _id: string }>;
};
const id = "12345678-1234-1234-1234-123456789abc";
const valid = {
  Tenant: { name: "", subdomain: "team" },
  User: {
    tenantId: id,
    email: "",
    passwordHash: "already-hashed",
    firstName: "",
    lastName: "",
  },
  RefreshToken: {
    tenantId: id,
    userId: id,
    familyId: id,
    tokenHash: "hash",
    expiresAt: new Date("2030-01-01Z"),
  },
  Rider: { tenantId: id, userId: id },
  Bike: { tenantId: id, serialNumber: "" },
  Customer: { tenantId: id, name: "", phone: "" },
  QrCode: { tenantId: id, label: "" },
  QrScan: { qrCodeId: id },
  Order: {
    tenantId: id,
    customerId: id,
    pickupAddress: "",
    deliveryAddress: "",
    recipientName: "",
    recipientPhone: "",
    deliveryFee: "2500.00",
  },
  StoredFile: {
    tenantId: id,
    userId: id,
    key: "",
    filename: "",
    contentType: "",
    size: 1,
    purpose: "LICENSE",
  },
  OrderEvent: { orderId: id, status: "PENDING" },
  TrackingPoint: { orderId: id, latitude: "0", longitude: "0" },
  Payment: { orderId: id, amount: "0.00" },
};
afterAll(() => connection.destroy());

describe("offline MongoDB models", () => {
  it("registers all 13 typed models idempotently without connecting or queuing commands", async () => {
    expect(Object.keys(models)).toHaveLength(13);
    expect(connection.readyState).toBe(0);
    expect(mongoose.connection.readyState).toBe(0);
    expect(mongoose.connection.modelNames()).toEqual([]);
    const again = createMongoModels(connection);
    for (const key of Object.keys(models) as (keyof typeof models)[]) {
      expect(again[key]).toBe(models[key]);
      expect(models[key].schema.options).toMatchObject({
        autoIndex: false,
        autoCreate: false,
        bufferCommands: false,
        versionKey: false,
        id: false,
        strict: "throw",
        strictQuery: "throw",
      });
    }
    await expect(models.Tenant.findOne()).rejects.toThrow(
      /before initial connection|bufferCommands/,
    );
  });
  it("refuses to replace an unrelated model registered on the supplied connection", async () => {
    const other = mongoose.createConnection();
    try {
      other.model("Tenant", new mongoose.Schema({ title: String }));
      expect(() => createMongoModels(other)).toThrow("unrelated");
    } finally {
      await other.destroy();
    }
  });
  it.each(Object.keys(valid) as (keyof typeof valid)[])(
    "validates %s and generates a UUID string identity",
    async (name) => {
      const Model = testModels[name];
      const document = new Model(valid[name]);
      await expect(document.validate()).resolves.toBeUndefined();
      expect(document.get("_id")).toMatch(/^[0-9a-f-]{36}$/);
      expect(document.toObject()).not.toHaveProperty("__v");
    },
  );
  it("preserves a source UUID and rejects malformed/noncanonical IDs without coercion", async () => {
    const row = new models.Customer({ ...valid.Customer, _id: id });
    await row.validate();
    expect(row._id).toBe(id);
    for (const bad of ["not-an-id", id.toUpperCase(), null, 123])
      await expect(
        new models.Customer({ ...valid.Customer, _id: bad }).validate(),
      ).rejects.toThrow();
    expect(row).not.toHaveProperty("id");
  });
  it("rejects unknown fields and invalid references locally without claiming FK enforcement", async () => {
    expect(
      () => new models.Tenant({ ...valid.Tenant, invented: true }),
    ).toThrow();
    await expect(
      new models.Rider({ tenantId: id, userId: "not-a-uuid" }).validate(),
    ).rejects.toThrow();
    // Correctly shaped references need no database: existence/ownership is a future service check.
    await expect(
      new models.Rider({
        tenantId: randomUUID(),
        userId: randomUUID(),
      }).validate(),
    ).resolves.toBeUndefined();
    await expect(models.Tenant.findOne({ misspelled: "x" })).rejects.toThrow();
  });
  it("matches every Prisma persisted field, type, nullable flag, explicit default and relationship pointer", async () => {
    const prisma = readFileSync(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    const blocks = [...prisma.matchAll(/model (\w+)\s*\{([\s\S]*?)\n\}/g)];
    expect(blocks.map((b) => b[1]).sort()).toEqual(
      Object.keys(mongoSchemas).sort(),
    );
    const scalar =
      /^(\w+)\s+(String|Int|Float|Boolean|DateTime|Decimal|Role|OrderStatus|PaymentStatus|PackageSize)(\?)?(?=\s|$)(.*)$/;
    for (const [, name, body] of blocks) {
      const schema = mongoSchemas[name as keyof typeof mongoSchemas];
      const fields = body
        .split(/\r?\n/)
        .map((line) => scalar.exec(line.trim()))
        .filter((m) => m !== null);
      expect(Object.keys(schema.paths).sort(), name).toEqual(
        fields.map((m) => (m[1] === "id" ? "_id" : m[1])).sort(),
      );
      const document = new testModels[name as keyof typeof models]({});
      for (const field of fields) {
        const [, source, type, nullable, rest] = field;
        const path = schema.paths[source === "id" ? "_id" : source];
        expect(path.instance, `${name}.${source}`).toBe(
          (
            {
              Int: "Number",
              Float: "Number",
              Boolean: "Boolean",
              DateTime: "Date",
              Decimal: "Decimal128",
            } as Record<string, string>
          )[type] ?? "String",
        );
        expect(!!path.options.required, `${name}.${source} required`).toBe(
          !nullable,
        );
        if (nullable)
          expect(document.get(path.path), `${name}.${source} null`).toBeNull();
        const declared = /@default\(("[^"]*"|true|false|\d+|\w+)\)/.exec(
          rest,
        )?.[1];
        if (declared) {
          const expected = declared.startsWith('"')
            ? JSON.parse(declared)
            : declared === "true"
              ? true
              : declared === "false"
                ? false
                : /^\d+$/.test(declared)
                  ? Number(declared)
                  : declared;
          expect(document.get(path.path), `${name}.${source} default`).toEqual(
            expected,
          );
        }
      }
    }
  });
  it("preserves SQL empty strings, Unicode codepoint limits and nullability without silent normalization", async () => {
    await expect(
      new models.User(valid.User).validate(),
    ).resolves.toBeUndefined();
    await expect(
      new models.Tenant({
        name: "😀".repeat(150),
        subdomain: "team",
      }).validate(),
    ).resolves.toBeUndefined();
    await expect(
      new models.Tenant({
        name: "😀".repeat(151),
        subdomain: "team",
      }).validate(),
    ).rejects.toThrow();
    for (const name of [null, undefined, 42, "a\0b"])
      await expect(
        new models.Tenant({ name, subdomain: "team" }).validate(),
      ).rejects.toThrow();
    expect(
      new models.Customer({ ...valid.Customer, email: "Case@Example.TEST" })
        .email,
    ).toBe("Case@Example.TEST");
    await expect(
      new models.User({ ...valid.User, email: "Case@example.test" }).validate(),
    ).rejects.toThrow();
  });
  it.each([
    ["User", "role", "ADMIN"],
    ["Rider", "onboardingStatus", "ACTIVE"],
    ["Order", "status", "UNKNOWN"],
    ["Order", "packageSize", "XL"],
    ["Payment", "status", "SETTLED"],
    ["StoredFile", "purpose", "OTHER"],
    ["TrackingPoint", "source", "MOCK"],
  ] as const)("rejects invalid %s.%s enum", async (name, field, value) => {
    await expect(
      new testModels[name]({ ...valid[name], [field]: value }).validate(),
    ).rejects.toThrow();
  });
  it("validates only SQL formats, not API-only URL, phone, approval or delivery-proof rules", async () => {
    await expect(
      new models.Tenant({
        name: "",
        subdomain: "team-1",
        logoUrl: "not-a-url",
      }).validate(),
    ).resolves.toBeUndefined();
    await expect(
      new models.Order({
        ...valid.Order,
        status: "DELIVERED",
        proofFileId: null,
      }).validate(),
    ).resolves.toBeUndefined();
    await expect(
      new models.Rider({
        ...valid.Rider,
        available: true,
        onboardingStatus: "PENDING",
        latitude: "1",
        longitude: null,
        locationSource: "IMPORTED",
      }).validate(),
    ).resolves.toBeUndefined();
    for (const data of [
      { subdomain: "UPPER" },
      { brandColor: "#AABBCC" },
      { currency: "ngn" },
    ])
      await expect(
        new models.Tenant({ ...valid.Tenant, ...data }).validate(),
      ).rejects.toThrow();
  });
  it.each(["0", "0.01", "9999999999.99", "2.5000", "2.5E+3", "NaN"])(
    "preserves exact allowed SQL money %s",
    async (value) => {
      const row = new models.Payment({ ...valid.Payment, amount: value });
      await row.validate();
      expect(row.amount).toBeInstanceOf(Types.Decimal128);
      expect(row.amount.toString()).toBe(
        Types.Decimal128.fromString(value).toString(),
      );
    },
  );
  it.each(["-0.01", "10000000000", "0.001", "Infinity", "-Infinity", 0.1])(
    "rejects invalid or precision-losing money %s",
    async (value) => {
      await expect(
        new models.Order({ ...valid.Order, deliveryFee: value }).validate(),
      ).rejects.toThrow();
    },
  );
  it("checks exact decimal scale, coordinate bounds and paired order endpoints", async () => {
    expect(
      new models.Order({ ...valid.Order, pickupLatitude: "1" }).validateSync()
        ?.errors,
    ).toHaveProperty("pickupLatitude");
    expect(decimalUnits("123.4500", 2)).toBe(12345n);
    expect(decimalUnits("1E-3", 2)).toBeNull();
    await expect(
      new models.Order({
        ...valid.Order,
        pickupLatitude: "90.000000",
        pickupLongitude: "-180.000000",
      }).validate(),
    ).resolves.toBeUndefined();
    for (const data of [
      { pickupLatitude: "1" },
      { pickupLongitude: "1" },
      { pickupLatitude: "90.000001", pickupLongitude: "0" },
      { deliveryLatitude: "0", deliveryLongitude: "180.000001" },
      { pickupLatitude: "NaN", pickupLongitude: "0" },
      { pickupLatitude: "0.0000001", pickupLongitude: "0" },
    ])
      await expect(
        new models.Order({ ...valid.Order, ...data }).validate(),
      ).rejects.toThrow();
  });
  it("checks integer ranges and finite GPS accuracy without casting", async () => {
    for (const value of [-1, 101, 1.5, "50", null])
      await expect(
        new models.Bike({ ...valid.Bike, batteryPercent: value }).validate(),
      ).rejects.toThrow();
    for (const value of [0, 2147483648, 1.5])
      await expect(
        new models.StoredFile({ ...valid.StoredFile, size: value }).validate(),
      ).rejects.toThrow();
    for (const value of [-1, 501, NaN, Infinity, "10"])
      await expect(
        new models.TrackingPoint({
          ...valid.TrackingPoint,
          accuracy: value,
        }).validate(),
      ).rejects.toThrow();
    await expect(
      new models.Rider({ ...valid.Rider, available: "false" }).validate(),
    ).rejects.toThrow();
  });
  it("keeps explicit historical timestamps and does not introduce timestamps on other tables", async () => {
    const when = new Date("2020-01-02T03:04:05.678Z");
    const row = new models.User({
      ...valid.User,
      createdAt: when,
      updatedAt: when,
    });
    await row.validate();
    expect(row.createdAt.getTime()).toBe(when.getTime());
    expect(row.updatedAt.getTime()).toBe(when.getTime());
    expect(row.schema.options.timestamps).toEqual({
      createdAt: false,
      updatedAt: "updatedAt",
    });
    expect(models.Bike.schema.path("createdAt")).toBeUndefined();
    await expect(
      new models.RefreshToken({
        ...valid.RefreshToken,
        expiresAt: "not-a-date",
      }).validate(),
    ).rejects.toThrow();
  });
  it("excludes hashes from default projections and redacts document serialization without rehashing", () => {
    for (const [name, field] of [
      ["User", "passwordHash"],
      ["RefreshToken", "tokenHash"],
      ["Rider", "invitationHash"],
    ] as const) {
      const row = new testModels[name]({
        ...valid[name],
        [field]: "stored-hash",
      });
      expect(row.get(field)).toBe("stored-hash");
      expect(row.schema.path(field).options.select).toBe(false);
      expect(row.toJSON()).not.toHaveProperty(field);
      expect(row.toObject()).not.toHaveProperty(field);
      expect(JSON.stringify(row)).not.toContain("stored-hash");
    }
  });
  it("declares unique/nullable/active-order indexes but no TTL or geospatial indexes", () => {
    for (const [schema, field] of [
      [mongoSchemas.Rider, "invitationHash"],
      [mongoSchemas.Payment, "providerReference"],
    ] as const) {
      const index = schema
        .indexes()
        .find(
          ([fields]) => Object.keys(fields).length === 1 && fields[field] === 1,
        )!;
      expect(index[1]).toMatchObject({
        unique: true,
        partialFilterExpression: { [field]: { $type: "string" } },
      });
    }
    const index = mongoSchemas.Order.indexes().find(
      ([, options]) => options.name === "Order_one_active_per_rider",
    )!;
    expect(index).toMatchObject([
      { riderId: 1 },
      {
        unique: true,
        partialFilterExpression: {
          riderId: { $type: "string" },
          status: { $in: ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"] },
        },
      },
    ]);
    for (const schema of Object.values(mongoSchemas))
      for (const [fields, options] of schema.indexes()) {
        expect(options).not.toHaveProperty("expireAfterSeconds");
        expect(Object.values(fields)).not.toContain("2dsphere");
        expect(Object.values(fields)).not.toContain("2d");
      }
  });
  it("declares every current Prisma unique/compound index and matching enum membership", () => {
    const source = readFileSync("prisma/schema.prisma", "utf8");
    for (const [, name, body] of source.matchAll(
      /model (\w+)\s*\{([\s\S]*?)\n\}/g,
    )) {
      const schema = mongoSchemas[name as keyof typeof mongoSchemas];
      const indexes = schema.indexes();
      const expected = [
        ...body.matchAll(/@@(unique|index)\(\[([^\]]+)\]/g),
      ].map((m) => ({
        unique: m[1] === "unique",
        fields: m[2]
          .split(",")
          .map((f) => (f.trim() === "id" ? "_id" : f.trim())),
      }));
      for (const line of body.split(/\r?\n/)) {
        const field = /^\s*(\w+)\s+\w+\??\s+(.*)/.exec(line);
        if (field && /@unique\b/.test(field[2]))
          expected.push({ unique: true, fields: [field[1]] });
        const enumField =
          /^\s*(\w+)\s+(Role|OrderStatus|PaymentStatus|PackageSize)\s/.exec(
            line,
          );
        if (enumField) {
          const block = new RegExp(
            `enum ${enumField[2]}\\s*\\{([^}]+)\\}`,
          ).exec(source)![1];
          expect(schema.paths[enumField[1]].options.enum).toEqual(
            block.trim().split(/\s+/),
          );
        }
      }
      for (const index of expected) {
        const found = indexes.find(
          ([keys]) =>
            JSON.stringify(Object.keys(keys)) === JSON.stringify(index.fields),
        );
        expect(found, `${name}.${index.fields.join(",")}`).toBeDefined();
        expect(!!found![1].unique).toBe(index.unique);
      }
    }
  });
  it("keeps model modules separate from runtime startup, services, routes and repositories", () => {
    function walk(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(resolve(dir, e.name))
          : e.name.endsWith(".ts")
            ? [resolve(dir, e.name)]
            : [],
      );
    }
    const files = [
      "app.ts",
      "server.ts",
      ...["startup", "services", "routes", "repositories"].flatMap(walk),
    ];
    for (const file of files)
      expect(readFileSync(file, "utf8"), file).not.toMatch(
        /(?:from\s*|import\s*\()["'][^"']*(?:models\/mongo|mongoose)/,
      );
  });
  it("indexes every server Markdown guide from the README and resolves local links", () => {
    function markdown(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? markdown(resolve(dir, e.name))
          : e.name.endsWith(".md")
            ? [resolve(dir, e.name)]
            : [],
      );
    }
    const readme = readFileSync("README.md", "utf8");
    const readmeTargets = [...readme.matchAll(/\]\(([^)]+)\)/g)].map((m) =>
      resolve(m[1]),
    );
    for (const file of markdown("docs"))
      expect(readmeTargets, file).toContain(file);
    for (const file of [
      resolve("README.md"),
      resolve("docs/MONGODB_MODELS.md"),
      resolve("docs/SERVER_GUIDE.md"),
    ]) {
      const body = readFileSync(file, "utf8");
      for (const match of body.matchAll(/\]\(([^)]+)\)/g))
        if (!/^(?:https?:|#)/.test(match[1]))
          expect(() =>
            readFileSync(resolve(dirname(file), match[1].split("#")[0])),
          ).not.toThrow();
    }
    const guide = readFileSync("docs/MONGODB_MODELS.md", "utf8");
    for (const name of Object.keys(mongoSchemas))
      expect(guide).toContain(`### ${name}`);
  });
});
