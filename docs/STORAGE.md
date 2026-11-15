# Private binary storage with AWS S3

The server provides an internal storage foundation, not a public upload API. It accepts arbitrary binary files up to 10 MiB by default. It does not provision an AWS bucket, create credentials, scan files for malware or attach files to database records. Feature controllers must authenticate callers and authorize access to each resource before invoking these helpers.

## 1. Create the bucket

In the AWS S3 console, create a **general purpose bucket** in your selected region. Use separate buckets and IAM identities for development and production.

- Keep all **Block Public Access** options enabled, at bucket and account level.
- Choose **Object Ownership: Bucket owner enforced (ACLs disabled)**. The service never sends an ACL.
- Use default **SSE-S3** encryption. Uploads explicitly request `AES256`; customer-managed KMS encryption requires additional implementation and IAM permissions.
- Keep static website hosting disabled. Downloads use signed GET URLs, not public URLs.
- No bucket CORS rule is required for server uploads or normal browser attachment navigation. Browser JavaScript fetching signed URLs would require a separate restricted CORS configuration.

Add this bucket policy, replacing `YOUR_BUCKET` in both resource entries:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DenyInsecureTransport",
    "Effect": "Deny",
    "Principal": "*",
    "Action": "s3:*",
    "Resource": ["arn:aws:s3:::YOUR_BUCKET", "arn:aws:s3:::YOUR_BUCKET/*"],
    "Condition": {"Bool": {"aws:SecureTransport": "false", "aws:PrincipalIsAWSService": "false"}}
  }]
}
```

This deny policy does not grant public access. The AWS-service-principal exception avoids interfering with service-to-service integrations. See [AWS transport policy guidance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/amazon-s3-policy-keys.html).

## 2. Grant least-privilege access

Attach this identity policy to the application's role or development identity. Replace `YOUR_BUCKET` and adjust `bike-dispatch` if you change `S3_KEY_PREFIX`:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "ApplicationObjectsOnly",
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
    "Resource": "arn:aws:s3:::YOUR_BUCKET/bike-dispatch/*"
  }]
}
```

Bucket administration, listing, ACL changes and permanent version deletion are not needed. Prefer an IAM role attached to your compute service in production (for example an ECS task role or EC2 instance profile); do not attach administrator or full-S3 access. IAM limits the application prefix, while application code enforces tenant and resource authorization. See [S3 IAM integration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security_iam_service-with-iam.html).

## 3. Set server environment variables

Copy these settings into `server/.env`; never put them in frontend `VITE_*` variables:

```dotenv
AWS_REGION=eu-west-1
AWS_S3_BUCKET=your-development-bucket
S3_KEY_PREFIX=bike-dispatch
S3_MAX_FILE_SIZE_BYTES=10485760
S3_SIGNED_URL_TTL_SECONDS=900
```

The bucket **Properties** page shows its region; the bucket list shows its name. Use your actual values, not the example region. Prefix, size and expiry are application settings, not AWS credentials. Expiry is restricted to 1–900 seconds. Prefixes contain letters, numbers, underscores or hyphens, optionally separated by `/`.

The SDK uses its [default credential provider chain](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html). Prefer an AWS CLI/SSO profile locally:

```dotenv
AWS_PROFILE=your-development-profile
```

Authenticate the profile using AWS CLI as appropriate (for SSO: `aws sso login --profile your-development-profile`). Alternatively, an IAM development identity's **Security credentials** page can issue an access key:

```dotenv
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
# Required together with temporary access keys only:
# AWS_SESSION_TOKEN=your-session-token
```

Use one intended credential source: environment access keys take precedence over profiles. Avoid root access keys. The secret key is shown only when created; store it securely, rotate it and revoke unused keys. On AWS hosting with a role, omit static keys, session tokens and local profiles. Existing `.env` is git-ignored; this implementation does not overwrite secrets.

