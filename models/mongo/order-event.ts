import {
  date,
  defineSchema,
  identity,
  text,
  uuid,
  type OrderEventDocument,
} from "./shared.js";
import { ORDER_STATUSES } from "./order.js";
export const orderEventSchema = defineSchema<OrderEventDocument>(
  "orderevents",
  {
    _id: identity(),
    orderId: uuid("Order"),
    status: text({ values: ORDER_STATUSES }),
    note: text({ nullable: true }),
    createdAt: date(false, true),
  },
);
orderEventSchema.index({ orderId: 1, status: 1, createdAt: 1 });
