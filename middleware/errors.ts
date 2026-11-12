import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import type { ApiFailure, FieldIssue } from "../contracts/index.js";
import { AppError } from "../lib/errors.js";

function send(res: Response, status: number, body: ApiFailure) {
  return res.status(status).json(body);
}

export function notFoundHandler(req: Request, res: Response) {
  send(res, 404, { success: false, code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` });
}

/** Maps every error to the shared envelope. Unexpected errors are logged and never leak details. */
export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    return send(res, err.status, { success: false, code: err.code, message: err.message, details: err.details });
  }
  if (err instanceof ZodError) {
    const details: FieldIssue[] = err.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
    return send(res, 400, { success: false, code: "VALIDATION_FAILED", message: "Some fields are invalid", details });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return send(res, 409, { success: false, code: "CONFLICT", message: "That record already exists" });
    if (err.code === "P2025") return send(res, 404, { success: false, code: "NOT_FOUND", message: "Record not found" });
  }
  const type = (err as { type?: string } | null)?.type;
  if (type === "entity.parse.failed") {
    return send(res, 400, { success: false, code: "VALIDATION_FAILED", message: "The request body is not valid JSON" });
  }
  if (type === "entity.too.large") {
    return send(res, 413, { success: false, code: "PAYLOAD_TOO_LARGE", message: "The request is too large" });
  }

  console.error(err);
  return send(res, 500, { success: false, code: "INTERNAL", message: "Something went wrong" });
}
