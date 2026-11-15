import { randomUUID } from "node:crypto";
import {
  bool,
  defineSchema,
  identity,
  tenantIdentity,
  text,
  uuid,
  type QrCodeDocument,
} from "./shared.js";
export const qrCodeSchema = defineSchema<QrCodeDocument>("qrcodes", {
  _id: identity(),
  tenantId: uuid("Tenant"),
  code: text({ default: randomUUID }),
  label: text({ max: 150 }),
  campaign: text({ nullable: true, max: 150 }),
  active: bool(true),
});
qrCodeSchema.index({ code: 1 }, { unique: true });
tenantIdentity(qrCodeSchema);
