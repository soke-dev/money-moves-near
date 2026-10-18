import { PrismaClient } from "@prisma/client";

/** One client for the process. It connects to the business database only. */
export const prisma = new PrismaClient();
