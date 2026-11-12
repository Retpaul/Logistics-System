// Prisma rows → shared contract DTOs. Dates become ISO strings and decimals become strings,
// so responses match the contract types exactly.
import type { Tenant, User } from "@prisma/client";
import type {
  OrderDetail,
  OrderListItem,
  SessionUser,
  TenantSummary,
} from "../contracts/index.js";
import type { OrderDetailRow, OrderListRow } from "../repositories/orders.js";

export const toTenantSummary = (t: Tenant): TenantSummary => ({
  id: t.id,
  name: t.name,
  slug: t.subdomain,
  tagline: t.tagline,
  logoUrl: t.logoUrl,
  brandColor: t.brandColor,
  secondaryColor: t.secondaryColor,
  currency: t.currency,
});

export const toSessionUser = (u: User): SessionUser => ({
  id: u.id,
  email: u.email,
  firstName: u.firstName,
  lastName: u.lastName,
  role: u.role,
});

const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();

export const toOrderListItem = (o: OrderListRow): OrderListItem => ({
  id: o.id,
  trackingCode: o.trackingCode,
  status: o.status,
  packageSize: o.packageSize,
  pickupAddress: o.pickupAddress,
  deliveryAddress: o.deliveryAddress,
  recipientName: o.recipientName,
  recipientPhone: o.recipientPhone,
  deliveryFee: o.deliveryFee.toFixed(2),
  currency: o.currency,
  createdAt: o.createdAt.toISOString(),
  customer: { id: o.customer.id, name: o.customer.name, phone: o.customer.phone },
  rider: o.rider ? { id: o.rider.id, name: fullName(o.rider.user) } : null,
});

export const toOrderDetail = (o: OrderDetailRow): OrderDetail => ({
  ...toOrderListItem(o),
  notes: o.notes,
  updatedAt: o.updatedAt.toISOString(),
  customer: { id: o.customer.id, name: o.customer.name, phone: o.customer.phone, email: o.customer.email },
  qrCode: o.qrCode,
  events: o.events.map((e) => ({ status: e.status, note: e.note, createdAt: e.createdAt.toISOString() })),
});
