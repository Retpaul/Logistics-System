// Customer-facing endpoints. The tenant comes from the QR code or tracking code only.
import type { Tenant } from "@prisma/client";
import {
  PublicBookingRequest,
  type PublicBookingResponse,
  type PublicBranding,
  type PublicQrResponse,
  type PublicTrackResponse,
} from "../contracts/index.js";
import { notFound } from "../lib/errors.js";
import { ordersRepository, qrCodesRepository } from "../repositories/index.js";
import { placeOrder } from "./orders.js";
import { priceTable } from "./pricing.js";

const branding = (t: Pick<Tenant, "name" | "tagline" | "logoUrl" | "brandColor" | "secondaryColor">): PublicBranding => ({
  name: t.name,
  tagline: t.tagline,
  logoUrl: t.logoUrl,
  brandColor: t.brandColor,
  secondaryColor: t.secondaryColor,
});

async function activeQr(code: string) {
  const qr = await qrCodesRepository.findActiveByCode(code);
  if (!qr) throw notFound("QR code");
  return qr;
}

export async function getQrLanding(code: string): Promise<PublicQrResponse> {
  const qr = await activeQr(code);
  await qrCodesRepository.recordScan(qr.id);
  return {
    qrCode: { code: qr.code, label: qr.label },
    tenant: branding(qr.tenant),
    currency: qr.tenant.currency,
    prices: priceTable(),
  };
}

export async function bookViaQr(code: string, input: unknown): Promise<PublicBookingResponse> {
  const qr = await activeQr(code);
  const b = PublicBookingRequest.parse(input);
  const order = await placeOrder(
    qr.tenantId,
    {
      customer: { name: b.customerName, phone: b.customerPhone, email: b.customerEmail },
      pickupAddress: b.pickupAddress,
      deliveryAddress: b.deliveryAddress,
      recipientName: b.recipientName,
      recipientPhone: b.recipientPhone,
      packageSize: b.packageSize,
      notes: b.notes,
    },
    { qrCodeId: qr.id, note: `Booked via QR code "${qr.label}"` },
  );
  return { trackingCode: order.trackingCode };
}

export async function trackOrder(trackingCode: string): Promise<PublicTrackResponse> {
  const o = trackingCode.length <= 64 ? await ordersRepository.findForTracking(trackingCode) : null;
  if (!o) throw notFound("Order");
  const last = o.locations[0];
  return {
    trackingCode: o.trackingCode,
    status: o.status,
    packageSize: o.packageSize,
    pickupAddress: o.pickupAddress,
    deliveryAddress: o.deliveryAddress,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    tenant: branding(o.tenant),
    rider: o.rider ? { firstName: o.rider.user.firstName } : null,
    events: o.events.map((e) => ({ status: e.status, createdAt: e.createdAt.toISOString() })),
    lastLocation: last
      ? { latitude: Number(last.latitude), longitude: Number(last.longitude), recordedAt: last.recordedAt.toISOString() }
      : null,
  };
}
