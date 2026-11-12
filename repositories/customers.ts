import { prisma } from "../startup/db.js";
import type { Db } from "./db.js";

export const customersRepository = {
  findByPhone: (tenantId: string, phone: string, db: Db = prisma) =>
    db.customer.findFirst({ where: { tenantId, phone }, orderBy: { id: "asc" } }),

  create: (tenantId: string, data: { name: string; phone: string; email?: string | null }, db: Db = prisma) =>
    db.customer.create({ data: { ...data, tenantId } }),
};
