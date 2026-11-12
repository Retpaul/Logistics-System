// Shared API contract: the signed-in user's organisation (tenant).
import { z } from "zod";
import { CurrencyCode, HexColor } from "./common.js";
import { TenantSummary } from "./auth.js";

/** GET /tenant */
export const TenantResponse = TenantSummary;
export type TenantResponse = TenantSummary;

/** PATCH /tenant (OWNER). Send only the fields that change; `null` clears an optional field. */
export const UpdateTenantRequest = z
  .object({
    name: z.string().trim().min(2).max(150),
    tagline: z.string().trim().max(200).nullable(),
    brandColor: HexColor.nullable(),
    secondaryColor: HexColor.nullable(),
    currency: CurrencyCode,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");
export type UpdateTenantRequest = z.input<typeof UpdateTenantRequest>;
