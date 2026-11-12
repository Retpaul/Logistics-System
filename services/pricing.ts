import { Prisma } from "@prisma/client";
import type { PackageSize } from "../contracts/index.js";

// Flat fee per package size, in the tenant's currency. Pricing rules per tenant (US-19,
// distance and zones) replace this table in a later phase; the API already returns the
// computed fee, so clients will not need to change.
const FEES: Record<PackageSize, string> = {
  SMALL: "1500.00",
  MEDIUM: "2500.00",
  LARGE: "4000.00",
};

export const feeFor = (size: PackageSize) => new Prisma.Decimal(FEES[size]);

export const priceTable = (): Record<PackageSize, string> => ({ ...FEES });
