import type { ErrorCode } from "../contracts/index.js";

/** An expected failure with an HTTP status and a stable machine-readable code. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what = "Resource") => new AppError(404, "NOT_FOUND", `${what} not found`);
export const forbidden = () => new AppError(403, "FORBIDDEN", "You do not have permission to do this");
export const unauthenticated = (message = "Please sign in") => new AppError(401, "UNAUTHENTICATED", message);
