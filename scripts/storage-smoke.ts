// Opt-in real AWS test: uses configured bucket and removes only its own generated object.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { uploadBlob, getDownloadUrl, deleteBlob } from "../services/storage.js";

assert(process.env.S3_SMOKE_TEST === "true", "Set S3_SMOKE_TEST=true explicitly; use a development bucket");
const tenantId = randomUUID();
const bytes = Buffer.from("Bike Dispatch synthetic S3 smoke test\n");
let key: string | undefined;
try {
  const stored = await uploadBlob({ tenantId, body: bytes, filename: "storage-smoke.bin" });
  key = stored.key;
  const { url } = await getDownloadUrl({ tenantId, key, filename: stored.filename });
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  console.log("PASS S3 upload, signed download and exact byte verification (URL omitted)");
} catch {
  console.error("S3 smoke test failed; check storage configuration and IAM permissions (sensitive details omitted)");
  process.exitCode = 1;
} finally {
  if (key) {
    try { await deleteBlob({ tenantId, key }); console.log("PASS S3 cleanup: deleted only the smoke-test object"); }
    catch { console.error("Smoke-test cleanup failed; locate the recent synthetic object in the development bucket"); process.exitCode = 1; }
  }
}
