import type { Connection, Model, Schema } from "mongoose";
import { tenantSchema } from "./tenant.js";
import { userSchema } from "./user.js";
import { refreshTokenSchema } from "./refresh-token.js";
import { riderSchema } from "./rider.js";
import { bikeSchema } from "./bike.js";
import { customerSchema } from "./customer.js";
import { qrCodeSchema } from "./qr-code.js";
import { qrScanSchema } from "./qr-scan.js";
import { orderSchema } from "./order.js";
import { storedFileSchema } from "./stored-file.js";
import { orderEventSchema } from "./order-event.js";
import { trackingPointSchema } from "./tracking-point.js";
import { paymentSchema } from "./payment.js";

export const mongoSchemas = {
  Tenant: tenantSchema,
  User: userSchema,
  RefreshToken: refreshTokenSchema,
  Rider: riderSchema,
  Bike: bikeSchema,
  Customer: customerSchema,
  QrCode: qrCodeSchema,
  QrScan: qrScanSchema,
  Order: orderSchema,
  StoredFile: storedFileSchema,
  OrderEvent: orderEventSchema,
  TrackingPoint: trackingPointSchema,
  Payment: paymentSchema,
};
function register<T>(
  connection: Connection,
  name: string,
  schema: Schema<T>,
): Model<T> {
  const existing = connection.models[name];
  if (existing && existing.schema !== schema)
    throw new Error(`Refusing to reuse an unrelated MongoDB model: ${name}`);
  return (
    (existing as Model<T> | undefined) ?? connection.model<T>(name, schema)
  );
}
/** Registration only: never opens a connection, creates collections/indexes or queries a database. */
export function createMongoModels(connection: Connection) {
  return {
    Tenant: register(connection, "Tenant", tenantSchema),
    User: register(connection, "User", userSchema),
    RefreshToken: register(connection, "RefreshToken", refreshTokenSchema),
    Rider: register(connection, "Rider", riderSchema),
    Bike: register(connection, "Bike", bikeSchema),
    Customer: register(connection, "Customer", customerSchema),
    QrCode: register(connection, "QrCode", qrCodeSchema),
    QrScan: register(connection, "QrScan", qrScanSchema),
    Order: register(connection, "Order", orderSchema),
    StoredFile: register(connection, "StoredFile", storedFileSchema),
    OrderEvent: register(connection, "OrderEvent", orderEventSchema),
    TrackingPoint: register(connection, "TrackingPoint", trackingPointSchema),
    Payment: register(connection, "Payment", paymentSchema),
  };
}
export type MongoModels = ReturnType<typeof createMongoModels>;
export type * from "./shared.js";
