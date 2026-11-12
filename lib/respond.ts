import type { Response } from "express";
import type { ApiSuccess } from "../contracts/index.js";

/** Sends the shared success envelope. */
export function ok<T>(res: Response, data: T, status = 200, message?: string) {
  const body: ApiSuccess<T> = message ? { success: true, data, message } : { success: true, data };
  return res.status(status).json(body);
}
