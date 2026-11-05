ALTER TABLE "Bike" ADD CONSTRAINT "Bike_battery_range" CHECK ("batteryPercent" BETWEEN 0 AND 100);
ALTER TABLE "Order" ADD CONSTRAINT "Order_fee_nonnegative" CHECK ("deliveryFee" >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_nonnegative" CHECK ("amount" >= 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "TrackingPoint" ADD CONSTRAINT "TrackingPoint_latitude_range" CHECK ("latitude" BETWEEN -90 AND 90);
ALTER TABLE "TrackingPoint" ADD CONSTRAINT "TrackingPoint_longitude_range" CHECK ("longitude" BETWEEN -180 AND 180);
