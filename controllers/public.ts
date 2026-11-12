import type { Request, Response } from "express";
import { ok } from "../lib/respond.js";
import { bookViaQr, getQrLanding, trackOrder } from "../services/public.js";

export const publicController = {
  async qrLanding(req: Request<{ code: string }>, res: Response) {
    ok(res, await getQrLanding(req.params.code));
  },
  async book(req: Request<{ code: string }>, res: Response) {
    ok(res, await bookViaQr(req.params.code, req.body), 201, "Booking confirmed");
  },
  async track(req: Request<{ trackingCode: string }>, res: Response) {
    res.set("Cache-Control", "no-store");
    ok(res, await trackOrder(req.params.trackingCode));
  },
};
