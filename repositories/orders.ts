import { prisma } from "../startup/db.js";

class OrdersRepository {
  findById(tenantId: string, id: string) {
    return prisma.order.findFirst({
      where: { id, tenantId },
      include: { customer: true, events: { orderBy: { createdAt: "asc" } } },
    });
  }
}

export const ordersRepository = new OrdersRepository();
