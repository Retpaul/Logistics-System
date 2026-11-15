import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config/index.js";
import type { StorageConfig } from "../config/storage.js";
import { Id } from "../contracts/index.js";
import { AppError, forbidden } from "../lib/errors.js";

type Scope = { tenantId: string; signal?: AbortSignal };
export type UploadBlobInput = Scope & { body: Buffer | Uint8Array | Blob; filename: string; contentType?: string };
type ObjectInput = Scope & { key: string };
type DownloadInput = ObjectInput & { filename?: string };
export type StoredBlob = { key: string; filename: string; contentType: string; size: number };

function filename(value: string) {
  return value.split(/[/\\]/).at(-1)?.replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/^\.+/, "").trim().slice(0, 120) || "download.bin";
}
function tenantPrefix(settings: StorageConfig, tenantId: string) {
  if (!Id.safeParse(tenantId).success) throw new AppError(400, "VALIDATION_FAILED", "Invalid storage tenant");
  return `${settings.prefix}/${tenantId}/`;
}
function checkKey(settings: StorageConfig, input: ObjectInput) {
  const prefix = tenantPrefix(settings, input.tenantId);
  if (!input.key.startsWith(prefix) || !Id.safeParse(input.key.slice(prefix.length)).success) throw forbidden();
}

/** Internal service only. Callers must authorize the resource as well as providing trusted tenant context. */
export function createStorageService(getSettings: () => StorageConfig = config.storage) {
  let client: S3Client | undefined;
  function settings() {
    try { return getSettings(); }
    catch { throw new AppError(503, "INTERNAL", "File storage is not configured correctly"); }
  }
  function s3(s: StorageConfig) {
    return client ??= new S3Client({ region: s.region, maxAttempts: 3,
      requestHandler: { connectionTimeout: 5000, requestTimeout: 15000 },
    });
  }
  async function run<T>(operation: string, signal: AbortSignal | undefined, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const bounded = AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]);
    try { bounded.throwIfAborted(); return await task(bounded); }
    catch (error) {
      // Deliberately exclude message, stack, keys, filenames, credentials and URLs.
      const e = error as { name?: string; $metadata?: { requestId?: string } };
      console.warn("Storage operation failed", { operation, code: e.name, requestId: e.$metadata?.requestId });
      throw new AppError(503, "INTERNAL", bounded.aborted ? "File storage operation was cancelled or timed out" : "File storage is temporarily unavailable");
    }
  }
  return {
    async uploadBlob(input: UploadBlobInput): Promise<StoredBlob> {
      const s = settings();
      const prefix = tenantPrefix(s, input.tenantId);
      const size = input.body instanceof Blob ? input.body.size : input.body instanceof Uint8Array ? input.body.byteLength : -1;
      if (size < 1 || size > s.maxBytes) throw new AppError(400, "VALIDATION_FAILED", `File size must be between 1 and ${s.maxBytes} bytes`);
      const safeName = filename(input.filename);
      const contentType = input.contentType ?? "application/octet-stream";
      if (contentType.length > 127 || !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(contentType)) throw new AppError(400, "VALIDATION_FAILED", "Invalid file content type");
      const key = `${prefix}${randomUUID()}`;
      await run("upload", input.signal, async signal => {
        // Copy binary views to prevent mutation while retries are in progress.
        const body = input.body instanceof Blob ? Buffer.from(await input.body.arrayBuffer()) : Buffer.from(input.body);
        await s3(s).send(new PutObjectCommand({ Bucket: s.bucket, Key: key, Body: body, ContentLength: size,
          ContentType: contentType, ContentDisposition: `attachment; filename="${safeName}"`, ServerSideEncryption: "AES256",
        }), { abortSignal: signal });
      });
      return { key, filename: safeName, contentType, size };
    },
    async getDownloadUrl(input: DownloadInput): Promise<{ url: string; expiresAt: string }> {
      const s = settings();
      checkKey(s, input);
      const expiresAt = new Date(Date.now() + s.urlTtlSeconds * 1000).toISOString();
      const url = await run("sign-download", input.signal, async signal => {
        const signing = getSignedUrl(s3(s), new GetObjectCommand({ Bucket: s.bucket, Key: input.key,
          ResponseContentType: "application/octet-stream", ResponseContentDisposition: `attachment; filename="${filename(input.filename ?? "download.bin")}"`,
        }), { expiresIn: s.urlTtlSeconds });
        // Signing can resolve credentials asynchronously; bound the caller's wait as well.
        return new Promise<string>((resolve, reject) => {
          const abort = () => reject(signal.reason);
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
          signing.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
        });
      });
      return { url, expiresAt };
    },
    async deleteBlob(input: ObjectInput): Promise<void> {
      const s = settings();
      checkKey(s, input);
      await run("delete", input.signal, async signal => {
        await s3(s).send(new DeleteObjectCommand({ Bucket: s.bucket, Key: input.key }), { abortSignal: signal });
      });
    },
  };
}

export const { uploadBlob, getDownloadUrl, deleteBlob } = createStorageService();
