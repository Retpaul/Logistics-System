import type { PackageSize } from "@prisma/client";
import {
  CancelOrderRequest,
  CreateOrderRequest,
  Id,
  OrderListQuery,
  type OrderDetail,
  type OrderListResponse,
} from "../contracts/index.js";
import { AppError, notFound } from "../lib/errors.js";
import { customersRepository, ordersRepository, tenantsRepository } from "../repositories/index.js";
import { prisma } from "../startup/db.js";
import { toOrderDetail, toOrderListItem } from "./mappers.js";
import { assertTransition } from "./orderStatus.js";
import { feeFor } from "./pricing.js";

const PHONE_LIKE = /^\+?[0-9][0-9 ()-]{5,}$/;

const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString("base64url");

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const [iso, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [string, string];
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()) || !Id.safeParse(id).success) throw new Error("bad cursor");
    return { createdAt, id };
  } catch {
    throw new AppError(400, "VALIDATION_FAILED", "Invalid cursor");
  }
}

export async function listOrders(tenantId: string, rawQuery: unknown): Promise<OrderListResponse> {
  const query = OrderListQuery.parse(rawQuery);
  const q = query.q;
  const rows = await ordersRepository.list(tenantId, {
    status: query.status,
    riderId: query.riderId,
    from: query.from ? new Date(query.from) : undefined,
    to: query.to ? new Date(query.to) : undefined,
    recipientPhone: q && PHONE_LIKE.test(q) ? q.replace(/[\s()-]/g, "") : undefined,
    trackingCodePrefix: q && !PHONE_LIKE.test(q) ? q.toLowerCase().replace(/^#/, "") : undefined,
    after: query.cursor ? decodeCursor(query.cursor) : undefined,
    take: query.limit + 1,
  });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toOrderListItem),
    nextCursor: rows.length > query.limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export async function getOrder(tenantId: string, id: string): Promise<OrderDetail> {
  // A malformed id or another tenant's id both look like "not found": never reveal existence.
  if (!Id.safeParse(id).success) throw notFound("Order");
  const order = await ordersRepository.findById(tenantId, id);
  if (!order) throw notFound("Order");
  return toOrderDetail(order);
}

type NewOrder = {
  customer: { name: string; phone: string; email?: string };
  pickupAddress: string;
  deliveryAddress: string;
  recipientName: string;
  recipientPhone: string;
  packageSize: PackageSize;
  notes?: string;
};

/** Shared by the dispatch console and public QR booking. Customer is matched by phone within the tenant. */
export async function placeOrder(
  tenantId: string,
  order: NewOrder,
  source: { qrCodeId?: string; note: string },
): Promise<OrderDetail> {
  const created = await prisma.$transaction(async (tx) => {
    const tenant = await tenantsRepository.findById(tenantId, tx);
    if (!tenant) throw notFound("Organisation");
    const customer =
      (await customersRepository.findByPhone(tenantId, order.customer.phone, tx)) ??
      (await customersRepository.create(tenantId, order.customer, tx));

    return ordersRepository.create(
      tenantId,
      {
        customerId: customer.id,
        qrCodeId: source.qrCodeId,
        pickupAddress: order.pickupAddress,
        deliveryAddress: order.deliveryAddress,
        recipientName: order.recipientName,
        recipientPhone: order.recipientPhone,
        packageSize: order.packageSize,
        notes: order.notes,
        deliveryFee: feeFor(order.packageSize),
        currency: tenant.currency,
        events: { create: { status: "PENDING", note: source.note } },
      },
      tx,
    );
  });
  return toOrderDetail(created);
}

export async function createOrder(tenantId: string, input: unknown): Promise<OrderDetail> {
  return placeOrder(tenantId, CreateOrderRequest.parse(input), { note: "Created by dispatcher" });
}

export async function cancelOrder(tenantId: string, id: string, input: unknown): Promise<OrderDetail> {
  const { reason } = CancelOrderRequest.parse(input ?? {});
  if (!Id.safeParse(id).success) throw notFound("Order");
  const current = await ordersRepository.findStatus(tenantId, id);
  if (!current) throw notFound("Order");
  assertTransition(current.status, "CANCELLED", "STAFF");

  const changed = await prisma.$transaction((tx) =>
    ordersRepository.transition(tenantId, id, current.status, "CANCELLED", reason || "Cancelled by dispatcher", tx),
  );
  if (!changed) throw new AppError(409, "CONFLICT", "The order was updated by someone else. Reload and try again.");
  return getOrder(tenantId, id);
}
