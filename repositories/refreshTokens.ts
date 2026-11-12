import { prisma } from "../startup/db.js";
import type { Db } from "./db.js";

export const refreshTokensRepository = {
  create: (
    tenantId: string,
    data: { userId: string; familyId: string; tokenHash: string; expiresAt: Date },
    db: Db = prisma,
  ) => db.refreshToken.create({ data: { ...data, tenantId } }),

  /** The hash is globally unique and *identifies* the tenant, so this lookup is not tenant-scoped. */
  findByHash: (tokenHash: string) => prisma.refreshToken.findUnique({ where: { tokenHash } }),

  /** Returns how many rows changed: 0 means another request revoked it first. */
  revoke: async (id: string, db: Db = prisma) =>
    (await db.refreshToken.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } })).count,

  revokeFamily: (familyId: string, db: Db = prisma) =>
    db.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } }),
};
