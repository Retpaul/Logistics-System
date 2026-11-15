export type StorageConfig = { region: string; bucket: string; prefix: string; maxBytes: number; urlTtlSeconds: number };

/** Called only when storage is used, so missing S3 settings do not break other routes. */
export function readStorageConfig(env: NodeJS.ProcessEnv): StorageConfig {
  const region = env.AWS_REGION?.trim();
  const bucket = env.AWS_S3_BUCKET?.trim();
  const prefix = env.S3_KEY_PREFIX ?? "bike-dispatch";
  const maxBytes = Number(env.S3_MAX_FILE_SIZE_BYTES ?? 10485760);
  const urlTtlSeconds = Number(env.S3_SIGNED_URL_TTL_SECONDS ?? 900);
  if (!region || !/^[a-z0-9-]+$/.test(region) || !bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error("Set AWS_REGION and AWS_S3_BUCKET to valid S3 values");
  }
  if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(prefix) || prefix.length > 200) throw new Error("Invalid S3_KEY_PREFIX");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("S3_MAX_FILE_SIZE_BYTES must be a positive integer");
  if (!Number.isInteger(urlTtlSeconds) || urlTtlSeconds < 1 || urlTtlSeconds > 900) throw new Error("S3_SIGNED_URL_TTL_SECONDS must be 1–900");
  return { region, bucket, prefix, maxBytes, urlTtlSeconds };
}
