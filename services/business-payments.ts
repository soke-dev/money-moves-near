import { api } from "./api";

/** A checkout on Money Moves Business waiting to be paid from this account. */
export interface BusinessPayment {
  id: string;
  businessName: string;
  /** The business's logo, when it has one. */
  businessLogo?: string | null;
  /** The business's own reference for the payment ("MMB-…"). */
  reference?: string;
  title: string | null;
  /** In US dollars, sent as USDC or USDT. */
  amount: string;
  /** How the business priced it ("₦7,500.00"), when it isn't in dollars. */
  priceLabel: string | null;
  /** Where it can be paid: each chain, its address, and the coins it takes there. */
  pay: { chain: string; address: string; assets: string[] }[];
  status: "PENDING" | "PAYING" | "PAID" | "DECLINED" | "CANCELLED" | "EXPIRED";
  txHash: string | null;
  paidChain?: string | null;
  paidAsset?: string | null;
  paidAt?: string | null;
  expiresAt: string;
  createdAt: string;
}

export async function getBusinessPayments(): Promise<BusinessPayment[]> {
  const { data } = await api.get("/business-payments");
  return data.payments;
}

export async function getBusinessPayment(id: string): Promise<BusinessPayment> {
  const { data } = await api.get(`/business-payments/${encodeURIComponent(id)}`);
  return data.payment;
}

/** A checkout's code, scanned: it becomes this account's to pay. */
export async function claimBusinessPayment(code: string): Promise<BusinessPayment> {
  const { data } = await api.post("/business-payments/claim", { code });
  return data.payment;
}

export async function declineBusinessPayment(id: string): Promise<void> {
  await api.post(`/business-payments/${encodeURIComponent(id)}/decline`);
}

/** What older checkout QR codes carry. */
export const BUSINESS_PAY_PREFIX = "mm:pay:";

/**
 * The code in a checkout's link or QR: `money-moves://business-pay?code=…`, or
 * an older `mm:pay:…`. Null for anything else.
 */
export function businessPayCodeFrom(scanned: string): string | null {
  const s = scanned.trim();
  if (s.startsWith(BUSINESS_PAY_PREFIX)) return s.slice(BUSINESS_PAY_PREFIX.length) || null;
  const m = s.match(/^money-moves:\/\/\/?business-pay\?(?:.*&)?code=([A-Za-z0-9_-]{8,64})/);
  return m ? m[1] : null;
}

/** The three kinds of checkout a Money Moves Business QR can carry. */
export type CheckoutKind = "link" | "outlet" | "invoice";

/**
 * A Money Moves Business checkout address, as a poster or a link's QR carries
 * it - on the checkout's own host (pay.usemoneymoves.xyz/slug, /o/slug,
 * /i/token) or the dashboard's (business.usemoneymoves.xyz/pay/...). Scanned
 * in the app, it opens in the app; a phone's own camera opens the web page.
 */
export function businessCheckoutFrom(scanned: string): { kind: CheckoutKind; ref: string; url: string } | null {
  const s = scanned.trim();
  const m = s.match(/^https?:\/\/(?:pay\.usemoneymoves\.xyz(?:\/pay)?|business\.usemoneymoves\.xyz\/pay)\/(?:(o|i)\/)?([A-Za-z0-9_-]{1,64})\/?(?:[?#].*)?$/i);
  if (!m) return null;
  const kind: CheckoutKind = m[1] === "o" ? "outlet" : m[1] === "i" ? "invoice" : "link";
  // The legal pages live on the same host; they aren't checkouts.
  if (kind === "link" && /^(legal|terms|privacy)$/i.test(m[2])) return null;
  return { kind, ref: m[2], url: s };
}

/** What a scanned checkout is - or why the app can't take it. */
export interface BusinessCheckout {
  business: { name: string; logo: string | null; verified: boolean };
  title: string;
  description: string | null;
  currency: "NGN" | "USD";
  /** A set price, in the checkout's currency; null when the payer types it. */
  amount: number | null;
  /** The checkout's own least, in its currency. */
  min: number | null;
  /** The business's limits for one payment, in naira. */
  limits: { minNgn: number; maxNgn: number };
  /** Naira per dollar, or null while it can't be read. */
  rate: number | null;
  payable: boolean;
  blocked: { code: string; message: string } | null;
}

export async function getBusinessCheckout(kind: CheckoutKind, ref: string): Promise<BusinessCheckout> {
  const { data } = await api.get(`/business-payments/checkout/${kind}/${encodeURIComponent(ref)}`);
  return data.checkout;
}

/** Opens the payment for this person; the pay screen takes it from there. */
export async function openBusinessCheckout(kind: CheckoutKind, ref: string, body: { amount?: number; currency?: "NGN" | "USD" } = {}): Promise<BusinessPayment> {
  const { data } = await api.post(`/business-payments/checkout/${kind}/${encodeURIComponent(ref)}/open`, body);
  return data.payment;
}

/**
 * A checkout link that opened the app before it was unlocked.
 *
 * The link lands on the pay screen directly, ahead of the PIN. Rather than show
 * a payment to whoever holds the phone, the code waits here while they unlock,
 * and Home opens it once they're in.
 */
let heldCode: string | null = null;
export const holdBusinessPayCode = (code: string) => {
  heldCode = code;
};
export const takeBusinessPayCode = () => {
  const c = heldCode;
  heldCode = null;
  return c;
};
