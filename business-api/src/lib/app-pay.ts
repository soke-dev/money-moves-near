/**
 * Paying a checkout from the Money Moves app: we open the payment on the app's
 * side, it reaches the customer by the QR they scan or the link they open
 * (never by a typed username), they approve it and send stablecoins from their
 * own wallet to our treasury, and we read that it's paid. The same narrow
 * internal API as account links, signed with BUSINESS_LINK_SECRET.
 */
import { env } from "../config/env";
import { HttpError } from "./http";

export type AppPaymentStatus = "PENDING" | "PAYING" | "PAID" | "DECLINED" | "CANCELLED" | "EXPIRED";
export type AppPayment = {
  id: string;
  code: string;
  status: AppPaymentStatus;
  username: string | null;
  chain: string | null;
  asset: string | null;
  txHash: string | null;
};

export const appPayReady = () => !!env.BUSINESS_LINK_SECRET;

const off = () => new HttpError(503, "Paying with the Money Moves app isn't switched on yet. Try another way to pay.", "app_off");

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; data: (T & { code?: string; error?: string }) | null }> {
  if (!appPayReady()) throw off();
  let res: Response;
  try {
    res = await fetch(`${env.APP_API_URL}/api/internal/business-payments${path}`, {
      method,
      headers: { "content-type": "application/json", "x-business-link-secret": env.BUSINESS_LINK_SECRET! },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(502, "We couldn't reach Money Moves just now. Try again in a moment.", "app_unreachable");
  }
  const data = (await res.json().catch(() => null)) as (T & { code?: string; error?: string }) | null;
  // A bare 404 means the app's side isn't there yet (or not this version of it).
  if (res.status === 404 && !data?.code) throw off();
  return { status: res.status, data };
}

/**
 * Where the customer can pay: our treasury on each chain the app sends from.
 * The EVM chains share one address.
 */
export function treasuryAddresses(): Record<string, string> {
  const out: Record<string, string> = {};
  if (env.TREASURY_EVM_ADDRESS) for (const c of ["MONAD", "ARC", "BASE", "BEP20"]) out[c] = env.TREASURY_EVM_ADDRESS;
  if (env.TREASURY_SOLANA_ADDRESS) out.SOL = env.TREASURY_SOLANA_ADDRESS;
  if (env.TREASURY_MOVEMENT_ADDRESS) out.MOVE = env.TREASURY_MOVEMENT_ADDRESS;
  return out;
}

export async function openAppPayment(p: {
  businessId: string;
  businessName: string;
  /** Its logo's https address, when it has one. */
  businessLogo?: string;
  paymentRef: string;
  title?: string;
  amount: string;
  priceLabel?: string;
  addresses: Record<string, string>;
  expiresAt: string;
}): Promise<AppPayment> {
  const r = await call<{ payment?: AppPayment }>("POST", "", p);
  if (!r.data?.payment) throw new HttpError(502, "Money Moves didn't take the payment just now. Try again in a moment.", "app_error");
  return r.data.payment;
}

/** Where several stand, in one call. */
export async function readAppPayments(ids: string[]): Promise<AppPayment[]> {
  if (!ids.length) return [];
  const r = await call<{ payments?: AppPayment[] }>("POST", "/status", { ids });
  return r.data?.payments ?? [];
}
