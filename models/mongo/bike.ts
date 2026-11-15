import {
  defineSchema,
  identity,
  integer,
  tenantIdentity,
  text,
  uuid,
  type BikeDocument,
} from "./shared.js";
export const bikeSchema = defineSchema<BikeDocument>("bikes", {
  _id: identity(),
  tenantId: uuid("Tenant"),
  serialNumber: text({ max: 100 }),
  batteryPercent: integer(0, 100, 100),
});
bikeSchema.index({ tenantId: 1, serialNumber: 1 }, { unique: true });
tenantIdentity(bikeSchema);
