import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "../config/index.js";

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: config.databaseUrl, connectionTimeoutMillis: 3000 }),
});

export async function checkDatabase(): Promise<void> {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required; copy .env.example to .env");
  await prisma.$queryRaw`SELECT 1`;
}
