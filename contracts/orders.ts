// Shared API contract: orders (dispatch console).
import { z } from "zod";
import { Email, Id, Money, Phone, Timestamp } from "./common.js";
import { OrderStatus, PackageSize } from "./enums.js";

/** GET /orders query string. Results are newest first; follow `nextCursor` for the next page. */
export const OrderListQuery = z.object({
  status: OrderStatus.optional(),
  riderId: Id.optional(),
  /** Inclusive lower bound on createdAt. The client sends the start of the user's local day for "Today". */
  from: Timestamp.optional(),
  /** Exclusive upper bound on createdAt. */
  to: Timestamp.optional(),
  /** Tracking code (or its first characters) or recipient phone number. */
  q: z.string().trim().min(1).max(64).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type OrderListQuery = z.input<typeof OrderListQuery>;

export const OrderParty = z.object({ id: Id, name: z.string() });

export const OrderListItem = z.object({
  id: Id,
  trackingCode: z.string(),
  status: OrderStatus,
  packageSize: PackageSize,
  pickupAddress: z.string(),
  deliveryAddress: z.string(),
  recipientName: z.string(),
  recipientPhone: z.string(),
  deliveryFee: Money,
  currency: z.string(),
  createdAt: Timestamp,
  customer: OrderParty.extend({ phone: z.string() }),
  rider: OrderParty.nullable(),
});
export type OrderListItem = z.infer<typeof OrderListItem>;

export const OrderListResponse = z.object({
  items: z.array(OrderListItem),
  nextCursor: z.string().nullable(),
});
export type OrderListResponse = z.infer<typeof OrderListResponse>;

export const OrderEvent = z.object({
  status: OrderStatus,
  note: z.string().nullable(),
  createdAt: Timestamp,
});
export type OrderEvent = z.infer<typeof OrderEvent>;

/** GET /orders/:id */
export const OrderDetail = OrderListItem.extend({
  notes: z.string().nullable(),
  updatedAt: Timestamp,
  customer: OrderParty.extend({ phone: z.string(), email: z.string().nullable() }),
  qrCode: z.object({ id: Id, label: z.string() }).nullable(),
  events: z.array(OrderEvent),
});
export type OrderDetail = z.infer<typeof OrderDetail>;

const Address = z.string().trim().min(3, "Enter an address").max(500);
const PersonName = z.string().trim().min(2, "Enter a name").max(150);

/** POST /orders (dispatcher creates an order by hand). The fee is calculated by the server. */
export const CreateOrderRequest = z.object({
  customer: z.object({
    name: PersonName,
    phone: Phone,
    email: Email.optional(),
  }),
  pickupAddress: Address,
  deliveryAddress: Address,
  recipientName: PersonName,
  recipientPhone: Phone,
  packageSize: PackageSize,
  notes: z.string().trim().max(1000).optional(),
});
export type CreateOrderRequest = z.input<typeof CreateOrderRequest>;

/** POST /orders/:id/cancel */
export const CancelOrderRequest = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type CancelOrderRequest = z.input<typeof CancelOrderRequest>;
