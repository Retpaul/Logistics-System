import {
  currency,
  date,
  defineSchema,
  identity,
  text,
  type TenantDocument,
} from "./shared.js";
export const tenantSchema = defineSchema<TenantDocument>("tenants", {
  _id: identity(),
  name: text({ max: 150 }),
  subdomain: text({ max: 63, pattern: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/ }),
  tagline: text({ nullable: true, max: 200 }),
  logoUrl: text({ nullable: true }),
  brandColor: text({ nullable: true, max: 7, pattern: /^#[0-9a-f]{6}$/ }),
  secondaryColor: text({ nullable: true, max: 7, pattern: /^#[0-9a-f]{6}$/ }),
  currency: currency(),
  createdAt: date(false, true),
});
tenantSchema.index({ subdomain: 1 }, { unique: true });
