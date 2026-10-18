import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.PRISMA_LOG_QUERIES === "1"
      ? ["query", "error", "warn"]
      : process.env.NODE_ENV === "development"
      ? ["error", "warn"]
      : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
