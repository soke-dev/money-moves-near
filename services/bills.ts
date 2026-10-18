import { api } from "./api";

// ─── Fetch real data plans from VTU.ng ──────────────────────
export async function getDataPlans(network: string) {
  const { data } = await api.get(`/bills/data-plans`, { params: { network } });
  return data;
}

// ─── Prepare a bill payment (airtime, data, or electricity) ──
export async function prepareBill(params: {
  type: "airtime" | "data" | "electricity" | "cable" | "betting";
  phone: string;
  network: string;
  amount: number;
  variationId?: string;
  planLabel?: string;
  asset: string;
  chain: string;
  senderAddress?: string;
  meterType?: "prepaid" | "postpaid";
  customerName?: string;
  disco?: string;
  packageCode?: string;
  packageName?: string;
}) {
  const { data } = await api.post("/bills/prepare", params);
  return data;
}

// ─── Submit signed bill payment ─────────────────────────────
export async function submitBill(params: {
  billId: string;
  signature: string;
  publicKey: string;
  /**
   * Set instead of signature/publicKey when an MPC wallet signed the whole
   * transaction: it cannot sign a bare hash, so it returns the raw signed
   * bytes and the backend validates them against what it prepared.
   */
  signedRaw?: string;
}) {
  const { data } = await api.post("/bills/submit", params, { timeout: 60000 });
  return data;
}

// ─── Requery bill status ────────────────────────────────────
export async function requeryBill(billId: string) {
  const { data } = await api.post("/bills/requery", { billId });
  return data;
}

// ─── Verify electricity meter ───────────────────────────────
export async function verifyMeterNumber(params: {
  customerId: string;
  disco: string;
  type: "prepaid" | "postpaid";
}) {
  const { data } = await api.post("/bills/verify-meter", params);
  return data;
}

// ─── Cable TV ───────────────────────────────────────────────

export interface CablePackage {
  /** The provider's item code. This is what gets bought. */
  code: string;
  name: string;
  amount: number;
}

/**
 * What a cable provider sells right now.
 *
 * Asked of the server rather than shipped in the app, because these are prices
 * and prices move: the screen this replaced carried a hardcoded list where
 * DStv Padi was ₦2,950 against a real ₦4,400.
 */
export async function getCablePackages(provider: string): Promise<CablePackage[]> {
  const res = await api.get(`/bills/cable-packages?provider=${encodeURIComponent(provider)}`);
  return (res.data?.packages || []) as CablePackage[];
}

export async function verifySmartcard(params: {
  smartcard: string;
  provider: string;
  packageCode: string;
}): Promise<{ verified: boolean; customerName: string }> {
  const res = await api.post("/bills/verify-smartcard", params);
  return res.data;
}

// ─── Betting ────────────────────────────────────────────────

/**
 * The bookmakers on offer.
 *
 * Asked of the server rather than listed here, so a third one can be added
 * without a store release - the same reasoning as the cable packages above.
 */
export async function getBettingProviders(): Promise<{
  providers: string[];
  paused: boolean;
  pausedReason: string | null;
}> {
  const res = await api.get("/bills/betting-providers");
  return {
    providers: res.data?.providers || [],
    paused: !!res.data?.paused,
    pausedReason: res.data?.pausedReason || null,
  };
}

/**
 * Whose betting account this is.
 *
 * `minAmount` and `maxAmount` are the bookmaker's own bounds, which can be
 * tighter than our tier - the screen takes whichever binds first.
 */
export async function verifyBettingAccount(params: {
  customerId: string;
  provider: string;
}): Promise<{
  verified: boolean;
  customerName: string;
  customerUsername: string;
  minAmount: number;
  maxAmount: number;
}> {
  const res = await api.post("/bills/verify-betting", params);
  return res.data;
}
