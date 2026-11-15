import {
  date,
  defineSchema,
  identity,
  uuid,
  type QrScanDocument,
} from "./shared.js";
export const qrScanSchema = defineSchema<QrScanDocument>("qrscans", {
  _id: identity(),
  qrCodeId: uuid("QrCode"),
  scannedAt: date(false, true),
});
qrScanSchema.index({ qrCodeId: 1, scannedAt: 1 });
