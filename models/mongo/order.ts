import { randomUUID } from "node:crypto";
import {
  currency,
  date,
  defineSchema,
  identity,
  latitude,
  longitude,
  money,
  text,
  uuid,
  type OrderDocument,
} from "./shared.js";
export const ORDER_STATUSES = [
  "PENDING",
  "ASSIGNED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
  "CANCELLED",
] as const;
export const orderSchema = defineSchema<OrderDocument>(
  "orders",
  {
    _id: identity(),
    tenantId: uuid("Tenant"),
    customerId: uuid("Customer"),
    riderId: uuid("Rider", true),
    bikeId: uuid("Bike", true),
    qrCodeId: uuid("QrCode", true),
    trackingCode: text({ default: randomUUID }),
    pickupAddress: text(),
    deliveryAddress: text(),
    recipientName: text({ max: 150 }),
    recipientPhone: text({ max: 25 }),
    packageSize: text({
      values: ["SMALL", "MEDIUM", "LARGE"],
      default: "MEDIUM",
    }),
    notes: text({ nullable: true, max: 1000 }),
    status: text({ values: ORDER_STATUSES, default: "PENDING" }),
    deliveryFee: money(),
    currency: currency(),
    createdAt: date(false, true),
    updatedAt: date(false, true),
    pickedUpAt: date(true),
    deliveredAt: date(true),
    proofFileId: uuid("StoredFile", true),
    proofRecipient: text({ nullable: true, max: 150 }),
    pickupLatitude: latitude(true),
    pickupLongitude: longitude(true),
    deliveryLatitude: latitude(true),
    deliveryLongitude: longitude(true),
  },
  { updatedAt: true },
);
// Path validators work with both validate() and validateSync(); query updates still need service checks.
for (const [lat, lng] of [
  ["pickupLatitude", "pickupLongitude"],
  ["deliveryLatitude", "deliveryLongitude"],
] as const) {
  for (const [field, counterpart] of [
    [lat, lng],
    [lng, lat],
  ] as const) {
    orderSchema.path(field).validate(function (
      this: OrderDocument,
      value: unknown,
    ) {
      return (value == null) === (this[counterpart] == null);
    }, "Both coordinates must be null or both present");
  }
}
orderSchema.index({ trackingCode: 1 }, { unique: true });
orderSchema.index({ tenantId: 1, status: 1, createdAt: 1 });
orderSchema.index({ tenantId: 1, createdAt: 1 });
orderSchema.index({ tenantId: 1, deliveredAt: 1 });
orderSchema.index({ tenantId: 1, customerId: 1 });
orderSchema.index({ tenantId: 1, riderId: 1, createdAt: 1 });
orderSchema.index({ tenantId: 1, bikeId: 1 });
orderSchema.index({ tenantId: 1, qrCodeId: 1, createdAt: 1 });
orderSchema.index({ tenantId: 1, recipientPhone: 1 });
orderSchema.index(
  { riderId: 1 },
  {
    name: "Order_one_active_per_rider",
    unique: true,
    partialFilterExpression: {
      riderId: { $type: "string" },
      status: { $in: ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"] },
    },
  },
);
