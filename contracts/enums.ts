// Shared API contract: enums. Source of truth for server and client.
// Must stay equal to the Prisma enums; lib/contractParity.ts fails `npm run typecheck` if they drift.
import { z } from "zod";

export const OrderStatus = z.enum(["PENDING", "ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELIVERED", "CANCELLED"]);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const Role = z.enum(["OWNER", "DISPATCHER", "RIDER"]);
export type Role = z.infer<typeof Role>;

export const PaymentStatus = z.enum(["PENDING", "PAID", "FAILED", "REFUNDED"]);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

export const PackageSize = z.enum(["SMALL", "MEDIUM", "LARGE"]);
export type PackageSize = z.infer<typeof PackageSize>;

/** Orders that are still being worked on (shown on the fleet map and rider app). */
export const ACTIVE_ORDER_STATUSES = ["PENDING", "ASSIGNED", "PICKED_UP", "IN_TRANSIT"] as const satisfies readonly OrderStatus[];

/** Roles that may use the dispatch console (/admin). */
export const STAFF_ROLES = ["OWNER", "DISPATCHER"] as const satisfies readonly Role[];
