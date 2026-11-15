import { randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import type { Prisma } from "@prisma/client";
import {
  AcceptInvitationRequest,
  AvailabilityRequest,
  Id,
  InviteRiderRequest,
  LocationRequest,
  RiderApprovalRequest,
  RiderTransitionRequest,
  type RiderRecord,
  type RiderWorkspace,
} from "../contracts/index.js";
import { config } from "../config/index.js";
import { AppError, forbidden, notFound } from "../lib/errors.js";
import { hashPassword } from "../lib/password.js";
import { hashToken, type AuthContext } from "../lib/tokens.js";
import { prisma } from "../startup/db.js";
import { orderListSelect } from "../repositories/orders.js";
import { toOrderListItem } from "./mappers.js";
import { assertTransition } from "./orderStatus.js";
import { publish } from "../startup/realtime.js";

const active = ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"] as const;
const conflict = () =>
  new AppError(
    409,
    "CONFLICT",
    "This order or rider changed. Refresh and try again.",
  );
export async function riderFor(
  auth: AuthContext,
  tx: Prisma.TransactionClient = prisma,
) {
  const rider = await tx.rider.findFirst({
    where: { tenantId: auth.tenantId, userId: auth.userId },
  });
  if (!rider) throw notFound("Rider");
  return rider;
}
async function lockRider(
  tx: Prisma.TransactionClient,
  tenantId: string,
  id: string,
) {
  await tx.$queryRaw`SELECT id FROM "Rider" WHERE id=${id}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`;
}
export async function listRiders(tenantId: string): Promise<RiderRecord[]> {
  const [riders, files] = await Promise.all([
    prisma.rider.findMany({
      where: { tenantId },
      include: {
        user: true,
        orders: {
          where: { status: { in: [...active] } },
          select: orderListSelect,
        },
      },
      orderBy: { id: "asc" },
    }),
    prisma.storedFile.findMany({
      where: { tenantId, purpose: { in: ["LICENSE", "INSURANCE"] } },
      select: { id: true, userId: true, filename: true },
    }),
  ]);
  return riders.map((r) => ({
    id: r.id,
    userId: r.userId,
    name: `${r.user.firstName} ${r.user.lastName}`,
    email: r.user.email,
    phone: r.phone,
    bikeSerial: r.bikeSerial,
    onboardingStatus: r.onboardingStatus,
    available: r.available,
    latitude:
      r.locationSource === "GPS" && r.latitude !== null
        ? Number(r.latitude)
        : null,
    longitude:
      r.locationSource === "GPS" && r.longitude !== null
        ? Number(r.longitude)
        : null,
    locationAt:
      r.locationSource === "GPS" ? (r.locationAt?.toISOString() ?? null) : null,
    documents: files
      .filter((f) => f.userId === r.userId)
      .map((f) => ({ id: f.id, filename: f.filename })),
    activeOrder: r.orders[0] ? toOrderListItem(r.orders[0]) : null,
  }));
}
export async function inviteRider(auth: AuthContext, raw: unknown) {
  const input = InviteRiderRequest.parse(raw);
  const mail = config.mail();
  const token = randomBytes(32).toString("base64url");
  const passwordHash = await hashPassword(
    randomBytes(32).toString("base64url"),
  );
  const user = await prisma.$transaction(async (tx) => {
    if (
      await tx.user.findFirst({
        where: { tenantId: auth.tenantId, email: input.email },
      })
    )
      throw new AppError(
        409,
        "CONFLICT",
        "This email already belongs to this organisation",
      );
    const u = await tx.user.create({
      data: {
        tenantId: auth.tenantId,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        role: "RIDER",
        passwordHash,
      },
    });
    await tx.rider.create({
      data: {
        tenantId: auth.tenantId,
        userId: u.id,
        phone: input.phone,
        bikeSerial: input.bikeSerial,
        onboardingStatus: "INVITED",
        invitationHash: hashToken(token),
        invitationExpiresAt: new Date(Date.now() + 48 * 3600000),
      },
    });
    return u;
  });
  const url = new URL("/rider-invitation", config.clientUrl);
  url.hash = token;
  try {
    await nodemailer.createTransport(mail.transport).sendMail({
      from: mail.from,
      to: user.email,
      subject: "Your Bike Dispatch rider invitation",
      text: `You have been invited to join a dispatch team. Set your password using this link within 48 hours:\n${url.toString()}\nThen sign in and upload your licence and insurance for approval.`,
    });
  } catch {
    // Keep an auditable invitation, but do not expose a token or activate an account on email failure.
    throw new AppError(
      503,
      "INTERNAL",
      "Invitation created but email delivery failed. Use resend invitation after checking SMTP.",
    );
  }
  publish(auth.tenantId);
  return { id: user.id, message: "Invitation sent" };
}
export async function resendInvitation(auth: AuthContext, id: string) {
  const mail = config.mail();
  const r = await prisma.rider.findFirst({
    where: {
      id: Id.parse(id),
      tenantId: auth.tenantId,
      onboardingStatus: "INVITED",
    },
    include: { user: true },
  });
  if (!r) throw notFound("Invitation");
  const token = randomBytes(32).toString("base64url");
  await prisma.rider.update({
    where: { id: r.id },
    data: {
      invitationHash: hashToken(token),
      invitationExpiresAt: new Date(Date.now() + 48 * 3600000),
    },
  });
  const url = new URL("/rider-invitation", config.clientUrl);
  url.hash = token;
  try {
    await nodemailer.createTransport(mail.transport).sendMail({
      from: mail.from,
      to: r.user.email,
      subject: "Your new rider invitation",
      text: `Set your password within 48 hours: ${url.toString()}`,
    });
  } catch {
    throw new AppError(
      503,
      "INTERNAL",
      "Email delivery failed; check SMTP and resend",
    );
  }
  return { message: "Invitation sent" };
}
export async function acceptInvitation(raw: unknown) {
  const input = AcceptInvitationRequest.parse(raw);
  const passwordHash = await hashPassword(input.password);
  await prisma.$transaction(async (tx) => {
    const r = await tx.rider.findUnique({
      where: { invitationHash: hashToken(input.token) },
    });
    if (!r)
      throw new AppError(
        400,
        "VALIDATION_FAILED",
        "Invitation is invalid or expired",
      );
    const result = await tx.rider.updateMany({
      where: {
        id: r.id,
        onboardingStatus: "INVITED",
        invitationHash: hashToken(input.token),
        invitationExpiresAt: { gt: new Date() },
      },
      data: {
        onboardingStatus: "PENDING",
        invitationHash: null,
        invitationExpiresAt: null,
      },
    });
    if (!result.count)
      throw new AppError(
        409,
        "CONFLICT",
        "Invitation is expired or already used",
      );
    await tx.user.update({
      where: { id: r.userId },
      data: { passwordHash, emailVerifiedAt: new Date() },
    });
  });
  return { message: "Password set. Sign in to upload your documents." };
}
export async function approveRider(
  auth: AuthContext,
  id: string,
  raw: unknown,
) {
  const { status } = RiderApprovalRequest.parse(raw);
  await prisma.$transaction(async (tx) => {
    await lockRider(tx, auth.tenantId, Id.parse(id));
    const r = await tx.rider.findFirst({
      where: { id, tenantId: auth.tenantId },
    });
    if (!r || r.onboardingStatus === "INVITED")
      throw notFound("Submitted rider");
    if (status === "APPROVED") {
      const docs = await tx.storedFile.findMany({
        where: {
          tenantId: auth.tenantId,
          userId: r.userId,
          purpose: { in: ["LICENSE", "INSURANCE"] },
        },
        select: { purpose: true },
        distinct: ["purpose"],
      });
      if (docs.length < 2)
        throw new AppError(
          400,
          "VALIDATION_FAILED",
          "Licence and insurance uploads are required before approval",
        );
    }
    if (
      await tx.order.count({
        where: { riderId: id, status: { in: [...active] } },
      })
    )
      throw conflict();
    await tx.rider.update({
      where: { id },
      data: { onboardingStatus: status, available: false },
    });
  });
  publish(auth.tenantId);
  return { status };
}
export async function availability(auth: AuthContext, raw: unknown) {
  const { available } = AvailabilityRequest.parse(raw);
  await prisma.$transaction(async (tx) => {
    const r = await riderFor(auth, tx);
    await lockRider(tx, auth.tenantId, r.id);
    const fresh = await riderFor(auth, tx);
    if (fresh.onboardingStatus !== "APPROVED") throw forbidden();
    await tx.rider.update({ where: { id: r.id }, data: { available } });
  });
  publish(auth.tenantId);
  return { available };
}
export async function workspace(auth: AuthContext): Promise<RiderWorkspace> {
  const r = await riderFor(auth);
  const [all, jobs, pending] = await Promise.all([
    listRiders(auth.tenantId),
    prisma.order.findMany({
      where: { tenantId: auth.tenantId, riderId: r.id },
      select: orderListSelect,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    r.available && r.onboardingStatus === "APPROVED"
      ? prisma.order.findMany({
          where: { tenantId: auth.tenantId, status: "PENDING", riderId: null },
          select: {
            id: true,
            trackingCode: true,
            pickupAddress: true,
            deliveryAddress: true,
            packageSize: true,
            deliveryFee: true,
            currency: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
          take: 50,
        })
      : [],
  ]);
  const own = all.find((x) => x.id === r.id)!;
  const visible = jobs.map(toOrderListItem);
  if (own.activeOrder && !visible.some((o) => o.id === own.activeOrder!.id))
    visible.unshift(own.activeOrder);
  return {
    rider: own,
    jobs: visible,
    availableJobs: pending.map((o) => ({
      ...o,
      deliveryFee: o.deliveryFee.toFixed(2),
      createdAt: o.createdAt.toISOString(),
    })),
  };
}
export async function assign(
  auth: AuthContext,
  orderId: string,
  riderId?: string,
) {
  Id.parse(orderId);
  try {
    const changed = await prisma.$transaction(async (tx) => {
      const id =
        auth.role === "RIDER"
          ? (await riderFor(auth, tx)).id
          : Id.parse(riderId);
      await lockRider(tx, auth.tenantId, id);
      const r = await tx.rider.findFirst({
        where: {
          id,
          tenantId: auth.tenantId,
          available: true,
          onboardingStatus: "APPROVED",
        },
      });
      if (
        !r ||
        (await tx.order.count({
          where: { riderId: id, status: { in: [...active] } },
        }))
      )
        throw conflict();
      const update = await tx.order.updateMany({
        where: {
          id: orderId,
          tenantId: auth.tenantId,
          status: "PENDING",
          riderId: null,
        },
        data: { status: "ASSIGNED", riderId: id },
      });
      if (!update.count) throw conflict();
      await tx.orderEvent.create({
        data: {
          orderId,
          status: "ASSIGNED",
          note:
            auth.role === "RIDER"
              ? "Claimed by rider"
              : "Assigned by dispatcher",
        },
      });
      return tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { trackingCode: true },
      });
    });
    publish(auth.tenantId, changed.trackingCode);
    return { status: "ASSIGNED" };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw conflict();
    throw e;
  }
}
export async function riderTransition(
  auth: AuthContext,
  id: string,
  raw: unknown,
) {
  const input = RiderTransitionRequest.parse(raw);
  Id.parse(id);
  const tracking = await prisma.$transaction(async (tx) => {
    const r = await riderFor(auth, tx);
    await lockRider(tx, auth.tenantId, r.id);
    const o = await tx.order.findFirst({
      where: { id, tenantId: auth.tenantId, riderId: r.id },
    });
    if (!o) throw notFound("Order");
    assertTransition(o.status, input.status, "RIDER");
    if (input.status === "DELIVERED") {
      if (!input.proofFileId || !input.recipientName)
        throw new AppError(
          400,
          "VALIDATION_FAILED",
          "Photo and recipient name are required",
        );
      if (
        !(await tx.storedFile.findFirst({
          where: {
            id: input.proofFileId,
            tenantId: auth.tenantId,
            userId: auth.userId,
            purpose: "PROOF",
            createdAt: { gte: o.createdAt },
          },
        }))
      )
        throw forbidden();
      if (
        await tx.order.findFirst({ where: { proofFileId: input.proofFileId } })
      )
        throw conflict();
    }
    const now = new Date();
    const changed = await tx.order.updateMany({
      where: { id, tenantId: auth.tenantId, riderId: r.id, status: o.status },
      data: {
        status: input.status,
        ...(input.status === "PENDING" ? { riderId: null } : {}),
        ...(input.status === "PICKED_UP" ? { pickedUpAt: now } : {}),
        ...(input.status === "DELIVERED"
          ? {
              deliveredAt: now,
              proofFileId: input.proofFileId,
              proofRecipient: input.recipientName,
            }
          : {}),
      },
    });
    if (!changed.count) throw conflict();
    await tx.orderEvent.create({
      data: {
        orderId: id,
        status: input.status,
        note: input.status === "PENDING" ? "Declined by rider" : null,
      },
    });
    return o.trackingCode;
  });
  publish(auth.tenantId, tracking);
  return { status: input.status };
}
export async function recordLocation(auth: AuthContext, raw: unknown) {
  const loc = LocationRequest.parse(raw);
  const tracking = await prisma.$transaction(async (tx) => {
    const r = await riderFor(auth, tx);
    await lockRider(tx, auth.tenantId, r.id);
    const fresh = await riderFor(auth, tx);
    const order = await tx.order.findFirst({
      where: {
        riderId: r.id,
        tenantId: auth.tenantId,
        status: { in: [...active] },
      },
      select: { id: true, trackingCode: true },
    });
    if (fresh.onboardingStatus !== "APPROVED" || (!fresh.available && !order))
      throw forbidden();
    const now = new Date(loc.capturedAt);
    if (fresh.locationAt && fresh.locationAt >= now) return order?.trackingCode;
    await tx.rider.update({
      where: { id: r.id },
      data: {
        latitude: loc.latitude,
        longitude: loc.longitude,
        locationAt: now,
        locationSource: "GPS",
      },
    });
    if (order)
      await tx.trackingPoint.create({
        data: {
          orderId: order.id,
          latitude: loc.latitude,
          longitude: loc.longitude,
          accuracy: loc.accuracy,
          source: "GPS",
          recordedAt: now,
        },
      });
    return order?.trackingCode;
  });
  publish(auth.tenantId, tracking);
  return { recordedAt: loc.capturedAt };
}
