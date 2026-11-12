import { prisma } from "../startup/db.js";

export const qrCodesRepository = {
  /** Public entry point: the QR code *identifies* the tenant, so this lookup is not tenant-scoped. */
  findActiveByCode: (code: string) =>
    prisma.qrCode.findFirst({ where: { code, active: true }, include: { tenant: true } }),

  recordScan: (qrCodeId: string) => prisma.qrScan.create({ data: { qrCodeId } }),
};
