import type { NextFunction, Request, Response } from "express";
import type { Role } from "../contracts/index.js";
import { forbidden, unauthenticated } from "../lib/errors.js";
import { verifyAccessToken, type AuthContext } from "../lib/tokens.js";

/** Requires `Authorization: Bearer <access token>` and sets req.auth. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const auth = token ? verifyAccessToken(token) : null;
  if (!auth) return next(unauthenticated(token ? "Your session has expired" : "Please sign in"));
  req.auth = auth;
  next();
}

/** Use after requireAuth. */
export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) return next(forbidden());
    next();
  };

/** The caller's identity. Only call in handlers mounted behind requireAuth. */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}
