import {
  AnalyticsQuery,
  QrWriteRequest,
  Id,
  type AnalyticsResponse,
  type QrRecord,
} from "../contracts/index.js";
import { prisma } from "../startup/db.js";
import { notFound, AppError } from "../lib/errors.js";
import { config } from "../config/index.js";
import { publish } from "../startup/realtime.js";

export async function analytics(
  tenantId: string,
  raw: unknown,
): Promise<AnalyticsResponse> {
  const { from, to, timezone } = AnalyticsQuery.parse(raw);
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw new AppError(400, "VALIDATION_FAILED", "Invalid timezone");
  }
  const start = new Date(from),
    end = new Date(to);
  const rows = await prisma.$queryRaw<
    { total: number; delivered: number; active: number; fees: string }[]
  >`
    SELECT count(*)::int total,
    (SELECT count(*)::int FROM "Order" d WHERE d."tenantId"=${tenantId}::uuid AND d.status='DELIVERED' AND d."deliveredAt">=${start} AND d."deliveredAt"<${end}) delivered,
    (SELECT count(*)::int FROM "Order" a WHERE a."tenantId"=${tenantId}::uuid AND a.status IN ('PENDING','ASSIGNED','PICKED_UP','IN_TRANSIT')) active,
    coalesce(sum("deliveryFee") FILTER(WHERE status<>'CANCELLED'),0)::text fees
    FROM "Order" WHERE "tenantId"=${tenantId}::uuid AND "createdAt">=${start} AND "createdAt"<${end}`;
  const trend = await prisma.$queryRaw<{ name: string; orders: number }[]>`
    SELECT to_char(day,'YYYY-MM-DD') name,count(o.id)::int orders
    FROM generate_series((${start}::timestamptz AT TIME ZONE ${timezone})::date-6,(${end}::timestamptz AT TIME ZONE ${timezone})::date-1,'1 day') day
    LEFT JOIN "Order" o ON o."tenantId"=${tenantId}::uuid AND o."createdAt">=day AT TIME ZONE ${timezone} AND o."createdAt"<(day+interval '1 day') AT TIME ZONE ${timezone}
    GROUP BY day ORDER BY day`;
  const hourly = await prisma.$queryRaw<{ time: string; amount: number }[]>`
    SELECT to_char("createdAt" AT TIME ZONE ${timezone},'HH24:00') time,sum("deliveryFee")::float8 amount
    FROM "Order" WHERE "tenantId"=${tenantId}::uuid AND "createdAt">=${start} AND "createdAt"<${end} AND status<>'CANCELLED' GROUP BY 1 ORDER BY 1`;
  const leaderboard = await prisma.$queryRaw<
    {
      riderId: string;
      name: string;
      deliveries: number;
      avgMinutes: number | null;
    }[]
  >`
    SELECT r.id "riderId",u."firstName"||' '||u."lastName" name,count(*)::int deliveries,
    avg(extract(epoch FROM(o."deliveredAt"-o."pickedUpAt"))/60)::float8 "avgMinutes"
    FROM "Order" o JOIN "Rider" r ON r.id=o."riderId" JOIN "User" u ON u.id=r."userId"
    WHERE o."tenantId"=${tenantId}::uuid AND o.status='DELIVERED' AND o."createdAt">=${new Date(start.getTime() - 29 * 86400000)} AND o."createdAt"<${end}
    GROUP BY r.id,u."firstName",u."lastName" ORDER BY deliveries DESC,r.id LIMIT 10`;
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { currency: true },
  });
  return { ...rows[0], currency: tenant.currency, trend, hourly, leaderboard };
}
export async function qrList(tenantId: string): Promise<QrRecord[]> {
  return prisma.$queryRaw<
    QrRecord[]
  >`SELECT q.id,q.code,q.label,q.campaign,q.active,
    (SELECT count(*)::int FROM "QrScan" s WHERE s."qrCodeId"=q.id) scans,
    (SELECT count(*)::int FROM "Order" o WHERE o."qrCodeId"=q.id) orders,
    (SELECT coalesce(sum(o."deliveryFee") FILTER(WHERE o.status<>'CANCELLED'),0)::text FROM "Order" o WHERE o."qrCodeId"=q.id) fees,
    CASE WHEN (SELECT count(*) FROM "QrScan" s WHERE s."qrCodeId"=q.id)=0 THEN 0 ELSE
    100.0*(SELECT count(*) FROM "Order" o WHERE o."qrCodeId"=q.id)/(SELECT count(*) FROM "QrScan" s WHERE s."qrCodeId"=q.id) END::float8 conversion
    FROM "QrCode" q WHERE q."tenantId"=${tenantId}::uuid ORDER BY q.label,q.id`;
}
export async function writeQr(tenantId: string, raw: unknown, id?: string) {
  const data = QrWriteRequest.parse(raw);
  if (id) {
    const changed = await prisma.qrCode.updateMany({
      where: { id: Id.parse(id), tenantId },
      data,
    });
    if (!changed.count) throw notFound("QR code");
  } else await prisma.qrCode.create({ data: { tenantId, ...data } });
  publish(tenantId);
  return { message: "QR code saved" };
}
export async function qrImage(tenantId: string, id: string) {
  const qr = await prisma.qrCode.findFirst({
    where: { id: Id.parse(id), tenantId },
  });
  if (!qr) throw notFound("QR code");
  const url = new URL("/book", config.clientUrl);
  url.searchParams.set("qr", qr.code);
  const QRCode = (await import("qrcode")).default;
  return QRCode.toBuffer(url.toString(), {
    type: "png",
    width: 1024,
    margin: 4,
    errorCorrectionLevel: "M",
  });
}
