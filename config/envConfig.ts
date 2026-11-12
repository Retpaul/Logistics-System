import "dotenv/config";
import { randomBytes } from "node:crypto";

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = nodeEnv === "production";

function accessSecret(): string {
  const value = process.env.JWT_ACCESS_SECRET;
  if (value && value.length >= 32) return value;
  if (isProduction) throw new Error("JWT_ACCESS_SECRET must be set to at least 32 characters in production");
  // Development convenience only: sessions stop working when the process restarts.
  console.warn("JWT_ACCESS_SECRET is not set (or shorter than 32 characters); using a random development secret");
  return randomBytes(48).toString("base64url");
}

export const config = {
  nodeEnv,
  isProduction,
  isTest: nodeEnv === "test",
  databaseUrl: process.env.DATABASE_URL,
  port: Number(process.env.PORT ?? 8001),
  clientUrl: process.env.CLIENT_URL ?? "http://localhost:5173",
  apiVersion: process.env.API_VERSION ?? "/api/v1",
  auth: {
    accessSecret: accessSecret(),
    accessTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 15 * 60),
    refreshTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    /** A rotated refresh token presented again within this window is two tabs racing, not theft. */
    refreshReuseGraceMs: Number(process.env.REFRESH_REUSE_GRACE_MS ?? 10_000),
    refreshCookieName: "bd_refresh",
    cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : isProduction,
  },
};
