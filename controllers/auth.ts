import type { CookieOptions, Request, Response } from "express";
import type { RefreshResponse } from "../contracts/index.js";
import { config } from "../config/index.js";
import { authOf } from "../middleware/auth.js";
import { ok } from "../lib/respond.js";
import * as auth from "../services/auth.js";

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: config.auth.cookieSecure,
  sameSite: "lax",
  path: `${config.apiVersion}/auth`, // sent only to the auth endpoints that need it
});

const readRefreshCookie = (req: Request): string | undefined => req.cookies?.[config.auth.refreshCookieName];

function setRefreshCookie(res: Response, token: string) {
  res.cookie(config.auth.refreshCookieName, token, {
    ...cookieOptions(),
    maxAge: config.auth.refreshTtlDays * 86_400_000,
  });
}

export const authController = {
  async signup(req: Request, res: Response) {
    const session = await auth.signup(req.body);
    setRefreshCookie(res, session.refreshToken);
    ok(res, session.body, 201);
  },

  async login(req: Request, res: Response) {
    const session = await auth.login(req.body);
    setRefreshCookie(res, session.refreshToken);
    ok(res, session.body);
  },

  async refresh(req: Request, res: Response) {
    try {
      const session = await auth.refresh(readRefreshCookie(req));
      setRefreshCookie(res, session.refreshToken);
      const body: RefreshResponse = { accessToken: session.body.accessToken };
      ok(res, body);
    } catch (err) {
      res.clearCookie(config.auth.refreshCookieName, cookieOptions());
      throw err;
    }
  },

  async logout(req: Request, res: Response) {
    await auth.logout(readRefreshCookie(req));
    res.clearCookie(config.auth.refreshCookieName, cookieOptions());
    ok(res, null);
  },

  async me(req: Request, res: Response) {
    ok(res, await auth.me(authOf(req)));
  },
};
