import { randomUUID } from "node:crypto";
import { Schema, Types, type SchemaDefinition } from "mongoose";

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type StringRules<T extends string> = {
  nullable?: boolean;
  max?: number;
  pattern?: RegExp;
  values?: readonly T[];
  default?: T | (() => T);
  secret?: boolean;
  ref?: string;
};
export function text<const T extends string = string>(
  rules: StringRules<T> = {},
) {
  return {
    type: String,
    required: !rules.nullable,
    default: rules.default ?? (rules.nullable ? null : undefined),
    ...(rules.values ? { enum: rules.values } : {}),
    ...(rules.secret ? { select: false } : {}),
    ...(rules.ref ? { ref: rules.ref } : {}),
    set(value: unknown) {
      if (value != null && typeof value !== "string")
        throw new Error("Expected a string without coercion");
      return value;
    },
    validate: {
      validator: (value: string | null | undefined) =>
        value == null
          ? !!rules.nullable
          : !value.includes("\0") &&
            (rules.max === undefined ||
              Array.from(value).length <= rules.max) &&
            (!rules.pattern || rules.pattern.test(value)) &&
            (!rules.values ||
              (rules.values as readonly string[]).includes(value)),
      message: "String violates PostgreSQL length, format or enum constraint",
    },
  };
}
export const uuid = (ref?: string, nullable = false) =>
  text({ ref, nullable, pattern: UUID });
export const identity = () => ({ ...uuid(), default: randomUUID });
export const date = (nullable = false, now = false) => ({
  type: Date,
  required: !nullable,
  ...(now ? { default: Date.now } : nullable ? { default: null } : {}),
});
export const bool = (fallback: boolean) => ({
  type: Boolean,
  required: true,
  default: fallback,
  set(value: unknown) {
    if (value != null && typeof value !== "boolean")
      throw new Error("Expected a boolean without coercion");
    return value;
  },
});
export function integer(
  min = -2147483648,
  max = 2147483647,
  fallback?: number,
) {
  return {
    type: Number,
    required: true,
    ...(fallback !== undefined ? { default: fallback } : {}),
    set(value: unknown) {
      if (value != null && typeof value !== "number")
        throw new Error("Expected an integer number");
      return value;
    },
    validate: {
      validator: (value: number) =>
        Number.isInteger(value) && value >= min && value <= max,
      message: "Integer outside PostgreSQL range",
    },
  };
}

/** Convert to scaled units using integers only; never round or pass decimals through JS Number. */
export function decimalUnits(value: string, scale: number): bigint | null {
  const m = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!m) return null;
  const coefficient = BigInt(m[2] + (m[3] ?? ""));
  if (coefficient === 0n) return 0n;
  const power = Number(m[4] ?? 0) - (m[3]?.length ?? 0) + scale;
  if (!Number.isInteger(power) || Math.abs(power) > 100) return null;
  const factor = 10n ** BigInt(Math.abs(power));
  if (power < 0 && coefficient % factor !== 0n) return null;
  const units = power >= 0 ? coefficient * factor : coefficient / factor;
  return m[1] === "-" ? -units : units;
}
export function decimal(
  precision: number,
  scale: number,
  min: string,
  max: string,
  nullable = false,
  allowNaN = false,
) {
  const lower = decimalUnits(min, scale)!,
    upper = decimalUnits(max, scale)!;
  return {
    type: Schema.Types.Decimal128,
    required: !nullable,
    ...(nullable ? { default: null } : {}),
    set(value: unknown) {
      if (
        value != null &&
        typeof value !== "string" &&
        !(value instanceof Types.Decimal128)
      )
        throw new Error(
          "Supply an exact decimal string or Decimal128, never a JS number",
        );
      return value;
    },
    validate: {
      validator: (value: Types.Decimal128 | null | undefined) => {
        if (value == null) return nullable;
        if (allowNaN && value.toString() === "NaN") return true;
        const units = decimalUnits(value.toString(), scale);
        return (
          units !== null &&
          units > -(10n ** BigInt(precision)) &&
          units < 10n ** BigInt(precision) &&
          units >= lower &&
          units <= upper
        );
      },
      message: "Decimal violates precision, scale, finiteness or range",
    },
  };
}
// PostgreSQL numeric NaN satisfies >= 0. Preserve it; reject infinities and never invent rounding.
export const money = () => decimal(12, 2, "0", "9999999999.99", false, true);
export const latitude = (nullable = false) =>
  decimal(9, 6, "-90", "90", nullable);
export const longitude = (nullable = false) =>
  decimal(9, 6, "-180", "180", nullable);
