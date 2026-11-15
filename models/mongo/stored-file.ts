import {
  date,
  defineSchema,
  identity,
  integer,
  text,
  uuid,
  type StoredFileDocument,
} from "./shared.js";
export const storedFileSchema = defineSchema<StoredFileDocument>(
  "storedfiles",
  {
    _id: identity(),
    tenantId: uuid("Tenant"),
    userId: uuid("User"),
    key: text(),
    filename: text({ max: 120 }),
    contentType: text({ max: 127 }),
    size: integer(1),
    purpose: text({ max: 20, values: ["LICENSE", "INSURANCE", "PROOF"] }),
    createdAt: date(false, true),
  },
);
storedFileSchema.index({ key: 1 }, { unique: true });
storedFileSchema.index({ tenantId: 1, userId: 1, purpose: 1 });
