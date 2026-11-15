import {
  date,
  defineSchema,
  identity,
  text,
  uuid,
  type RefreshTokenDocument,
} from "./shared.js";
export const refreshTokenSchema = defineSchema<RefreshTokenDocument>(
  "refreshtokens",
  {
    _id: identity(),
    tenantId: uuid("Tenant"),
    userId: uuid("User"),
    familyId: uuid(),
    tokenHash: text({ max: 64, secret: true }),
    expiresAt: date(),
    revokedAt: date(true),
    createdAt: date(false, true),
  },
  { secrets: ["tokenHash"] },
);
refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
refreshTokenSchema.index({ tenantId: 1, userId: 1 });
refreshTokenSchema.index({ familyId: 1 });
