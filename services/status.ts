import { api } from "./api";
import type { ServiceMap } from "@/constants/services";

/**
 * Which services are on.
 *
 * The server has always been able to refuse a paused service; nothing told
 * the app beforehand, so somebody could pick Bank Transfer, choose an account
 * and type an amount before finding out. This is the question the app asks at
 * launch so it can say so on the row instead.
 *
 * The shapes and the wording live in constants/services, which imports
 * nothing - this file is the only part that touches the network, and the API
 * client itself needs those titles.
 */

export async function fetchServiceStatus(): Promise<ServiceMap> {
  const res = await api.get("/status", { timeout: 8000 });
  noteFees(res.data?.fees);
  return (res.data?.services || {}) as ServiceMap;
}

/**
 * What a send costs, when it costs anything.
 *
 * Read from the same call that fetches service status, because the screens
 * that have to name a fee render before any send is prepared - they cannot
 * learn it from the response to a request they have not made.
 *
 * Zero until the server says otherwise, so a launch that cannot reach the
 * server quotes no fee rather than inventing one. The server charges what
 * it charges either way; this only decides whether the screen mentions it,
 * and the worst case is a figure appearing at prepare instead of before.
 */
let fees = { solanaSend: 0 };

function noteFees(incoming: unknown): void {
  const n = Number((incoming as any)?.solanaSend);
  if (Number.isFinite(n) && n >= 0) fees = { ...fees, solanaSend: n };
}

/** The flat charge on a Solana send to a wallet or a username. */
export function solanaSendFee(): number {
  return fees.solanaSend;
}

export type { ServiceKey, ServiceState, ServiceMap } from "@/constants/services";
export { PAUSED_TITLES, PAUSED_FALLBACK, backByLabel } from "@/constants/services";
