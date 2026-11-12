import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { hashPassword } from "../lib/password.js";
import { prisma } from "../startup/db.js";

const app = createApp();
const API = "/api/v1";
let seq = 0;
const unique = (label: string) => `${label}-${Date.now().toString(36)}-${++seq}`;

type Session = { token: string; tenantId: string; slug: string; cookie: string };

function refreshCookie(res: request.Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith("bd_refresh="));
  if (!cookie) throw new Error("no refresh cookie");
  return cookie.split(";")[0];
}

async function signup(orgName = unique("Org"), email = `${unique("owner")}@example.test`, password = "correct-horse-1") {
  const res = await request(app).post(`${API}/auth/signup`).send({ fullName: "Ada Owner", orgName, email, password });
  expect(res.status).toBe(201);
  return {
    token: res.body.data.accessToken as string,
    tenantId: res.body.data.tenant.id as string,
    slug: res.body.data.tenant.slug as string,
    cookie: refreshCookie(res),
  } satisfies Session;
}

async function addUser(tenantId: string, role: "DISPATCHER" | "RIDER", password = "rider-pass-123") {
  const email = `${unique(role.toLowerCase())}@example.test`;
  const user = await prisma.user.create({
    data: { tenantId, email, passwordHash: await hashPassword(password), firstName: "Test", lastName: role, role },
  });
  if (role === "RIDER") await prisma.rider.create({ data: { tenantId, userId: user.id } });
  const res = await request(app).post(`${API}/auth/login`).send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

const newOrder = (overrides: Record<string, unknown> = {}) => ({
  customer: { name: "Chidi Customer", phone: "+234 801 234 5678" },
  pickupAddress: "12 Admiralty Way, Lekki",
  deliveryAddress: "4 Allen Avenue, Ikeja",
  recipientName: "Bola Recipient",
  recipientPhone: "+2348099990000",
  packageSize: "SMALL",
  ...overrides,
});

const createOrder = async (token: string, overrides?: Record<string, unknown>) => {
  const res = await request(app).post(`${API}/orders`).set("Authorization", `Bearer ${token}`).send(newOrder(overrides));
  expect(res.status).toBe(201);
  return res.body.data as { id: string; trackingCode: string; status: string; deliveryFee: string; currency: string };
};

afterAll(async () => {
  await prisma.$disconnect();
});

describe("auth", () => {
  it("signup creates an organisation and an OWNER, sets an httpOnly refresh cookie, and /me returns both", async () => {
    const res = await request(app)
      .post(`${API}/auth/signup`)
      .send({ fullName: "Ngozi Okafor", orgName: "Lagos Riders Ltd.", email: `  ${unique("NGOZI")}@Example.TEST `, password: "long-enough-1" });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({ firstName: "Ngozi", lastName: "Okafor", role: "OWNER" });
    expect(res.body.data.user.email).toBe(res.body.data.user.email.toLowerCase());
    expect(res.body.data.tenant.slug).toMatch(/^lagos-riders-ltd(-\d+)?$/);
    expect(res.body.data.tenant.currency).toBe("NGN");
    const cookie = (res.headers["set-cookie"] as unknown as string[]).join(";");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");

    const me = await request(app).get(`${API}/auth/me`).set("Authorization", `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.tenant.id).toBe(res.body.data.tenant.id);
  });

  it("rejects a bad password and an unknown email with the same 401", async () => {
    const email = `${unique("owner")}@example.test`;
    await signup(undefined, email);
    const wrong = await request(app).post(`${API}/auth/login`).send({ email, password: "nope-nope-nope" });
    const unknown = await request(app).post(`${API}/auth/login`).send({ email: `x${email}`, password: "nope-nope-nope" });
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ success: false, code: "INVALID_CREDENTIALS" });
    }
  });

  it("asks which organisation when the same email belongs to two tenants", async () => {
    const email = `${unique("shared")}@example.test`;
    const a = await signup(unique("Alpha"), email);
    await signup(unique("Beta"), email);
    const res = await request(app).post(`${API}/auth/login`).send({ email, password: "correct-horse-1" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TENANT_REQUIRED");
    expect(res.body.details.tenants).toHaveLength(2);

    const picked = await request(app).post(`${API}/auth/login`).send({ email, password: "correct-horse-1", tenantSlug: a.slug });
    expect(picked.status).toBe(200);
    expect(picked.body.data.tenant.id).toBe(a.tenantId);
  });

  it("rotates refresh tokens, detects reuse of an old one, and logout ends the session", async () => {
    const s = await signup();
    const first = await request(app).post(`${API}/auth/refresh`).set("Cookie", s.cookie);
    expect(first.status).toBe(200);
    expect(first.body.data.accessToken).toEqual(expect.any(String));
    const rotated = refreshCookie(first);
    expect(rotated).not.toBe(s.cookie);

    // Presenting the already-rotated token again looks like theft: the whole family is revoked.
    const reuse = await request(app).post(`${API}/auth/refresh`).set("Cookie", s.cookie);
    expect(reuse.status).toBe(401);
    const afterTheft = await request(app).post(`${API}/auth/refresh`).set("Cookie", rotated);
    expect(afterTheft.status).toBe(401);

    const s2 = await signup();
    expect((await request(app).post(`${API}/auth/logout`).set("Cookie", s2.cookie)).status).toBe(200);
    expect((await request(app).post(`${API}/auth/refresh`).set("Cookie", s2.cookie)).status).toBe(401);
  });

  it("rejects missing and tampered access tokens", async () => {
    const s = await signup();
    expect((await request(app).get(`${API}/orders`)).body.code).toBe("UNAUTHENTICATED");
    const tampered = `${s.token.slice(0, -2)}xx`;
    expect((await request(app).get(`${API}/orders`).set("Authorization", `Bearer ${tampered}`)).status).toBe(401);
  });
});

describe("tenant", () => {
  it("lets the OWNER update branding and forbids a DISPATCHER", async () => {
    const s = await signup();
    const res = await request(app)
      .patch(`${API}/tenant`)
      .set("Authorization", `Bearer ${s.token}`)
      .send({ brandColor: "#10B981", tagline: "Fast green deliveries", currency: "ngn" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ brandColor: "#10b981", tagline: "Fast green deliveries", currency: "NGN" });

    const dispatcher = await addUser(s.tenantId, "DISPATCHER");
    const denied = await request(app).patch(`${API}/tenant`).set("Authorization", `Bearer ${dispatcher}`).send({ name: "Hijack" });
    expect(denied.status).toBe(403);
    expect((await request(app).get(`${API}/tenant`).set("Authorization", `Bearer ${dispatcher}`)).status).toBe(200);
  });
});

describe("orders", () => {
  it("creates an order with a server-side fee and records the PENDING event", async () => {
    const s = await signup();
    const order = await createOrder(s.token, { packageSize: "LARGE" });
    expect(order).toMatchObject({ status: "PENDING", deliveryFee: "4000.00", currency: "NGN" });
    const detail = await request(app).get(`${API}/orders/${order.id}`).set("Authorization", `Bearer ${s.token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.customer.phone).toBe("+2348012345678");
    expect(detail.body.data.events.map((e: { status: string }) => e.status)).toEqual(["PENDING"]);
  });

  it("isolates tenants: another tenant's order is 404 and never listed", async () => {
    const a = await signup();
    const b = await signup();
    const order = await createOrder(a.token);
    const auth = { Authorization: `Bearer ${b.token}` };
    expect((await request(app).get(`${API}/orders/${order.id}`).set(auth)).status).toBe(404);
    expect((await request(app).post(`${API}/orders/${order.id}/cancel`).set(auth).send({})).status).toBe(404);
    const list = await request(app).get(`${API}/orders`).set(auth);
    expect(list.body.data.items.map((o: { id: string }) => o.id)).not.toContain(order.id);
  });

  it("blocks riders from the dispatch API", async () => {
    const s = await signup();
    const rider = await addUser(s.tenantId, "RIDER");
    const res = await request(app).get(`${API}/orders`).set("Authorization", `Bearer ${rider}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("cancels once, then refuses an invalid transition", async () => {
    const s = await signup();
    const order = await createOrder(s.token);
    const auth = { Authorization: `Bearer ${s.token}` };
    const cancelled = await request(app).post(`${API}/orders/${order.id}/cancel`).set(auth).send({ reason: "Customer changed plans" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe("CANCELLED");
    expect(cancelled.body.data.events.at(-1)).toMatchObject({ status: "CANCELLED", note: "Customer changed plans" });
    const again = await request(app).post(`${API}/orders/${order.id}/cancel`).set(auth).send({});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("INVALID_TRANSITION");
  });

  it("paginates newest first with a cursor and filters by phone and status", async () => {
    const s = await signup();
    const auth = { Authorization: `Bearer ${s.token}` };
    const o1 = await createOrder(s.token, { recipientPhone: "+2348011111111" });
    const o2 = await createOrder(s.token);
    const o3 = await createOrder(s.token);
    const page1 = await request(app).get(`${API}/orders?limit=2`).set(auth);
    expect(page1.body.data.items.map((o: { id: string }) => o.id)).toEqual([o3.id, o2.id]);
    const page2 = await request(app).get(`${API}/orders`).query({ limit: 2, cursor: page1.body.data.nextCursor }).set(auth);
    expect(page2.body.data.items.map((o: { id: string }) => o.id)).toEqual([o1.id]);
    expect(page2.body.data.nextCursor).toBeNull();

    const byPhone = await request(app).get(`${API}/orders`).query({ q: "+234 801 111 1111" }).set(auth);
    expect(byPhone.body.data.items.map((o: { id: string }) => o.id)).toEqual([o1.id]);
    const byCode = await request(app).get(`${API}/orders`).query({ q: o2.trackingCode.slice(0, 8) }).set(auth);
    expect(byCode.body.data.items.map((o: { id: string }) => o.id)).toContain(o2.id);
    const delivered = await request(app).get(`${API}/orders`).query({ status: "DELIVERED" }).set(auth);
    expect(delivered.body.data.items).toEqual([]);
  });

  it("returns field-level validation errors in the shared envelope", async () => {
    const s = await signup();
    const res = await request(app)
      .post(`${API}/orders`)
      .set("Authorization", `Bearer ${s.token}`)
      .send(newOrder({ packageSize: "HUGE", recipientPhone: "call me" }));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: "VALIDATION_FAILED" });
    const paths = res.body.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["packageSize", "recipientPhone"]));
  });
});

describe("public booking and tracking", () => {
  let owner: Session;
  let qrCode: string;

  beforeAll(async () => {
    owner = await signup(unique("Public"));
    await request(app).patch(`${API}/tenant`).set("Authorization", `Bearer ${owner.token}`).send({ brandColor: "#123abc" });
    const qr = await prisma.qrCode.create({ data: { tenantId: owner.tenantId, label: "Lekki shop window" } });
    qrCode = qr.code;
  });

  it("serves the QR landing page and records a scan", async () => {
    const res = await request(app).get(`${API}/public/qr/${qrCode}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ tenant: { brandColor: "#123abc" }, currency: "NGN", prices: { SMALL: "1500.00" } });
    expect(await prisma.qrScan.count({ where: { qrCode: { code: qrCode } } })).toBeGreaterThan(0);
  });

  it("books through the QR code into the right tenant and tracks without exposing phone numbers", async () => {
    const booking = await request(app).post(`${API}/public/qr/${qrCode}/orders`).send({
      customerName: "Walk-in Customer",
      customerPhone: "+2348055550000",
      pickupAddress: "Shop 3, Admiralty Way",
      deliveryAddress: "9 Bode Thomas, Surulere",
      recipientName: "Grandma",
      recipientPhone: "+2348066660000",
      packageSize: "MEDIUM",
      tenantId: "00000000-0000-0000-0000-000000000000", // ignored: the tenant comes from the QR code
    });
    expect(booking.status).toBe(201);
    const { trackingCode } = booking.body.data;

    const stored = await prisma.order.findUniqueOrThrow({ where: { trackingCode } });
    expect(stored.tenantId).toBe(owner.tenantId);
    expect(stored.qrCodeId).not.toBeNull();

    const track = await request(app).get(`${API}/public/track/${trackingCode}`);
    expect(track.status).toBe(200);
    expect(track.headers["cache-control"]).toBe("no-store");
    expect(track.body.data).toMatchObject({ status: "PENDING", tenant: { brandColor: "#123abc" }, rider: null, lastLocation: null });
    const body = JSON.stringify(track.body);
    expect(body).not.toContain("2348055550000");
    expect(body).not.toContain("2348066660000");

    // The dispatcher sees the booking in their own list.
    const list = await request(app).get(`${API}/orders`).set("Authorization", `Bearer ${owner.token}`);
    expect(list.body.data.items.map((o: { trackingCode: string }) => o.trackingCode)).toContain(trackingCode);
  });

  it("returns 404 for inactive QR codes and unknown tracking codes", async () => {
    const inactive = await prisma.qrCode.create({ data: { tenantId: owner.tenantId, label: "Old flyer", active: false } });
    expect((await request(app).get(`${API}/public/qr/${inactive.code}`)).status).toBe(404);
    expect((await request(app).get(`${API}/public/track/does-not-exist`)).status).toBe(404);
  });
});
