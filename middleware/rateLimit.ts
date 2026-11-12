import { rateLimit } from "express-rate-limit";
import type { ApiFailure } from "../contracts/index.js";
import { config } from "../config/index.js";

function limiter(limit: number, windowMinutes: number) {
  return rateLimit({
    windowMs: windowMinutes * 60_000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: () => config.isTest,
    handler: (_req, res) => {
      const body: ApiFailure = { success: false, code: "RATE_LIMITED", message: "Too many requests. Try again shortly." };
      res.status(429).json(body);
    },
  });
}

/** Sign-up, login and refresh: slows down credential stuffing. */
export const authLimiter = limiter(30, 15);

/** Public QR booking (PRD NFR-SE-005: rate limiting on QR endpoints). */
export const publicWriteLimiter = limiter(20, 15);

/** Public reads (QR landing page, tracking page polled every 10 s). */
export const publicReadLimiter = limiter(300, 15);
