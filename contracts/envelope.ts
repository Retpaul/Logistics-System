// Shared API contract: response envelope and error codes.
import { z } from "zod";

export const ErrorCode = z.enum([
  "VALIDATION_FAILED",
  "INVALID_CREDENTIALS",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "TENANT_REQUIRED",
  "INVALID_TRANSITION",
  "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED",
  "INTERNAL",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Every successful response: `{ success: true, data }`. */
export type ApiSuccess<T> = { success: true; data: T; message?: string };

/** Every error response. `details` depends on `code` (field errors, tenant choices, ...). */
export type ApiFailure = { success: false; code: ErrorCode; message: string; details?: unknown };

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

/** `details` for VALIDATION_FAILED. */
export type FieldIssue = { path: string; message: string };
