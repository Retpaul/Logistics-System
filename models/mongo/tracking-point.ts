import {
  date,
  defineSchema,
  identity,
  latitude,
  longitude,
  text,
  uuid,
  type TrackingPointDocument,
} from "./shared.js";
export const trackingPointSchema = defineSchema<TrackingPointDocument>(
  "trackingpoints",
  {
    _id: identity(),
    orderId: uuid("Order"),
    latitude: latitude(),
    longitude: longitude(),
    recordedAt: date(false, true),
    source: text({ max: 10, values: ["LEGACY", "GPS"], default: "LEGACY" }),
    accuracy: {
      type: Number,
      default: null,
      set(value: unknown) {
        if (value != null && typeof value !== "number")
          throw new Error("Expected numeric accuracy");
        return value;
      },
      validate: {
        validator: (v: number | null | undefined) =>
          v == null || (Number.isFinite(v) && v >= 0 && v <= 500),
        message: "Accuracy must be null or 0–500 metres",
      },
    },
  },
);
trackingPointSchema.index({ orderId: 1, recordedAt: 1 });
