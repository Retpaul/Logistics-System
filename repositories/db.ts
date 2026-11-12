import type { Prisma } from "@prisma/client";

/** The shared client or an interactive-transaction client; repositories accept either. */
export type Db = Prisma.TransactionClient;
