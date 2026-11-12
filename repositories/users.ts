import type { Prisma } from "@prisma/client";
import { prisma } from "../startup/db.js";
import type { Db } from "./db.js";

export const usersRepository = {
  /**
   * Login only: an email is unique per tenant, so the same address can return several users.
   * Callers must still verify the password for each before trusting any row.
   */
  findAllByEmail: (email: string) =>
    prisma.user.findMany({ where: { email }, include: { tenant: true }, take: 20 }),

  findById: (tenantId: string, userId: string, db: Db = prisma) =>
    db.user.findFirst({ where: { tenantId, id: userId }, include: { tenant: true } }),

  create: (tenantId: string, data: Omit<Prisma.UserUncheckedCreateInput, "tenantId">, db: Db = prisma) =>
    db.user.create({ data: { ...data, tenantId }, include: { tenant: true } }),
};