Missing or invalid S3 configuration raises a storage-specific `503` only when storage is used, leaving unrelated routes available. No network request or credential resolution happens during service import.

## 4. Use the service

```typescript
import { uploadBlob, getDownloadUrl, deleteBlob } from "./services/storage.js";

// tenantId comes from authenticated server context; authorize the resource first.
const stored = await uploadBlob({
  tenantId,
  body: Buffer.from("binary content"), // also Uint8Array or Blob
  filename: "document.bin",
  contentType: "application/octet-stream", // optional; validated, not sniffed
  signal: abortController.signal, // optional
});
// Persist stored.key, filename, contentType and size in the calling feature.
const download = await getDownloadUrl({ tenantId, key: stored.key, filename: stored.filename });
// download = { url, expiresAt }; never persist the expiring URL.
await deleteBlob({ tenantId, key: stored.key });
```

Keys are generated as `<prefix>/<tenant UUID>/<random UUID>`; user filenames never become paths. Download/delete operations accept only the exact tenant prefix plus a UUID. Callers must still check resource ownership: a rider is not authorized to every file in their tenant. There is intentionally no public generic file route.

Downloads force `application/octet-stream` and an attachment disposition with an ASCII-sanitized filename. The caller-supplied upload MIME type is metadata, not proof that a file is safe. Do not render arbitrary uploads inline. Empty files and oversized bodies are rejected before S3 calls. Buffers are copied and Blob inputs materialized in memory; future HTTP routes must impose their own body limits and concurrency limits too.

Signed URLs are bearer credentials: anyone holding one can download until it expires, and AWS session credentials may expire sooner. Do not log or store them. Generating a URL does not verify that an object exists. S3 handles a missing object when downloaded.

## 5. Reliability, retention and cleanup

The client allows at most three attempts, a five-second connection timeout and fifteen-second request timeout. Operations have a thirty-second caller deadline and accept an optional abort signal. Signing's caller wait is bounded, but underlying SDK credential resolution cannot be cancelled by the presigner. Errors use the existing `AppError` envelope codes (`VALIDATION_FAILED`, `FORBIDDEN`, `INTERNAL`) with appropriate status; logs include only operation, error name and AWS request ID.

An upload timeout can leave a successfully stored object whose response was lost. Feature integration must define orphan cleanup and database/S3 compensation; neither system participates in a shared transaction. Deleting a database record does not delete its object automatically.

With an unversioned bucket, deleting an absent object is harmless. If you enable versioning, deletion normally creates a delete marker and retains prior versions; the helper does not permanently delete versions. Review a lifecycle policy for noncurrent versions and abandoned multipart uploads. Do not automatically expire current application files without a business retention policy. This foundation uses single-request uploads, not multipart uploads. Consider S3 request metrics, billing alerts and scoped CloudTrail data events for operational auditing; data events incur costs.

## 6. Verify

```powershell
npm run test:storage
npm run typecheck
npm run build
```

Unit tests mock AWS and do not create or reset databases. They cover binary inputs, size limits, generated keys, metadata, tenant boundaries, signing, cancellation, configuration and AWS failure handling.

For an opt-in **real AWS smoke test**, configure a development bucket and credentials first:

```powershell
$env:S3_SMOKE_TEST = 'true'
npm run storage:smoke
Remove-Item Env:S3_SMOKE_TEST
```

The test uploads a small synthetic file, downloads it with a signed URL, asserts exact bytes and attachment headers, then deletes only its own object in `finally`. It never prints the signed URL. Versioned buckets retain the deleted version until lifecycle cleanup. A successful mocked run is not evidence of working AWS credentials; the real-bucket test must be run separately.

For `AccessDenied`, verify the selected identity, prefix, IAM policy and bucket policy. For credential errors, refresh SSO or temporary credentials and check for stale environment keys. For region errors, use the bucket's actual region. Do not solve authorization errors by making the bucket public.
