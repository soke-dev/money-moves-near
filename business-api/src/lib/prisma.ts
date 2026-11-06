import { PrismaClient } from "@prisma/client";

/**
 * Prisma sizes its pool from the host's CPU count, and a shared host reports far
 * more CPUs than this service uses. A limit already in the URL wins.
 */
function pooledUrl(url: string | undefined) {
  if (!url || /[?&]connection_limit=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}connection_limit=10`;
}

const url = pooledUrl(process.env.DATABASE_URL);

/** One client for the process. It connects to the business database only. */
export const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
