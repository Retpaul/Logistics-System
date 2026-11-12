import type { Request, Response } from "express";
import { authOf } from "../middleware/auth.js";
import { ok } from "../lib/respond.js";
import { cancelOrder, createOrder, getOrder, listOrders } from "../services/orders.js";

export const ordersController = {
  async list(req: Request, res: Response) {
    ok(res, await listOrders(authOf(req).tenantId, req.query));
  },
  async get(req: Request<{ id: string }>, res: Response) {
    ok(res, await getOrder(authOf(req).tenantId, req.params.id));
  },
  async create(req: Request, res: Response) {
    ok(res, await createOrder(authOf(req).tenantId, req.body), 201, "Order created");
  },
  async cancel(req: Request<{ id: string }>, res: Response) {
    ok(res, await cancelOrder(authOf(req).tenantId, req.params.id, req.body), 200, "Order cancelled");
  },
};
