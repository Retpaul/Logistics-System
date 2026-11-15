import {
  defineSchema,
  identity,
  tenantIdentity,
  text,
  uuid,
  type CustomerDocument,
} from "./shared.js";
export const customerSchema = defineSchema<CustomerDocument>("customers", {
  _id: identity(),
  tenantId: uuid("Tenant"),
  name: text({ max: 150 }),
  phone: text({ max: 25 }),
  email: text({ nullable: true, max: 254 }),
});
tenantIdentity(customerSchema);
customerSchema.index({ tenantId: 1, phone: 1 });
