import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { afterAll, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { createApp } from "../app.js";
import { attachRealtime, publish } from "../startup/realtime.js";
import { prisma } from "../startup/db.js";
import { signAccessToken } from "../lib/tokens.js";

afterAll(() => prisma.$disconnect());
it("authenticates sockets, isolates tenant rooms and restricts public tracking to its order", async () => {
  const server = createServer(createApp());
  const realtime = attachRealtime(server);
  const sockets: Socket[] = [];
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing server address");
  const url = `http://127.0.0.1:${address.port}`;
  async function tenant() {
    const t = await prisma.tenant.create({
      data: { name: "Socket synthetic", subdomain: `socket-${randomUUID()}` },
    });
    const u = await prisma.user.create({
      data: {
        tenantId: t.id,
        email: `${randomUUID()}@example.test`,
        firstName: "Socket",
        lastName: "Owner",
        passwordHash: "unused",
        role: "OWNER",
      },
    });
    return {
      id: t.id,
      token: signAccessToken({ userId: u.id, tenantId: t.id, role: "OWNER" }),
    };
  }
  function socket(auth: Record<string, string>) {
    const s = connect(url, {
      auth,
      reconnection: false,
      transports: ["websocket"],
    });
    sockets.push(s);
    return s;
  }
  const ready = (s: Socket) =>
    new Promise<void>((resolve, reject) => {
      s.once("connect", () => resolve());
      s.once("connect_error", reject);
    });
  try {
    const a = await tenant(),
      b = await tenant();
    const c = await prisma.customer.create({
      data: { tenantId: a.id, name: "Synthetic", phone: "+2340000000000" },
    });
    const order = await prisma.order.create({
      data: {
        tenantId: a.id,
        customerId: c.id,
        pickupAddress: "Synthetic pickup",
        deliveryAddress: "Synthetic destination",
        recipientName: "Synthetic",
        recipientPhone: "+2340000000001",
        deliveryFee: 100,
      },
    });
    const sa = socket({ token: a.token }),
      sb = socket({ token: b.token }),
      publicSocket = socket({ trackingCode: order.trackingCode });
    await Promise.all([ready(sa), ready(sb), ready(publicSocket)]);
    let foreignEvents = 0;
    sb.on("dispatch:changed", () => foreignEvents++);
    const own = new Promise<void>((resolve) =>
      sa.once("dispatch:changed", () => resolve()),
    );
    const tracked = new Promise<void>((resolve) =>
      publicSocket.once("tracking:changed", () => resolve()),
    );
    publish(a.id, order.trackingCode);
    await Promise.all([own, tracked]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(foreignEvents).toBe(0);
    const invalid = socket({ token: "invalid" });
    await expect(ready(invalid)).rejects.toThrow("Unauthorized");
    const unknown = socket({ trackingCode: randomUUID() });
    await expect(ready(unknown)).rejects.toThrow("Unauthorized");
  } finally {
    sockets.forEach((s) => s.disconnect());
    await new Promise<void>((resolve) => realtime.close(() => resolve()));
  }
});
