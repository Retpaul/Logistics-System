import { mongo } from "mongoose";
import {
  requireImport,
  type Manifest,
  type Row,
  type Spec,
  type Target,
} from "./core.js";

export async function openTarget(uri: string) {
  const parsed = new URL(uri);
  const database = decodeURIComponent(parsed.pathname.slice(1));
  requireImport(
    ["mongodb:", "mongodb+srv:"].includes(parsed.protocol) &&
      !!database &&
      !database.includes("/") &&
      !["admin", "local", "config"].includes(database),
    "TARGET_DATABASE",
    "Specify an application database in MONGODB_URI, not an administrative database",
  );
  const client = new mongo.MongoClient(uri, {
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 30000,
    writeConcern: { w: "majority" },
  });
  await client.connect();
  const db = client.db(database);
  const manifests = db.collection<Manifest>("_portfolio_imports");
  const collection = (name: string) => db.collection<Row>(name);
  const target: Target = {
    getManifest: (id) => manifests.findOne({ _id: id }),
    createManifest: async (manifest) => {
      try {
        await manifests.insertOne(manifest);
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
        const old = await manifests.findOne({ _id: manifest._id });
        requireImport(
          old?.contentHash === manifest.contentHash,
          "MANIFEST",
          "Concurrent import manifest conflict",
        );
      }
    },
    acquire: async (id, owner) => {
      const r = await manifests.updateOne(
        {
          _id: id,
          $or: [
            { leaseUntil: { $exists: false } },
            { leaseUntil: { $lt: new Date() } },
          ],
        },
        {
          $set: {
            leaseOwner: owner,
            leaseUntil: new Date(Date.now() + 300000),
            status: "running",
          },
          $unset: { errorCode: "" },
        },
      );
      return r.modifiedCount === 1;
    },
    renew: async (id, owner) => {
      const r = await manifests.updateOne(
        { _id: id, leaseOwner: owner },
        { $set: { leaseUntil: new Date(Date.now() + 300000) } },
      );
      requireImport(r.matchedCount === 1, "LEASE", "Import lease was lost");
    },
    finish: async (id, owner, status, errorCode) => {
      const r = await manifests.updateOne(
        { _id: id, leaseOwner: owner },
        {
          $set: { status, ...(errorCode ? { errorCode } : {}) },
          $unset: { leaseOwner: "", leaseUntil: "" },
        },
      );
      requireImport(
        r.matchedCount === 1,
        "LEASE",
        "Import lease was lost before completion",
      );
    },
    ensureCollection: async (spec: Spec) => {
      const exists = await db
        .listCollections({ name: spec.collection }, { nameOnly: true })
        .hasNext();
      if (!exists) {
        try {
          await db.createCollection(spec.collection);
        } catch (e) {
          if ((e as { code?: number }).code !== 48) throw e;
        }
      }
      for (const index of spec.indexes)
        await collection(spec.collection).createIndex(
          index.keys,
          index.options,
        );
    },
    findRows: async (name, ids) =>
      ids.length
        ? collection(name)
            .find({ _id: { $in: ids } })
            .toArray()
        : [],
    insertMissing: async (name, rows) => {
      if (!rows.length) return 0;
      const result = await collection(name).bulkWrite(
        rows.map((row) => ({
          updateOne: {
            filter: { _id: row._id },
            update: { $setOnInsert: row },
            upsert: true,
          },
        })),
        { ordered: true },
      );
      return result.upsertedCount;
    },
  };
  return { target, close: () => client.close() };
}
