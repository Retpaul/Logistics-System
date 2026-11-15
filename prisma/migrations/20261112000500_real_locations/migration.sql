BEGIN;
ALTER TABLE "Order" ADD COLUMN "pickupLatitude" DECIMAL(9,6), ADD COLUMN "pickupLongitude" DECIMAL(9,6),
 ADD COLUMN "deliveryLatitude" DECIMAL(9,6), ADD COLUMN "deliveryLongitude" DECIMAL(9,6),
 ADD CONSTRAINT "Order_pickup_coordinates" CHECK (("pickupLatitude" IS NULL AND "pickupLongitude" IS NULL) OR ("pickupLatitude" IS NOT NULL AND "pickupLongitude" IS NOT NULL AND "pickupLatitude" BETWEEN -90 AND 90 AND "pickupLongitude" BETWEEN -180 AND 180)),
 ADD CONSTRAINT "Order_delivery_coordinates" CHECK (("deliveryLatitude" IS NULL AND "deliveryLongitude" IS NULL) OR ("deliveryLatitude" IS NOT NULL AND "deliveryLongitude" IS NOT NULL AND "deliveryLatitude" BETWEEN -90 AND 90 AND "deliveryLongitude" BETWEEN -180 AND 180));
-- Keep historical coordinates, but never present unverified seed/import data as device GPS.
ALTER TABLE "TrackingPoint" ADD COLUMN source VARCHAR(10) NOT NULL DEFAULT 'LEGACY', ADD COLUMN accuracy DOUBLE PRECISION,
 ADD CONSTRAINT "TrackingPoint_source" CHECK (source IN ('LEGACY','GPS')),
 ADD CONSTRAINT "TrackingPoint_accuracy" CHECK (accuracy IS NULL OR (accuracy>=0 AND accuracy<=500));
ALTER TABLE "Rider" ADD COLUMN "locationSource" VARCHAR(10);
COMMIT;
