import type { AuthContext } from "../lib/tokens.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth. */
      auth?: AuthContext;
    }
  }
}

export {};
