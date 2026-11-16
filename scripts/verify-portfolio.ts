import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mongo } from "mongoose";
import {
  assertNoSecrets,
  fingerprint,
  ImportError,
  projectSnapshot,
  requireImport,
  schemasForImport,
  type Manifest,
  type Receipt,
  type Row,
} from "./portfolio/core.js";
import { readSnapshot } from "./portfolio/source.js";

let client: mongo.MongoClient | undefined;
try {
  requireImport(
    process.env.DATABASE_URL && process.env.MONGODB_URI,
    "CONFIG",
    "Set DATABASE_URL and MONGODB_URI",
  );
  const receipt: Receipt = JSON.parse(
    await readFile(
      new URL("../docs/portfolio/import-summary.json", import.meta.url),
      "utf8",
    ),
  );
  const snapshot = await readSnapshot(process.env.DATABASE_URL),
    data = await projectSnapshot(snapshot);
  const database = decodeURIComponent(
    new URL(process.env.MONGODB_URI).pathname.slice(1),
  );
  requireImport(database, "CONFIG", "MONGODB_URI needs an explicit database");
  client = new mongo.MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 30000,
  });
  await client.connect();
  const db = client.db(database);
  const manifest = await db
    .collection<Manifest>("_portfolio_imports")
    .findOne({ _id: receipt.importId });
  requireImport(
    manifest?.status === "complete",
    "MANIFEST",
    "The selected import is not complete",
  );
  const counts: Record<string, number> = {};
  let total = 0,
    indexes = 0;
  for (const spec of schemasForImport()) {
    const collection = db.collection<Row>(spec.collection),
      expected = data[spec.name];
    const rows = await collection
      .find({ _id: { $in: expected.map((r) => r._id) } })
      .toArray();
    requireImport(
      rows.length === expected.length,
      "COUNT",
      "A selected target collection count differs from PostgreSQL",
    );
    for (const row of rows) {
      assertNoSecrets(row);
      const source = expected.find((r) => r._id === row._id);
      requireImport(
        source && fingerprint(source) === fingerprint(row),
        "CONTENT",
        "A selected target document differs from PostgreSQL",
      );
    }
    counts[spec.collection] = rows.length;
    total += rows.length;
    indexes += (await collection.listIndexes().toArray()).length;
  }
  const summary = {
    capturedAt: new Date().toISOString(),
    status: "verified",
    sourceReadOnly: true,
    targetReadOnly: true,
    verifiedDocuments: total,
    selectedCollectionCounts: counts,
    indexesPresent: indexes,
    manifestComplete: true,
    secretFieldsInSelectedRecords: 0,
    refreshtokensCopied: false,
    repeatInserted: Object.values(receipt.collections).reduce(
      (n, c) => n + c.inserted,
      0,
    ),
    legacyTrackingPoints: data.TrackingPoint.filter(
      (r) => r.source === "LEGACY",
    ).length,
  };
  const directory = new URL("../docs/portfolio/", import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(
    new URL("verification-summary.json", directory),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error(
    JSON.stringify({
      status: "failed",
      code: error instanceof ImportError ? error.code : "VERIFY_ERROR",
      message:
        error instanceof ImportError
          ? error.message
          : "Verification failed; raw database errors suppressed",
    }),
  );
  process.exitCode = 1;
} finally {
  await client?.close();
}
