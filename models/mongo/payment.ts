import {
  currency,
  date,
  defineSchema,
  identity,
  money,
  nullableUnique,
  text,
  uuid,
  type PaymentDocument,
} from "./shared.js";
export const paymentSchema = defineSchema<PaymentDocument>("payments", {
  _id: identity(),
  orderId: uuid("Order"),
  providerReference: text({ nullable: true }),
  amount: money(),
  currency: currency(),
  status: text({
    values: ["PENDING", "PAID", "FAILED", "REFUNDED"],
    default: "PENDING",
  }),
  createdAt: date(false, true),
});
nullableUnique(paymentSchema, "providerReference");
paymentSchema.index({ orderId: 1 });
