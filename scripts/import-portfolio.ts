import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import {
  copySnapshot,
  ImportError,
  projectSnapshot,
  requireImport,
} from "./portfolio/core.js";
import { readSnapshot } from "./portfolio/source.js";
import { openTarget } from "./portfolio/target.js";

let close: (() => Promise<void>) | undefined;
try {
  requireImport(
    process.env.DATABASE_URL && process.env.MONGODB_URI,
    "CONFIG",
    "Set DATABASE_URL and MONGODB_URI in server/.env",
  );
  const snapshot = await readSnapshot(process.env.DATABASE_URL);
  const data = await projectSnapshot(snapshot);
  console.log(
    `Validated ${snapshot.selection.selected} linked orders; PostgreSQL transaction was read-only.`,
  );
  const destination = await openTarget(process.env.MONGODB_URI);
  close = destination.close;
  const receipt = await copySnapshot(snapshot, data, destination.target);
  const directory = new URL("../docs/portfolio/", import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(
    new URL("import-summary.json", directory),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  const safe =
    error instanceof ImportError
      ? { code: error.code, message: error.message }
      : {
          code: String((error as { code?: unknown }).code ?? "IMPORT_ERROR"),
          message:
            "Import failed. Check database access and the pending manifest; raw errors suppressed to protect private values.",
        };
  console.error(JSON.stringify({ status: "failed", ...safe }));
  process.exitCode = 1;
} finally {
  await close?.();
}
