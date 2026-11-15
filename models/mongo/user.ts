import {
  date,
  defineSchema,
  identity,
  tenantIdentity,
  text,
  uuid,
  type UserDocument,
} from "./shared.js";
export const userSchema = defineSchema<UserDocument>(
  "users",
  {
    _id: identity(),
    tenantId: uuid("Tenant"),
    email: text({ max: 254, pattern: /^[^A-Z]*$/ }),
    passwordHash: text({ secret: true }),
    firstName: text({ max: 80 }),
    lastName: text({ max: 80 }),
    role: text({
      values: ["OWNER", "DISPATCHER", "RIDER"],
      default: "DISPATCHER",
    }),
    emailVerifiedAt: date(true),
    createdAt: date(false, true),
    updatedAt: date(false, true),
  },
  { updatedAt: true, secrets: ["passwordHash"] },
);
// Unicode lowercase equality mirrors the SQL check without silently lowercasing stored values.
userSchema
  .path("email")
  .validate(
    (v: string) => v === v.toLowerCase(),
    "Email must already be lowercase",
  );
userSchema.index({ tenantId: 1, email: 1 }, { unique: true });
tenantIdentity(userSchema);
userSchema.index({ email: 1 });
