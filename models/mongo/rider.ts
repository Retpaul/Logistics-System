import {
  bool,
  date,
  defineSchema,
  identity,
  latitude,
  longitude,
  nullableUnique,
  tenantIdentity,
  text,
  uuid,
  type RiderDocument,
} from "./shared.js";
export const riderSchema = defineSchema<RiderDocument>(
  "riders",
  {
    _id: identity(),
    tenantId: uuid("Tenant"),
    userId: uuid("User"),
    available: bool(false),
    onboardingStatus: text({
      max: 20,
      values: ["INVITED", "PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    }),
    phone: text({ nullable: true, max: 25 }),
    invitationHash: text({ nullable: true, max: 64, secret: true }),
    invitationExpiresAt: date(true),
    latitude: latitude(true),
    longitude: longitude(true),
    locationAt: date(true),
    locationSource: text({ nullable: true, max: 10 }),
    bikeSerial: text({ nullable: true, max: 100 }),
  },
  { secrets: ["invitationHash"] },
);
riderSchema.index({ userId: 1 }, { unique: true });
riderSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
tenantIdentity(riderSchema);
nullableUnique(riderSchema, "invitationHash");
