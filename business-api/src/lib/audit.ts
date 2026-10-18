import type { Request } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { log } from "./log";

/** Records an action. A failure here is logged, never allowed to fail the request it describes. */
export async function audit(req: Request, action: string, opts: { userId?: string; businessId?: string; detail?: Prisma.InputJsonValue } = {}) {
  await prisma.auditLog
    .create({ data: { action, userId: opts.userId ?? req.auth?.userId ?? null, businessId: opts.businessId ?? null, detail: opts.detail, ip: req.clientIp ?? null } })
    .catch((e) => log.error("[audit] write failed", { action, reason: String(e?.message ?? e) }));
}
