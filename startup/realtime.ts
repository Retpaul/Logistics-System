import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { config } from "../config/index.js";
import { verifyAccessToken } from "../lib/tokens.js";
import { prisma } from "./db.js";
let io: Server | undefined;
export function publish(tenantId: string, trackingCode?: string) {
  io?.to(`tenant:${tenantId}`).emit("dispatch:changed");
  if (trackingCode) io?.to(`tracking:${trackingCode}`).emit("tracking:changed");
}
export function attachRealtime(server: HttpServer) {
  io = new Server(server, {
    cors: { origin: config.clientUrl, credentials: true },
    maxHttpBufferSize: 16384,
  });
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      const auth = typeof token === "string" ? verifyAccessToken(token) : null;
      if (auth) {
        if (
          !(await prisma.user.findFirst({
            where: {
              id: auth.userId,
              tenantId: auth.tenantId,
              role: auth.role,
            },
            select: { id: true },
          }))
        )
          return next(new Error("Unauthorized"));
        socket.data.tenantId = auth.tenantId;
        socket.data.authenticated = true;
        return next();
      }
      const code = socket.handshake.auth.trackingCode;
      if (
        typeof code !== "string" ||
        code.length > 64 ||
        !(await prisma.order.findUnique({
          where: { trackingCode: code },
          select: { id: true },
        }))
      )
        return next(new Error("Unauthorized"));
      socket.data.trackingCode = code;
      next();
    } catch {
      next(new Error("Connection unavailable"));
    }
  });
  io.on("connection", (socket) => {
    if (socket.data.authenticated)
      void socket.join(`tenant:${socket.data.tenantId}`);
    else void socket.join(`tracking:${socket.data.trackingCode}`);
    // Reauthenticate periodically and on reconnect; never keep expired access indefinitely.
    const timer = setInterval(() => {
      if (
        socket.data.authenticated &&
        !verifyAccessToken(socket.handshake.auth.token)
      )
        socket.disconnect(true);
    }, 15000);
    timer.unref();
    socket.on("disconnect", () => clearInterval(timer));
  });
  return io;
}
