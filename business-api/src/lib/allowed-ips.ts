/**
 * The IP whitelist: the addresses a business's servers call the API from.
 * One address at a time, IPv4 or IPv6, never a range. With the whitelist on,
 * money leaves by API (a refund) only from one of them. Payments coming in
 * are never blocked.
 */
import net from "net";
import type { Mode } from "@prisma/client";
import { prisma } from "./prisma";

/** "::ffff:1.2.3.4" is 1.2.3.4. */
const bare = (ip: string) => ip.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");

/** An address worth saving, written one way so it's never on the list twice. Null when it isn't one. */
export function cleanIp(raw: string): string | null {
  const ip = bare(raw);
  const family = net.isIP(ip);
  if (!family) return null;
  if (family === 4) return ip.split(".").map(Number).join(".");
  // The shortest form: what a SocketAddress prints.
  return new net.SocketAddress({ address: ip, family: "ipv6" }).address.toLowerCase();
}

/** Whether a caller's address is this one. */
export function sameIp(caller: string, allowed: string): boolean {
  const a = cleanIp(caller);
  return !!a && a === cleanIp(allowed);
}

/**
 * Whether a request from this address may move money for this business and
 * mode. With the whitelist off, any address may; on, only one on the list (an
 * empty list refuses everything).
 */
export async function ipMayMoveMoney(businessId: string, mode: Mode, caller: string, enforced: boolean): Promise<boolean> {
  if (!enforced) return true;
  const list = await prisma.apiAllowedIp.findMany({ where: { businessId, mode }, select: { ip: true } });
  return list.some((a) => sameIp(caller, a.ip));
}

/** Marks an address on the list as seen when it calls, whether or not the whitelist is on, so the dashboard can show "Last request". To the minute: not a write on every call. */
export async function markIpSeen(businessId: string, mode: Mode, caller: string): Promise<void> {
  const ip = cleanIp(caller);
  if (!ip) return;
  await prisma.apiAllowedIp.updateMany({ where: { businessId, mode, ip, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(Date.now() - 60_000) } }] }, data: { lastSeenAt: new Date() } }).catch(() => {});
}
