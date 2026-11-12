import type { Prisma } from "@prisma/client";
import { prisma } from "../startup/db.js";
import type { Db } from "./db.js";

// The tenant row *is* the scope, so these functions take its id directly.
export const tenantsRepository = {
  findById: (tenantId: string, db: Db = prisma) => db.tenant.findUnique({ where: { id: tenantId } }),

  subdomainTaken: async (subdomain: string, db: Db = prisma) =>
    (await db.tenant.count({ where: { subdomain } })) > 0,

  create: (data: { name: string; subdomain: string }, db: Db = prisma) => db.tenant.create({ data }),

  update: (tenantId: string, data: Prisma.TenantUpdateInput, db: Db = prisma) =>
    db.tenant.update({ where: { id: tenantId }, data }),
};
