/**
 * Where a checkout lives, as a full address: on the checkout's own host when
 * PAY_ORIGIN is set (pay.usemoneymoves.xyz/test-money-moves), otherwise on the
 * dashboard's, under /pay. Both keep working; this is only what new links say.
 */
import { env } from "../config/env";

export function checkoutLink(path: string, dashboardOrigin?: string): string {
  if (env.PAY_ORIGIN) return `${env.PAY_ORIGIN.replace(/\/$/, "")}/${path}`;
  return `${dashboardOrigin ?? env.ALLOWED_ORIGINS[0] ?? "http://localhost:5174"}/pay/${path}`;
}
