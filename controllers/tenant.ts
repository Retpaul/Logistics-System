import type { Request, Response } from "express";
import { authOf } from "../middleware/auth.js";
import { ok } from "../lib/respond.js";
import { getTenant, updateTenant } from "../services/tenant.js";

export const tenantController = {
  async get(req: Request, res: Response) {
    ok(res, await getTenant(authOf(req).tenantId));
  },
  async update(req: Request, res: Response) {
    ok(res, await updateTenant(authOf(req).tenantId, req.body), 200, "Organisation updated");
  },
};
