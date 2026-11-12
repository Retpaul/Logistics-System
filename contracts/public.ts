// Shared API contract: public endpoints (QR booking and tracking). No login; the tenant is
// resolved from the QR code or the tracking code, never from the request body.
import { z } from "zod";
import { Email, Money, Phone, Timestamp } from "./common.js";
import { OrderStatus, PackageSize } from "./enums.js";

export const PublicBranding = z.object({
  name: z.string(),
  tagline: z.string().nullable(),
  logoUrl: z.string().nullable(),
  brandColor: z.string().nullable(),
  secondaryColor: z.string().nullable(),
});
export type PublicBranding = z.infer<typeof PublicBranding>;

/** GET /public/qr/:code */
export const PublicQrResponse = z.object({
  qrCode: z.object({ code: z.string(), label: z.string() }),
  tenant: PublicBranding,
  currency: z.string(),
  prices: z.record(PackageSize, Money),
});
export type PublicQrResponse = z.infer<typeof PublicQrResponse>;

/** POST /public/qr/:code/orders */
export const PublicBookingRequest = z.object({
  customerName: z.string().trim().min(2, "Enter your name").max(150),
  customerPhone: Phone,
  customerEmail: Email.optional(),
  pickupAddress: z.string().trim().min(3, "Enter the pickup address").max(500),
  deliveryAddress: z.string().trim().min(3, "Enter the delivery address").max(500),
  recipientName: z.string().trim().min(2, "Enter the recipient's name").max(150),
  recipientPhone: Phone,
  packageSize: PackageSize,
  notes: z.string().trim().max(1000).optional(),
});
export type PublicBookingRequest = z.input<typeof PublicBookingRequest>;

export const PublicBookingResponse = z.object({ trackingCode: z.string() });
export type PublicBookingResponse = z.infer<typeof PublicBookingResponse>;

/** GET /public/track/:trackingCode. Deliberately contains no phone numbers or customer details. */
export const PublicTrackResponse = z.object({
  trackingCode: z.string(),
  status: OrderStatus,
  packageSize: PackageSize,
  pickupAddress: z.string(),
  deliveryAddress: z.string(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  tenant: PublicBranding,
  rider: z.object({ firstName: z.string() }).nullable(),
  events: z.array(z.object({ status: OrderStatus, createdAt: Timestamp })),
  lastLocation: z
    .object({ latitude: z.number(), longitude: z.number(), recordedAt: Timestamp })
    .nullable(),
});
export type PublicTrackResponse = z.infer<typeof PublicTrackResponse>;
