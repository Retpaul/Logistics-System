import { z } from "zod";
import { Email, Id, Phone, GeoPoint } from "./common.js";
export const OrderLocationsRequest = z.object({
  pickupLocation: GeoPoint,
  deliveryLocation: GeoPoint,
});
import { Password } from "./auth.js";
import type { OrderListItem } from "./orders.js";
export const InviteRiderRequest = z.object({
  email: Email,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: Phone,
  bikeSerial: z.string().trim().max(100).optional(),
});
export const AcceptInvitationRequest = z.object({
  token: z.string().min(40).max(100),
  password: Password,
});
export const RiderApprovalRequest = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
});
export const AvailabilityRequest = z.object({ available: z.boolean() });
export const AssignOrderRequest = z.object({ riderId: Id });
export const RiderTransitionRequest = z.object({
  status: z.enum(["PENDING", "PICKED_UP", "IN_TRANSIT", "DELIVERED"]),
  proofFileId: Id.optional(),
  recipientName: z.string().trim().min(2).max(150).optional(),
});
export const LocationRequest = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(500),
  capturedAt: z.iso
    .datetime({ offset: true })
    .refine(
      (value) =>
        Date.now() - Date.parse(value) <= 60000 &&
        Date.parse(value) - Date.now() <= 30000,
      "GPS report is stale or in the future",
    ),
});
export const QrWriteRequest = z.object({
  label: z.string().trim().min(1).max(150),
  campaign: z.string().trim().max(150).nullable().optional(),
  active: z.boolean().optional(),
});
export const AnalyticsQuery = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    timezone: z.string().max(80).default("Africa/Lagos"),
  })
  .refine(
    (v) =>
      Date.parse(v.to) > Date.parse(v.from) &&
      Date.parse(v.to) - Date.parse(v.from) <= 31 * 86400000,
    "Select a range of at most 31 days",
  );
export interface RiderRecord {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  bikeSerial: string | null;
  onboardingStatus: string;
  available: boolean;
  latitude: number | null;
  longitude: number | null;
  locationAt: string | null;
  documents: { id: string; filename: string }[];
  activeOrder: OrderListItem | null;
}
export interface RiderWorkspace {
  rider: RiderRecord;
  jobs: OrderListItem[];
  availableJobs: Pick<
    OrderListItem,
    | "id"
    | "trackingCode"
    | "pickupAddress"
    | "deliveryAddress"
    | "packageSize"
    | "deliveryFee"
    | "currency"
    | "createdAt"
  >[];
}
export interface QrRecord {
  id: string;
  code: string;
  label: string;
  campaign: string | null;
  active: boolean;
  scans: number;
  orders: number;
  fees: string;
  conversion: number;
}
export interface AnalyticsResponse {
  total: number;
  delivered: number;
  active: number;
  fees: string;
  currency: string;
  trend: { name: string; orders: number }[];
  hourly: { time: string; amount: number }[];
  leaderboard: {
    riderId: string;
    name: string;
    deliveries: number;
    avgMinutes: number | null;
  }[];
}
export interface UploadResponse {
  id: string;
  filename: string;
}
