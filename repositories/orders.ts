import type { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "../startup/db.js";
import type { Db } from "./db.js";

const riderName = { select: { id: true, user: { select: { firstName: true, lastName: true } } } } as const;

export const orderListSelect = {
  id: true,
  trackingCode: true,
  status: true,
  packageSize: true,
  pickupAddress: true,
  deliveryAddress: true,
  recipientName: true,
  recipientPhone: true,
  deliveryFee: true,
  currency: true,
  createdAt: true,
  customer: { select: { id: true, name: true, phone: true } },
  rider: riderName,
} satisfies Prisma.OrderSelect;

export const orderDetailInclude = {
  customer: true,
  rider: riderName,
  qrCode: { select: { id: true, label: true } },
  events: { orderBy: { createdAt: "asc" }, select: { status: true, note: true, createdAt: true } },
} satisfies Prisma.OrderInclude;

export type OrderListRow = Prisma.OrderGetPayload<{ select: typeof orderListSelect }>;
export type OrderDetailRow = Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>;

export type OrderListFilter = {
  status?: OrderStatus;
  riderId?: string;
  from?: Date;
  to?: Date;
  trackingCodePrefix?: string;
  recipientPhone?: string;
  after?: { createdAt: Date; id: string };
  take: number;
};

class OrdersRepository {
  findById(tenantId: string, id: string, db: Db = prisma) {
    return db.order.findFirst({ where: { id, tenantId }, include: orderDetailInclude });
  }

  /** Newest first, keyset-paginated on (createdAt, id); served by Order_tenantId_createdAt_idx. */
  list(tenantId: string, f: OrderListFilter) {
    const and: Prisma.OrderWhereInput[] = [];
    if (f.trackingCodePrefix) and.push({ trackingCode: { startsWith: f.trackingCodePrefix } });
    if (f.recipientPhone) and.push({ recipientPhone: f.recipientPhone });
    if (f.after) {
      and.push({
        OR: [
          { createdAt: { lt: f.after.createdAt } },
          { createdAt: f.after.createdAt, id: { lt: f.after.id } },
        ],
      });
    }
    return prisma.order.findMany({
      where: {
        tenantId,
        status: f.status,
        riderId: f.riderId,
        createdAt: f.from || f.to ? { gte: f.from, lt: f.to } : undefined,
        AND: and,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: f.take,
      select: orderListSelect,
    });
  }

  findStatus(tenantId: string, id: string, db: Db = prisma) {
    return db.order.findFirst({ where: { id, tenantId }, select: { id: true, status: true } });
  }

  /**
   * Changes status only if it is still `from` (optimistic concurrency) and records the event in
   * the same transaction, as docs/DATABASE.md requires. Returns false if another request won.
   */
  async transition(tenantId: string, id: string, from: OrderStatus, to: OrderStatus, note: string | null, db: Db) {
    const { count } = await db.order.updateMany({ where: { id, tenantId, status: from }, data: { status: to } });
    if (count === 0) return false;
    await db.orderEvent.create({ data: { orderId: id, status: to, note } });
    return true;
  }

  create(tenantId: string, data: Omit<Prisma.OrderUncheckedCreateInput, "tenantId">, db: Db) {
    return db.order.create({ data: { ...data, tenantId }, include: orderDetailInclude });
  }

  /** Public tracking: the tracking code *identifies* the order and tenant. */
  findForTracking(trackingCode: string) {
    return prisma.order.findUnique({
      where: { trackingCode },
      select: {
        trackingCode: true,
        status: true,
        packageSize: true,
        pickupAddress: true,
        deliveryAddress: true,
        createdAt: true,
        updatedAt: true,
        tenant: { select: { name: true, tagline: true, logoUrl: true, brandColor: true, secondaryColor: true } },
        rider: { select: { user: { select: { firstName: true } } } },
        events: { orderBy: { createdAt: "asc" }, select: { status: true, createdAt: true } },
        locations: { orderBy: { recordedAt: "desc" }, take: 1, select: { latitude: true, longitude: true, recordedAt: true } },
      },
    });
  }
}

export const ordersRepository = new OrdersRepository();
