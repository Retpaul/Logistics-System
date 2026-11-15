import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn(), sign: vi.fn(), client: vi.fn() }));
vi.mock("@aws-sdk/client-s3", async importOriginal => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return { ...actual, S3Client: class { constructor(options: unknown) { mocks.client(options); } send = mocks.send; } };
});
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.sign }));
import { createStorageService } from "../services/storage.js";
import { readStorageConfig } from "../config/storage.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const otherTenant = "00000000-0000-4000-8000-000000000002";
const key = `bike-dispatch/${tenantId}/00000000-0000-4000-8000-000000000003`;
const settings = { region: "eu-west-1", bucket: "test-bucket", prefix: "bike-dispatch", maxBytes: 10, urlTtlSeconds: 900 };
const service = () => createStorageService(() => settings);
beforeEach(() => { vi.clearAllMocks(); mocks.send.mockResolvedValue({}); mocks.sign.mockResolvedValue("https://example.invalid/signed"); });

describe("private S3 foundation", () => {
  it.each([Buffer.from("abc"), new Uint8Array([1, 2, 3]), new Blob(["abc"])])("uploads supported binary bodies with private encrypted metadata", async body => {
    const result = await service().uploadBlob({ tenantId, body, filename: '../folder/evil"\r\n.html' });
    expect(result).toMatchObject({ size: 3, contentType: "application/octet-stream" });
    expect(result.key).toMatch(new RegExp(`^bike-dispatch/${tenantId}/[a-f0-9-]{36}$`));
    const command = mocks.send.mock.calls[0][0];
    expect(command.input).toMatchObject({ Bucket: "test-bucket", Key: result.key, ContentLength: 3, ServerSideEncryption: "AES256" });
    expect(command.input.ACL).toBeUndefined();
    expect(command.input.ContentDisposition).not.toMatch(/[\r\n]/);
    expect(Buffer.isBuffer(command.input.Body)).toBe(true);
    expect(mocks.client).toHaveBeenCalledWith(expect.objectContaining({ maxAttempts: 3, requestHandler: { connectionTimeout: 5000, requestTimeout: 15000 } }));
  });
  it("uses unique keys and preserves validated MIME metadata", async () => {
    const s = service();
    const input = { tenantId, body: Buffer.from("a"), filename: "a.pdf", contentType: "application/pdf" };
    expect((await s.uploadBlob(input)).key).not.toBe((await s.uploadBlob(input)).key);
    expect(mocks.send.mock.calls[0][0].input.ContentType).toBe("application/pdf");
  });
  it.each([Buffer.alloc(0), Buffer.alloc(11)])("rejects empty or oversized files before calling AWS", async body => {
    await expect(service().uploadBlob({ tenantId, body, filename: "x" })).rejects.toMatchObject({ status: 400 });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("accepts the exact size limit and rejects invalid metadata and tenant IDs", async () => {
    await service().uploadBlob({ tenantId, body: Buffer.alloc(10), filename: "x" });
    await expect(service().uploadBlob({ tenantId, body: Buffer.from("a"), filename: "x", contentType: "a/b\r\nx" })).rejects.toMatchObject({ status: 400 });
    await expect(service().uploadBlob({ tenantId: "../bad", body: Buffer.from("a"), filename: "x" })).rejects.toMatchObject({ status: 400 });
  });
  it.each([key.replace(tenantId, otherTenant), `${key}/../x`, `${key}%2f`, key.replace("bike-dispatch/", "other/")])("rejects foreign or malformed keys before signing/deleting", async badKey => {
    await expect(service().getDownloadUrl({ tenantId, key: badKey })).rejects.toMatchObject({ status: 403 });
    await expect(service().deleteBlob({ tenantId, key: badKey })).rejects.toMatchObject({ status: 403 });
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("signs short-lived attachment downloads", async () => {
    const result = await service().getDownloadUrl({ tenantId, key, filename: "../test.html" });
    expect(result.url).toBe("https://example.invalid/signed");
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
    expect(mocks.sign.mock.calls[0][1].input).toMatchObject({ Key: key, ResponseContentType: "application/octet-stream", ResponseContentDisposition: 'attachment; filename="test.html"' });
    expect(mocks.sign.mock.calls[0][2]).toEqual({ expiresIn: 900 });
  });
  it("deletes idempotently and forwards cancellation", async () => {
    const s = service(); await s.deleteBlob({ tenantId, key }); await s.deleteBlob({ tenantId, key });
    expect(mocks.send).toHaveBeenCalledTimes(2);
    const controller = new AbortController(); controller.abort();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(s.deleteBlob({ tenantId, key, signal: controller.signal })).rejects.toMatchObject({ status: 503 });
    expect(mocks.send).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
  it("maps AWS and signing failures without leaking details", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.send.mockRejectedValue(new Error("secret AWS detail")); mocks.sign.mockRejectedValue(new Error("secret credential detail"));
    await expect(service().deleteBlob({ tenantId, key })).rejects.toMatchObject({ status: 503, message: "File storage is temporarily unavailable" });
    await expect(service().getDownloadUrl({ tenantId, key })).rejects.toMatchObject({ status: 503 });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("secret"); vi.restoreAllMocks();
  });
  it("cancels a pending signing operation and bounds its caller wait", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.sign.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = service().getDownloadUrl({ tenantId, key, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ status: 503, message: "File storage operation was cancelled or timed out" });
    vi.restoreAllMocks();
  });
  it("is lazy and reports missing configuration only on use", async () => {
    const s = createStorageService(() => { throw new Error("missing"); });
    expect(mocks.client).not.toHaveBeenCalled();
    await expect(s.deleteBlob({ tenantId, key })).rejects.toMatchObject({ status: 503, message: "File storage is not configured correctly" });
  });
});
describe("storage configuration", () => {
  const env = { AWS_REGION: "eu-west-1", AWS_S3_BUCKET: "example-bucket" };
  it("applies defaults without requiring explicit credentials", () => expect(readStorageConfig(env)).toMatchObject({ maxBytes: 10485760, urlTtlSeconds: 900, prefix: "bike-dispatch" }));
  it.each([{ AWS_REGION: "" }, { AWS_S3_BUCKET: "" }, { S3_KEY_PREFIX: "a/../b" }, { S3_MAX_FILE_SIZE_BYTES: "0" }, { S3_MAX_FILE_SIZE_BYTES: "1.5" }, { S3_SIGNED_URL_TTL_SECONDS: "901" }, { S3_SIGNED_URL_TTL_SECONDS: "0" }])("rejects invalid config %j", overrides => expect(() => readStorageConfig({ ...env, ...overrides })).toThrow());
});
