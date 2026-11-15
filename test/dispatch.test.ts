import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  mail: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: mocks.mail }) },
}));
vi.mock("../services/storage.js", () => ({
  uploadBlob: mocks.upload,
  deleteBlob: vi.fn(),
  getDownloadUrl: mocks.download,
}));
import { createApp } from "../app.js";
import { prisma } from "../startup/db.js";
import { signAccessToken, hashToken } from "../lib/tokens.js";
const app = createApp(),
  base = "/api/v1/dispatch";
async function fixture() {
  const tenant = await prisma.tenant.create({
    data: { name: "Synthetic Phase Two", subdomain: `test-${randomUUID()}` },
  });
  const staff = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `${randomUUID()}@example.test`,
      passwordHash: "unused",
      firstName: "Test",
      lastName: "Owner",
      role: "OWNER",
    },
  });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `${randomUUID()}@example.test`,
      passwordHash: "unused",
      firstName: "Test",
      lastName: "Rider",
      role: "RIDER",
    },
  });
  const rider = await prisma.rider.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      onboardingStatus: "APPROVED",
      available: true,
    },
  });
  const customer = await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      name: "Synthetic Customer",
      phone: "+2340000000000",
    },
  });
  const makeOrder = () =>
    prisma.order.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        pickupAddress: "Test pickup",
        deliveryAddress: "Test destination",
        recipientName: "Test Recipient",
        recipientPhone: "+2340000000001",
        deliveryFee: 2500,
        events: { create: { status: "PENDING" } },
      },
    });
  const token = (u: typeof staff) =>
    signAccessToken({ userId: u.id, tenantId: tenant.id, role: u.role });
  return {
    tenant,
    staff,
    user,
    rider,
    makeOrder,
    ownerToken: token(staff),
    riderToken: token(user),
  };
}
beforeEach(() => {
  mocks.mail.mockReset().mockResolvedValue({});
  mocks.upload.mockReset().mockImplementation(async (input) => ({
    key: `bike-dispatch/${input.tenantId}/${randomUUID()}`,
    filename: "test.png",
    contentType: "image/png",
    size: input.body.length,
  }));
  mocks.download.mockResolvedValue({
    url: "https://example.invalid/signed",
    expiresAt: new Date().toISOString(),
  });
  Object.assign(process.env, {
    SMTP_HOST: "smtp.example.test",
    SMTP_USER: "test",
    SMTP_PASSWORD: "test",
    SMTP_FROM: "test@example.test",
  });
});
afterAll(() => prisma.$disconnect());
describe("Phase 2 dispatch integration", () => {
  it("persists confirmed endpoints and exposes only real reported GPS with an ordered trail", async () => {
    const f = await fixture(),
      o = await f.makeOrder();
    const points = {
      pickupLocation: { latitude: 9.0765, longitude: 7.3986 },
      deliveryLocation: { latitude: 9.08, longitude: 7.42 },
    };
    const patch = () =>
      request(app)
        .patch(`${base}/orders/${o.id}/locations`)
        .auth(f.ownerToken, { type: "bearer" })
        .send(points);
    expect((await patch()).status).toBe(200);
    await prisma.trackingPoint.create({
      data: { orderId: o.id, latitude: 52.52, longitude: 13.405 },
    });
    const before = await request(app).get(
      `/api/v1/public/track/${o.trackingCode}`,
    );
    expect(before.body.data).toMatchObject({
      ...points,
      lastLocation: null,
      trail: [],
    });
    expect(
      (
        await request(app)
          .post(`${base}/rider/orders/${o.id}/claim`)
          .auth(f.riderToken, { type: "bearer" })
      ).status,
    ).toBe(200);
    // An active rider continues to report even after declining new-job availability.
    await prisma.rider.update({
      where: { id: f.rider.id },
      data: { available: false },
    });
    const report = (data: unknown) =>
      request(app)
        .post(`${base}/rider/location`)
        .auth(f.riderToken, { type: "bearer" })
        .send(data);
    const capturedAt = new Date(Date.now() - 1000).toISOString();
    expect(
      (
        await report({
          latitude: 9.077,
          longitude: 7.4,
          accuracy: 12,
          capturedAt,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await report({
          latitude: 9.079,
          longitude: 7.41,
          accuracy: 10,
          capturedAt: new Date().toISOString(),
        })
      ).status,
    ).toBe(200);
    // Out-of-order GPS must not move the rider backwards.
    expect(
      (await report({ latitude: 0, longitude: 0, accuracy: 10, capturedAt }))
        .status,
    ).toBe(200);
    expect(
      (
        await report({
          latitude: 9,
          longitude: 7,
          accuracy: 900,
          capturedAt: new Date().toISOString(),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await report({
          latitude: 9,
          longitude: 7,
          accuracy: 10,
          capturedAt: new Date(Date.now() - 120000).toISOString(),
        })
      ).status,
    ).toBe(400);
    const tracked = await request(app).get(
      `/api/v1/public/track/${o.trackingCode}`,
    );
    expect(tracked.body.data.lastLocation).toMatchObject({
      latitude: 9.079,
      longitude: 7.41,
    });
    expect(tracked.body.data.trail).toHaveLength(2);
    expect(tracked.body.data.trail[0]).toMatchObject({
      latitude: 9.077,
      longitude: 7.4,
    });
    expect(
      (
        await prisma.order.findUniqueOrThrow({ where: { id: o.id } })
      ).pickupLatitude?.toNumber(),
    ).toBe(points.pickupLocation.latitude);
    const other = await fixture();
    expect(
      (
        await request(app)
          .patch(`${base}/orders/${o.id}/locations`)
          .auth(other.ownerToken, { type: "bearer" })
          .send(points)
      ).status,
    ).toBe(404);
  });
  it("enforces one active order per rider even when bypassing the assignment service", async () => {
    const f = await fixture(),
      a = await f.makeOrder(),
      b = await f.makeOrder();
    await prisma.order.update({
      where: { id: a.id },
      data: { riderId: f.rider.id, status: "ASSIGNED" },
    });
    await expect(
      prisma.order.update({
        where: { id: b.id },
        data: { riderId: f.rider.id, status: "ASSIGNED" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
  it("allows one winner when two riders claim the same pending order", async () => {
    const f = await fixture(),
      order = await f.makeOrder();
    const u = await prisma.user.create({
      data: {
        tenantId: f.tenant.id,
        email: `${randomUUID()}@example.test`,
        passwordHash: "unused",
        firstName: "Other",
        lastName: "Rider",
        role: "RIDER",
      },
    });
    await prisma.rider.create({
      data: {
        tenantId: f.tenant.id,
        userId: u.id,
        onboardingStatus: "APPROVED",
        available: true,
      },
    });
    const token = signAccessToken({
      userId: u.id,
      tenantId: f.tenant.id,
      role: "RIDER",
    });
    const results = await Promise.all(
      [f.riderToken, token].map((t) =>
        request(app)
          .post(`${base}/rider/orders/${order.id}/claim`)
          .auth(t, { type: "bearer" }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.orderEvent.count({
        where: { orderId: order.id, status: "ASSIGNED" },
      }),
    ).toBe(1);
  });
  it("serializes competing assignments to the same rider and preserves one active job", async () => {
    const f = await fixture(),
      a = await f.makeOrder(),
      b = await f.makeOrder();
    const results = await Promise.all([
      request(app)
        .post(`${base}/orders/${a.id}/assign`)
        .auth(f.ownerToken, { type: "bearer" })
        .send({ riderId: f.rider.id }),
      request(app)
        .post(`${base}/rider/orders/${b.id}/claim`)
        .auth(f.riderToken, { type: "bearer" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.order.count({
        where: { riderId: f.rider.id, status: "ASSIGNED" },
      }),
    ).toBe(1);
  });
  it("supports decline, reassignment, ordered status flow, proof and timestamps", async () => {
    const f = await fixture(),
      o = await f.makeOrder();
    const post = (url: string, data: unknown = {}) =>
      request(app)
        .post(base + url)
        .auth(f.riderToken, { type: "bearer" })
        .send(data);
    expect((await post(`/rider/orders/${o.id}/claim`)).status).toBe(200);
    expect(
      (await post(`/rider/orders/${o.id}/status`, { status: "PENDING" }))
        .status,
    ).toBe(200);
    expect((await post(`/rider/orders/${o.id}/claim`)).status).toBe(200);
    expect(
      (await post(`/rider/orders/${o.id}/status`, { status: "DELIVERED" }))
        .status,
    ).toBe(409);
    expect(
      (
        await post("/rider/location", {
          latitude: 6.5,
          longitude: 3.4,
          accuracy: 10,
          capturedAt: new Date().toISOString(),
        })
      ).status,
    ).toBe(200);
    expect(await prisma.trackingPoint.count({ where: { orderId: o.id } })).toBe(
      1,
    );
    expect(
      (await post(`/rider/orders/${o.id}/status`, { status: "PICKED_UP" }))
        .status,
    ).toBe(200);
    expect(
      (await post(`/rider/orders/${o.id}/status`, { status: "IN_TRANSIT" }))
        .status,
    ).toBe(200);
    expect(
      (await post(`/rider/orders/${o.id}/status`, { status: "DELIVERED" }))
        .status,
    ).toBe(400);
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const upload = await request(app)
      .post(`${base}/rider/files`)
      .auth(f.riderToken, { type: "bearer" })
      .field("purpose", "PROOF")
      .attach("file", png, "proof.png");
    expect(upload.status).toBe(201);
    expect(
      (
        await post(`/rider/orders/${o.id}/status`, {
          status: "DELIVERED",
          proofFileId: upload.body.data.id,
          recipientName: "Test Recipient",
        })
      ).status,
    ).toBe(200);
    const final = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(final.pickedUpAt).not.toBeNull();
    expect(final.deliveredAt).not.toBeNull();
    expect(final.proofRecipient).toBe("Test Recipient");
    expect(
      (
        await post(`/rider/orders/${o.id}/status`, {
          status: "DELIVERED",
          proofFileId: upload.body.data.id,
          recipientName: "Test Recipient",
        })
      ).status,
    ).toBe(409);
  });
  it("issues hashed single-use invitations, accepts password and requires both document types for approval", async () => {
    const f = await fixture();
    const email = `${randomUUID()}@example.test`;
    const invite = await request(app)
      .post(`${base}/riders/invite`)
      .auth(f.ownerToken, { type: "bearer" })
      .send({
        email,
        firstName: "New",
        lastName: "Rider",
        phone: "+2348012345678",
      });
    expect(invite.status).toBe(201);
    expect(JSON.stringify(invite.body)).not.toContain("token");
    const token = (mocks.mail.mock.calls[0][0].text as string).match(
      /rider-invitation#([\w-]+)/,
    )![1];
    const rider = await prisma.rider.findUniqueOrThrow({
      where: { userId: invite.body.data.id },
    });
    expect(rider.invitationHash).toBe(hashToken(token));
    const accept = () =>
      request(app)
        .post("/api/v1/invitations/accept")
        .send({ token, password: "secure-password-123" });
    expect((await accept()).status).toBe(200);
    expect([400, 409]).toContain((await accept()).status);
    const newToken = signAccessToken({
      userId: rider.userId,
      tenantId: f.tenant.id,
      role: "RIDER",
    });
    expect(
      (
        await request(app)
          .patch(`${base}/rider/availability`)
          .auth(newToken, { type: "bearer" })
          .send({ available: true })
      ).status,
    ).toBe(403);
    const approve = () =>
      request(app)
        .post(`${base}/riders/${rider.id}/approval`)
        .auth(f.ownerToken, { type: "bearer" })
        .send({ status: "APPROVED" });
    expect((await approve()).status).toBe(400);
    for (const purpose of ["LICENSE", "INSURANCE"])
      expect(
        (
          await request(app)
            .post(`${base}/rider/files`)
            .auth(newToken, { type: "bearer" })
            .field("purpose", purpose)
            .attach("file", Buffer.from("%PDF-synthetic"), "document.pdf")
        ).status,
      ).toBe(201);
    expect((await approve()).status).toBe(200);
    expect(
      (
        await request(app)
          .patch(`${base}/rider/availability`)
          .auth(newToken, { type: "bearer" })
          .send({ available: true })
      ).status,
    ).toBe(200);
  });
  it("rejects expired invitations without setting the account password", async () => {
    const f = await fixture();
    const token = randomUUID() + randomUUID();
    await prisma.rider.update({
      where: { id: f.rider.id },
      data: {
        onboardingStatus: "INVITED",
        invitationHash: hashToken(token),
        invitationExpiresAt: new Date(0),
      },
    });
    expect(
      (
        await request(app)
          .post("/api/v1/invitations/accept")
          .send({ token, password: "secure-password-123" })
      ).status,
    ).toBe(409);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } }))
        .passwordHash,
    ).toBe("unused");
  });
  it("isolates tenants, restricts staff APIs and validates upload bytes", async () => {
    const a = await fixture(),
      b = await fixture(),
      order = await a.makeOrder();
    expect(
      (
        await request(app)
          .post(`${base}/rider/orders/${order.id}/claim`)
          .auth(b.riderToken, { type: "bearer" })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .get(`${base}/riders`)
          .auth(a.riderToken, { type: "bearer" })
      ).status,
    ).toBe(403);
    expect((await request(app).get(`${base}/riders`)).status).toBe(401);
    const file = await prisma.storedFile.create({
      data: {
        tenantId: a.tenant.id,
        userId: a.user.id,
        key: randomUUID(),
        filename: "x",
        contentType: "image/png",
        size: 1,
        purpose: "PROOF",
      },
    });
    expect(
      (
        await request(app)
          .get(`${base}/files/${file.id}/download`)
          .auth(b.ownerToken, { type: "bearer" })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`${base}/rider/files`)
          .auth(a.riderToken, { type: "bearer" })
          .field("purpose", "PROOF")
          .attach("file", Buffer.from("executable"), "fake.png")
      ).status,
    ).toBe(400);
  });
  it("returns uncapped totals, real QR counts, images and disabled-booking protection", async () => {
    const f = await fixture();
    const qr = await prisma.qrCode.create({
      data: { tenantId: f.tenant.id, label: "Test QR" },
    });
    const customer = await prisma.customer.create({
      data: {
        tenantId: f.tenant.id,
        name: "Bulk synthetic",
        phone: "+2340000000002",
      },
    });
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    await prisma.order.createMany({
      data: Array.from({ length: 105 }, () => ({
        id: randomUUID(),
        tenantId: f.tenant.id,
        customerId: customer.id,
        trackingCode: randomUUID(),
        pickupAddress: "Synthetic pickup",
        deliveryAddress: "Synthetic destination",
        recipientName: "Synthetic",
        recipientPhone: "+2340000000003",
        deliveryFee: 100,
        qrCodeId: qr.id,
      })),
    });
    const res = await request(app)
      .get(`${base}/analytics`)
      .auth(f.ownerToken, { type: "bearer" })
      .query({
        from: now.toISOString(),
        to: tomorrow.toISOString(),
        timezone: "Africa/Lagos",
      });
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(105);
    expect(Number(res.body.data.fees)).toBe(10500);
    const list = await request(app)
      .get(`${base}/qr-codes`)
      .auth(f.ownerToken, { type: "bearer" });
    expect(list.body.data[0].orders).toBe(105);
    expect(
      (
        await request(app)
          .get(`${base}/qr-codes/${qr.id}/image`)
          .auth(f.ownerToken, { type: "bearer" })
      ).headers["content-type"],
    ).toContain("image/png");
    expect(
      (
        await request(app)
          .patch(`${base}/qr-codes/${qr.id}`)
          .auth(f.ownerToken, { type: "bearer" })
          .send({ label: "Updated", active: false })
      ).status,
    ).toBe(200);
    expect(
      (await request(app).get(`/api/v1/public/qr/${qr.code}`)).status,
    ).toBe(404);
  });
});
