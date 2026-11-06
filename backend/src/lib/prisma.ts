import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

/**
 * Prisma sizes its pool from the host's CPU count, and a shared host reports far
 * more CPUs than this service uses. A limit already in the URL wins.
 */
function pooledUrl(url: string | undefined) {
  if (!url || /[?&]connection_limit=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}connection_limit=10`;
}

const url = pooledUrl(process.env.DATABASE_URL);

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    ...(url ? { datasources: { db: { url } } } : {}),
    log: process.env.PRISMA_LOG_QUERIES === "1"
      ? ["query", "error", "warn"]
      : process.env.NODE_ENV === "development"
      ? ["error", "warn"]
      : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
