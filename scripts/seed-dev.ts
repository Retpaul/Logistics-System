// Demo data for local development: one organisation with staff, a rider, QR codes and orders.
// Usage: npm run db:seed:dev [-- --reset]
// Only ever touches the "demo-couriers" tenant. Never run against production.
import type { OrderStatus, PackageSize } from "@prisma/client";
import { hashPassword } from "../lib/password.js";
import { feeFor } from "../services/pricing.js";
import { prisma } from "../startup/db.js";

const SLUG = "demo-couriers";
const PASSWORD = "Demo1234!";
const reset = process.argv.includes("--reset");

async function removeDemoTenant(tenantId: string) {
  const orders = { order: { tenantId } };
  await prisma.$transaction([
    prisma.orderEvent.deleteMany({ where: orders }),
    prisma.trackingPoint.deleteMany({ where: orders }),
    prisma.payment.deleteMany({ where: orders }),
    prisma.order.deleteMany({ where: { tenantId } }),
    prisma.qrScan.deleteMany({ where: { qrCode: { tenantId } } }),
    prisma.qrCode.deleteMany({ where: { tenantId } }),
    prisma.customer.deleteMany({ where: { tenantId } }),
    prisma.bike.deleteMany({ where: { tenantId } }),
    prisma.rider.deleteMany({ where: { tenantId } }),
    prisma.refreshToken.deleteMany({ where: { tenantId } }),
    prisma.user.deleteMany({ where: { tenantId } }),
    prisma.tenant.delete({ where: { id: tenantId } }),
  ]);
}

async function main() {
  const existing = await prisma.tenant.findUnique({ where: { subdomain: SLUG } });
  if (existing && !reset) {
    console.log(`"${SLUG}" already exists. Re-run with -- --reset to recreate it.`);
    return;
  }
  if (existing) await removeDemoTenant(existing.id);

  const passwordHash = await hashPassword(PASSWORD);
  const tenant = await prisma.tenant.create({
    data: { name: "Demo Couriers", subdomain: SLUG, tagline: "Green deliveries across Lagos", brandColor: "#10b981", secondaryColor: "#0f172a" },
  });
  const staff = (email: string, firstName: string, lastName: string, role: "OWNER" | "DISPATCHER" | "RIDER") =>
    prisma.user.create({ data: { tenantId: tenant.id, email, passwordHash, firstName, lastName, role } });

  await staff("owner@demo.test", "Ada", "Owner", "OWNER");
  await staff("dispatcher@demo.test", "Dayo", "Dispatcher", "DISPATCHER");
  const riderUser = await staff("rider@demo.test", "Marco", "Rider", "RIDER");
  const rider = await prisma.rider.create({ data: { tenantId: tenant.id, userId: riderUser.id, available: true } });
  const bike = await prisma.bike.create({ data: { tenantId: tenant.id, serialNumber: "EB-0001", batteryPercent: 86 } });
  await prisma.bike.create({ data: { tenantId: tenant.id, serialNumber: "EB-0002", batteryPercent: 41 } });

  const qrLekki = await prisma.qrCode.create({ data: { tenantId: tenant.id, code: "demo-lekki", label: "Lekki shop window", campaign: "Launch" } });
  await prisma.qrCode.create({ data: { tenantId: tenant.id, code: "demo-ikeja", label: "Ikeja market stall" } });

  const customers = await Promise.all(
    ["Chidi Okeke", "Funke Adeyemi", "Musa Bello", "Ngozi Eze", "Tunde Bakare"].map((name, i) =>
      prisma.customer.create({ data: { tenantId: tenant.id, name, phone: `+23480100000${i + 10}` } }),
    ),
  );

  const areas = ["Admiralty Way, Lekki", "Allen Avenue, Ikeja", "Bode Thomas, Surulere", "Awolowo Road, Ikoyi", "Herbert Macaulay Way, Yaba"];
  const sizes: PackageSize[] = ["SMALL", "MEDIUM", "LARGE"];
  const flow: OrderStatus[] = ["PENDING", "ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"];
  const now = Date.now();

  for (let i = 0; i < 30; i++) {
    // Older orders are finished; the newest few are still in progress.
    const status: OrderStatus = i < 4 ? flow[i % 4] : i % 9 === 0 ? "CANCELLED" : "DELIVERED";
    const createdAt = new Date(now - (i < 4 ? i * 20 : i * 300) * 60_000);
    const steps = status === "CANCELLED" ? ["PENDING", "CANCELLED"] : flow.slice(0, flow.indexOf(status) + 1);
    const assigned = steps.includes("ASSIGNED");
    const size = sizes[i % 3];
    await prisma.order.create({
      data: {
        tenantId: tenant.id,
        customerId: customers[i % customers.length].id,
        riderId: assigned ? rider.id : null,
        bikeId: assigned ? bike.id : null,
        qrCodeId: i % 2 === 0 ? qrLekki.id : null,
        pickupAddress: `${10 + i} ${areas[i % areas.length]}`,
        deliveryAddress: `${30 + i} ${areas[(i + 2) % areas.length]}`,
        recipientName: `Recipient ${i + 1}`,
        recipientPhone: `+23481200000${String(i).padStart(2, "0")}`,
        packageSize: size,
        status,
        deliveryFee: feeFor(size),
        currency: tenant.currency,
        createdAt,
        events: {
          create: steps.map((s, step) => ({ status: s as OrderStatus, createdAt: new Date(createdAt.getTime() + step * 6 * 60_000) })),
        },
        locations:
          status === "IN_TRANSIT"
            ? { create: [{ latitude: 6.4474, longitude: 3.4721, recordedAt: new Date(now - 30_000) }] }
            : undefined,
      },
    });
  }

  console.log(`Seeded "${tenant.name}" (${SLUG}) with 30 orders.`);
  console.log(`Logins (password ${PASSWORD}): owner@demo.test, dispatcher@demo.test, rider@demo.test`);
  console.log("QR booking links: /book?qr=demo-lekki and /book?qr=demo-ikeja");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