export const currency = () =>
  text({ max: 3, pattern: /^[A-Z]{3}$/, default: "NGN" });

export function defineSchema<T>(
  collection: string,
  definition: SchemaDefinition<T>,
  options: { updatedAt?: boolean; secrets?: string[] } = {},
) {
  const redact = (_doc: unknown, result: Record<string, unknown>) => {
    for (const field of options.secrets ?? []) delete result[field];
    return result;
  };
  const schema = new Schema<T>(definition, {
    collection,
    strict: "throw",
    strictQuery: "throw",
    autoCreate: false,
    autoIndex: false,
    bufferCommands: false,
    versionKey: false,
    id: false,
    timestamps: options.updatedAt
      ? { createdAt: false, updatedAt: "updatedAt" }
      : false,
    toJSON: { transform: redact },
    toObject: { transform: redact },
  });
  // A SQL NOT NULL VARCHAR/TEXT accepts ''. Change only these local paths, not Mongoose globals.
  schema.eachPath((_name, path) => {
    if (path.instance === "String")
      Object.defineProperty(path, "checkRequired", {
        value: (value: unknown) => typeof value === "string",
      });
  });
  return schema;
}
export function nullableUnique(schema: Schema, field: string) {
  schema.index(
    { [field]: 1 },
    {
      unique: true,
      name: `${field}_unique_when_string`,
      partialFilterExpression: { [field]: { $type: "string" } },
    },
  );
}
export function tenantIdentity(schema: Schema) {
  schema.index({ tenantId: 1, _id: 1 }, { unique: true });
}

export interface Identity {
  _id: string;
}
export interface TenantDocument extends Identity {
  name: string;
  subdomain: string;
  tagline: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  secondaryColor: string | null;
  currency: string;
  createdAt: Date;
}
export interface UserDocument extends Identity {
  tenantId: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: "OWNER" | "DISPATCHER" | "RIDER";
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface RefreshTokenDocument extends Identity {
  tenantId: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}
export interface RiderDocument extends Identity {
  tenantId: string;
  userId: string;
  available: boolean;
  onboardingStatus: "INVITED" | "PENDING" | "APPROVED" | "REJECTED";
  phone: string | null;
  invitationHash: string | null;
  invitationExpiresAt: Date | null;
  latitude: Types.Decimal128 | null;
  longitude: Types.Decimal128 | null;
  locationAt: Date | null;
  locationSource: string | null;
  bikeSerial: string | null;
}
export interface BikeDocument extends Identity {
  tenantId: string;
  serialNumber: string;
  batteryPercent: number;
}
export interface CustomerDocument extends Identity {
  tenantId: string;
  name: string;
  phone: string;
  email: string | null;
}
export interface QrCodeDocument extends Identity {
  tenantId: string;
  code: string;
  label: string;
  campaign: string | null;
  active: boolean;
}
export interface QrScanDocument extends Identity {
  qrCodeId: string;
  scannedAt: Date;
}
export type OrderState =
  | "PENDING"
  | "ASSIGNED"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "CANCELLED";
export interface OrderDocument extends Identity {
  tenantId: string;
  customerId: string;
  riderId: string | null;
  bikeId: string | null;
  qrCodeId: string | null;
  trackingCode: string;
  pickupAddress: string;
  deliveryAddress: string;
  recipientName: string;
  recipientPhone: string;
  packageSize: "SMALL" | "MEDIUM" | "LARGE";
  notes: string | null;
  status: OrderState;
  deliveryFee: Types.Decimal128;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  proofFileId: string | null;
  proofRecipient: string | null;
  pickupLatitude: Types.Decimal128 | null;
  pickupLongitude: Types.Decimal128 | null;
  deliveryLatitude: Types.Decimal128 | null;
  deliveryLongitude: Types.Decimal128 | null;
}
export interface StoredFileDocument extends Identity {
  tenantId: string;
  userId: string;
  key: string;
  filename: string;
  contentType: string;
  size: number;
  purpose: "LICENSE" | "INSURANCE" | "PROOF";
  createdAt: Date;
}
export interface OrderEventDocument extends Identity {
  orderId: string;
  status: OrderState;
  note: string | null;
  createdAt: Date;
}
export interface TrackingPointDocument extends Identity {
  orderId: string;
  latitude: Types.Decimal128;
  longitude: Types.Decimal128;
  recordedAt: Date;
  source: "LEGACY" | "GPS";
  accuracy: number | null;
}
export interface PaymentDocument extends Identity {
  orderId: string;
  providerReference: string | null;
  amount: Types.Decimal128;
  currency: string;
  status: "PENDING" | "PAID" | "FAILED" | "REFUNDED";
  createdAt: Date;
}
