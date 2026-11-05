import "dotenv/config";

export const config = {
  databaseUrl: process.env.DATABASE_URL,
  port: Number(process.env.PORT ?? 8001),
  clientUrl: process.env.CLIENT_URL ?? "http://localhost:5173",
  apiVersion: process.env.API_VERSION ?? "/api/v1",
};
