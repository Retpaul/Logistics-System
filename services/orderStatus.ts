// The one place that decides which order status changes are allowed, and by whom.
import type { OrderStatus } from "../contracts/index.js";
import { AppError } from "../lib/errors.js";

export type Actor = "STAFF" | "RIDER";

const ALLOWED: Record<OrderStatus, Partial<Record<OrderStatus, readonly Actor[]>>> = {
  PENDING: { ASSIGNED: ["STAFF"], CANCELLED: ["STAFF"] },
  ASSIGNED: { PENDING: ["STAFF", "RIDER"], PICKED_UP: ["RIDER"], CANCELLED: ["STAFF"] },
  PICKED_UP: { IN_TRANSIT: ["RIDER"] },
  IN_TRANSIT: { DELIVERED: ["RIDER"] },
  DELIVERED: {},
  CANCELLED: {},
};

export const canTransition = (from: OrderStatus, to: OrderStatus, actor: Actor) =>
  ALLOWED[from][to]?.includes(actor) ?? false;

export function assertTransition(from: OrderStatus, to: OrderStatus, actor: Actor) {
  if (!canTransition(from, to, actor)) {
    throw new AppError(409, "INVALID_TRANSITION", `An order that is ${from} cannot be changed to ${to}`, { from, to });
  }
}
