import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { AssignOrderRequest, Id } from "../contracts/index.js";

import { updateOrderLocations } from "../services/orders.js";
import { requireAuth, requireRole, authOf } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { ok } from "../lib/respond.js";
import { AppError } from "../lib/errors.js";
import * as dispatch from "../services/dispatch.js";
import { analytics, qrList, writeQr, qrImage } from "../services/analytics.js";
import { fileDownload, saveRiderFile } from "../services/files.js";

const staff = requireRole("OWNER", "DISPATCHER");
export const dispatchRouter = Router().use(requireAuth);
dispatchRouter.patch("/orders/:id/locations", staff, async (req, res) =>
  ok(
    res,
    await updateOrderLocations(
      authOf(req).tenantId,
      Id.parse(req.params.id),
      req.body,
    ),
  ),
);
dispatchRouter.get("/riders", staff, async (req, res) =>
  ok(res, await dispatch.listRiders(authOf(req).tenantId)),
);
dispatchRouter.post("/riders/invite", staff, authLimiter, async (req, res) =>
  ok(res, await dispatch.inviteRider(authOf(req), req.body), 201),
);
dispatchRouter.post(
  "/riders/:id/resend",
  staff,
  authLimiter,
  async (req, res) =>
    ok(
      res,
      await dispatch.resendInvitation(authOf(req), Id.parse(req.params.id)),
    ),
);
dispatchRouter.post("/riders/:id/approval", staff, async (req, res) =>
  ok(
    res,
    await dispatch.approveRider(authOf(req), Id.parse(req.params.id), req.body),
  ),
);
dispatchRouter.get("/rider/workspace", requireRole("RIDER"), async (req, res) =>
  ok(res, await dispatch.workspace(authOf(req))),
);
dispatchRouter.patch(
  "/rider/availability",
  requireRole("RIDER"),
  async (req, res) =>
    ok(res, await dispatch.availability(authOf(req), req.body)),
);
dispatchRouter.post("/orders/:id/assign", staff, async (req, res) =>
  ok(
    res,
    await dispatch.assign(
      authOf(req),
      Id.parse(req.params.id),
      AssignOrderRequest.parse(req.body).riderId,
    ),
  ),
);
dispatchRouter.post(
  "/rider/orders/:id/claim",
  requireRole("RIDER"),
  async (req, res) =>
    ok(res, await dispatch.assign(authOf(req), Id.parse(req.params.id))),
);
dispatchRouter.post(
  "/rider/orders/:id/status",
  requireRole("RIDER"),
  async (req, res) =>
    ok(
      res,
      await dispatch.riderTransition(
        authOf(req),
        Id.parse(req.params.id),
        req.body,
      ),
    ),
);
const gpsLimiter = rateLimit({
  windowMs: 60000,
  limit: 12,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
dispatchRouter.post(
  "/rider/location",
  requireRole("RIDER"),
  gpsLimiter,
  async (req, res) =>
    ok(res, await dispatch.recordLocation(authOf(req), req.body)),
);
dispatchRouter.get("/analytics", staff, async (req, res) =>
  ok(res, await analytics(authOf(req).tenantId, req.query)),
);
dispatchRouter.get("/qr-codes", staff, async (req, res) =>
  ok(res, await qrList(authOf(req).tenantId)),
);
dispatchRouter.post("/qr-codes", staff, async (req, res) =>
  ok(res, await writeQr(authOf(req).tenantId, req.body), 201),
);
dispatchRouter.patch("/qr-codes/:id", staff, async (req, res) =>
  ok(
    res,
    await writeQr(authOf(req).tenantId, req.body, Id.parse(req.params.id)),
  ),
);
dispatchRouter.get("/qr-codes/:id/image", staff, async (req, res) => {
  res
    .type("png")
    .set("Content-Disposition", 'attachment; filename="booking-qr.png"')
    .send(await qrImage(authOf(req).tenantId, Id.parse(req.params.id)));
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1 },
}).single("file");
dispatchRouter.post(
  "/rider/files",
  requireRole("RIDER"),
  (req, res, next) =>
    upload(req, res, (error) =>
      next(
        error
          ? new AppError(
              400,
              "VALIDATION_FAILED",
              "Upload one file up to 10 MiB",
            )
          : undefined,
      ),
    ),
  async (req, res) =>
    ok(res, await saveRiderFile(authOf(req), req.file, req.body?.purpose), 201),
);
dispatchRouter.get("/files/:id/download", async (req, res) =>
  ok(res, await fileDownload(authOf(req), Id.parse(req.params.id))),
);
export const invitationRouter = Router().post(
  "/accept",
  authLimiter,
  async (req, res) => ok(res, await dispatch.acceptInvitation(req.body)),
);
