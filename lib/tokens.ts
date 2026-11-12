import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { Role } from "../contracts/index.js";
import { config } from "../config/index.js";

const ISSUER = "bike-dispatch";
const AUDIENCE = "bike-dispatch-api";

/** What every authenticated request knows about its caller. */
export type AuthContext = { userId: string; tenantId: string; role: Role };

const AccessClaims = z.object({ sub: z.string(), tid: z.string(), role: Role });

export function signAccessToken(auth: AuthContext): string {
  return jwt.sign({ tid: auth.tenantId, role: auth.role }, config.auth.accessSecret, {
    algorithm: "HS256",
    subject: auth.userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: config.auth.accessTtlSeconds,
  });
}

/** Returns null for any invalid, expired or tampered token. */
export function verifyAccessToken(token: string): AuthContext | null {
  try {
    const payload = jwt.verify(token, config.auth.accessSecret, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const claims = AccessClaims.parse(payload);
    return { userId: claims.sub, tenantId: claims.tid, role: claims.role };
  } catch {
    return null;
  }
}

/** Opaque refresh token for the cookie; only its SHA-256 hash is stored. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
