import { Router } from "express";
import { authController } from "../controllers/auth.js";
import { ordersController } from "../controllers/orders.js";
import { publicController } from "../controllers/public.js";
import { tenantController } from "../controllers/tenant.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { authLimiter, publicReadLimiter, publicWriteLimiter } from "../middleware/rateLimit.js";

export const authRouter = Router()
  .post("/signup", authLimiter, authController.signup)
  .post("/login", authLimiter, authController.login)
  .post("/refresh", authLimiter, authController.refresh)
  .post("/logout", authController.logout)
  .get("/me", requireAuth, authController.me);

export const tenantRouter = Router()
  .use(requireAuth)
  .get("/", tenantController.get)
  .patch("/", requireRole("OWNER"), tenantController.update);

export const ordersRouter = Router()
  .use(requireAuth, requireRole("OWNER", "DISPATCHER"))
  .get("/", ordersController.list)
  .post("/", ordersController.create)
  .get("/:id", ordersController.get)
  .post("/:id/cancel", ordersController.cancel);

export const publicRouter = Router()
  .get("/qr/:code", publicReadLimiter, publicController.qrLanding)
  .post("/qr/:code/orders", publicWriteLimiter, publicController.book)
  .get("/track/:trackingCode", publicReadLimiter, publicController.track);
