import { env } from "../config/env";

/**
 * flw-bills.ts — bills on Flutterwave v3.
 *
 * Bills do not exist in the v4 API the rest of this integration uses, so this
 * is the one place that speaks v3, with the old FLWSECK secret rather than
 * OAuth. The two never meet: v4 moves money to banks, v3 buys airtime.
 *
 * Three things learned the expensive way, each of which costs money or an
 * outage if forgotten:
 *
 *  1. The bills API is behind an IP ALLOWLIST. Every other v3 endpoint answers
 *     without one, so a key that reads balances perfectly can be refused by
 *     every bill call - with "This request cannot be processed. Please contact
 *     your account administrator", which says nothing about IPs. Whitelist the
 *     server's outbound address in the Flutterwave dashboard; the admin rail
 *     check prints it.
 *  2. The catalogue is NOT Nigeria-only despite the country filter. Ugandan
 *     and Ghanaian billers come back in the same payload, so everything here
 *     filters on country === "NG" before trusting it.
 *  3. `customer_reference` is stored but we have NOT established that it is
 *     enforced as an idempotency key. Nothing in this module retries a
 *     purchase blindly; the caller asks findByReference first. Until a
 *     duplicate has been tested against the live API, assume a repeat POST
 *     charges twice.
 */

const base = () => env.FLW_V3_BASE_URL.replace(/\/$/, "");

export function isFlwBillsConfigured(): boolean {
  return !!env.FLW_V3_SECRET_KEY;
}

export interface FlwBillItem {
  biller_code: string;
  item_code: string;
  name: string;
  biller_name: string;
  short_name: string;
  country: string;
  is_airtime: boolean;
  amount: number;
  fee: number;
  default_commission: number;
  label_name: string;
}

interface V3<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  message: string;
}

async function v3<T = any>(path: string, init?: RequestInit): Promise<V3<T>> {
  if (!isFlwBillsConfigured()) {
    return { ok: false, status: 0, data: null, message: "Flutterwave bills are not configured" };
  }

  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.FLW_V3_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    // A status is still an answer.
  }

  return {
    // v3 answers 200 with status:"error" for business failures, so the HTTP
    // code alone is not the answer.
    ok: res.ok && body?.status !== "error",
    status: res.status,
    data: (body?.data ?? null) as T | null,
    message: body?.message || `Flutterwave ${res.status}`,
  };
}

// ─── The catalogue ────────────────────────────────────────────

const CATALOGUE_TTL = 6 * 60 * 60 * 1000;
let catalogue: { items: FlwBillItem[]; at: number } | null = null;

export async function flwBillCatalogue(): Promise<FlwBillItem[]> {
  if (catalogue && Date.now() - catalogue.at < CATALOGUE_TTL) return catalogue.items;

  const r = await v3<FlwBillItem[]>("/bill-categories?country=NG");
  const items = (Array.isArray(r.data) ? r.data : []).filter((i) => i.country === "NG");

  // Never cache an empty answer: a blip would keep bills broken for six hours.
  if (items.length > 0) catalogue = { items, at: Date.now() };
  return items;
}

/**
 * Airtime is one product for every network.
 *
 * BIL099/AT099 is listed once each under MTN, Airtel, Glo and 9mobile, all
 * with the same codes - Flutterwave reads the network off the number itself.
 * There are network-specific VTU billers too, and using them would mean
 * trusting our own network detection over theirs for no gain.
 */
export const FLW_AIRTIME = { billerCode: "BIL099", itemCode: "AT099" };

/** Data, by the names the app uses for networks. */
const DATA_BILLERS: Record<string, string> = {
  MTN: "BIL108",
  Glo: "BIL109",
  Airtel: "BIL110",
  "9Mobile": "BIL111",
};

/** Electricity, by the disco codes the app already sends. */
const DISCO_BILLERS: Record<string, string> = {
  EKEDC: "BIL112",
  IKEDC: "BIL113",
  IBEDC: "BIL114",
  EEDC: "BIL115",
  PHED: "BIL116",
  BEDC: "BIL117",
  YEDC: "BIL118",
  KAEDCO: "BIL119",
  KEDCO: "BIL120",
  AEDC: "BIL204",
  JED: "BIL215",
};

/** Cable, by provider. */
const CABLE_BILLERS: Record<string, string> = {
  DSTV: "BIL121",
  GOtv: "BIL122",
  StarTimes: "BIL123",
};

export function flwSupportsDisco(disco: string): boolean {
  return !!DISCO_BILLERS[disco];
}

/** Every plan a network sells, in the shape the app already renders. */
export async function flwDataPlans(network: string): Promise<
  { variation_id: string; service_name: string; data_plan: string; price: string }[]
> {
  const biller = DATA_BILLERS[network];
  if (!biller) return [];

  const items = (await flwBillCatalogue()).filter((i) => i.biller_code === biller);

  return items
    .filter((i) => i.amount > 0)
    .sort((a, b) => a.amount - b.amount)
    .map((i) => ({
      // The item code IS the variation id as far as the app is concerned; it
      // is handed back to us at purchase time and used verbatim.
      variation_id: i.item_code,
      service_name: network,
      data_plan: i.name,
      price: String(i.amount),
    }));
}

/**
 * The item for a meter, prepaid or postpaid.
 *
 * Resolved from the catalogue by name rather than pinned as twenty-two
 * hardcoded item codes: the codes change when Flutterwave re-lists a biller,
 * and a stale one fails at the moment somebody is paying.
 */
export async function flwElectricityItem(
  disco: string,
  meterType: "prepaid" | "postpaid",
): Promise<{ billerCode: string; itemCode: string } | null> {
  const biller = DISCO_BILLERS[disco];
  if (!biller) return null;

  const items = (await flwBillCatalogue()).filter((i) => i.biller_code === biller);
  if (items.length === 0) return null;

  const want = meterType === "prepaid" ? /prepaid/i : /postpaid/i;
  const hit = items.find((i) => want.test(i.name)) || items.find((i) => want.test(i.short_name));

  // A disco listing only one item sells one kind of meter through it; using it
  // beats refusing a payment we can make.
  const chosen = hit || (items.length === 1 ? items[0] : null);
  return chosen ? { billerCode: biller, itemCode: chosen.item_code } : null;
}

/** The packages a cable provider sells. */
export async function flwCablePackages(
  provider: string,
): Promise<{ itemCode: string; name: string; amount: number }[]> {
  const biller = CABLE_BILLERS[provider];
  if (!biller) return [];

  return (await flwBillCatalogue())
    .filter((i) => i.biller_code === biller && i.amount > 0)
    .sort((a, b) => a.amount - b.amount)
    .map((i) => ({ itemCode: i.item_code, name: i.name.trim(), amount: i.amount }));
}

/**
 * Can this server buy a bill, or only look at the menu?
 *
 * Two different questions and only one of them is interesting. The catalogue
 * answers to anybody - no key, no allowlist - so a healthy-looking plan list
 * proves nothing at all, which is what made the first diagnosis wrong. The
 * history is account-scoped AND behind the bills IP allowlist, so it is the
 * one that tells you whether a purchase would go through from here.
 */
export async function flwBillsReachable(): Promise<{
  catalogue: boolean;
  account: boolean;
  error?: string;
}> {
  const cat = await flwBillCatalogue().catch(() => []);
  const hist = await v3<any[]>("/bills/history");

  return {
    catalogue: cat.length > 0,
    account: hist.ok,
    error: hist.ok ? undefined : hist.message,
  };
}

/**
 * The biller and item for a chosen package.
 *
 * Checked against the live catalogue rather than trusted from the client: the
 * item code comes back to us from the app, and an item that has since been
 * de-listed should fail here with something sayable rather than at the vend.
 */
export async function flwCableItem(
  provider: string,
  itemCode?: string,
): Promise<{ billerCode: string; itemCode: string } | null> {
  const biller = CABLE_BILLERS[provider];
  if (!biller || !itemCode) return null;

  const exists = (await flwBillCatalogue()).some(
    (i) => i.biller_code === biller && i.item_code === itemCode,
  );
  return exists ? { billerCode: biller, itemCode } : null;
}

// ─── Validation ───────────────────────────────────────────────

/**
 * Who a meter or smartcard belongs to.
 *
 * `POST /bills/validate` from the documentation does not exist; this is the
 * path that answers.
 */
export async function flwValidateCustomer(
  billerCode: string,
  itemCode: string,
  customer: string,
): Promise<{ ok: boolean; name: string | null; error?: string }> {
  const r = await v3<any>(
    `/bill-items/${encodeURIComponent(itemCode)}/validate?code=${encodeURIComponent(billerCode)}&customer=${encodeURIComponent(customer)}`,
  );

  const name = r.data?.name || r.data?.customer_name || r.data?.customer || null;
  return {
    ok: r.ok && !!name,
    name: name ? String(name).trim() : null,
    error: r.ok ? undefined : r.message,
  };
}

// ─── Buying ───────────────────────────────────────────────────

export interface FlwBillResult {
  ok: boolean;
  /** Flutterwave's own reference, for looking the payment up later. */
  txRef: string | null;
  /** Prepaid meter token, where the product returns one. */
  token: string | null;
  units: string | null;
  raw: any;
  error?: string;
}

/**
 * Pay one bill.
 *
 * Deliberately has no retry of its own. We have not established that
 * `reference` is enforced as an idempotency key - Flutterwave stores it as
 * `customer_reference` but storing and deduplicating are different things - so
 * a second POST may well be a second charge. The caller asks
 * flwFindByReference first and only sends when the answer is nothing.
 */
export async function flwPayBill(args: {
  billerCode: string;
  itemCode: string;
  customer: string;
  amount: number;
  reference: string;
}): Promise<FlwBillResult> {
  const r = await v3<any>(
    `/billers/${encodeURIComponent(args.billerCode)}/items/${encodeURIComponent(args.itemCode)}/payment`,
    {
      method: "POST",
      body: JSON.stringify({
        country: "NG",
        customer_id: args.customer,
        amount: args.amount,
        reference: args.reference,
      }),
    },
  );

  if (!r.ok) {
    return { ok: false, txRef: null, token: null, units: null, raw: r, error: r.message };
  }

  const { token, units } = extractToken(r.data);
  return {
    ok: true,
    txRef: r.data?.tx_ref ? String(r.data.tx_ref) : null,
    token,
    units,
    raw: r.data,
  };
}

/**
 * Did a bill with this reference already go out?
 *
 * The history is the only place our own reference can be looked up -
 * GET /bills/{reference} wants Flutterwave's, not ours - and it is what makes
 * a safe retry possible: before sending anything a second time, ask whether
 * the first one landed.
 */
export async function flwFindByReference(
  reference: string,
): Promise<{ found: boolean; status: string | null; raw: any }> {
  const r = await v3<any[]>("/bills/history");
  const rows = Array.isArray(r.data) ? r.data : [];
  const hit = rows.find((t) => String(t.customer_reference || "") === reference);

  return {
    found: !!hit,
    status: hit ? String(hit.status || "") : null,
    raw: hit ?? null,
  };
}

/** Flutterwave's status words onto ours. */
export function mapFlwBillStatus(status?: string): "PENDING" | "COMPLETED" | "FAILED" {
  const s = (status || "").toLowerCase();
  if (s === "successful" || s === "success" || s === "completed") return "COMPLETED";
  if (s === "failed" || s === "cancelled" || s === "reversed") return "FAILED";
  return "PENDING";
}

/**
 * The meter token, wherever this product put it.
 *
 * The same problem the VTU integration has: the field is named differently per
 * biller, and a token nobody can find is a payment nobody can use.
 */
function extractToken(data: any): { token: string | null; units: string | null } {
  if (!data) return { token: null, units: null };

  // recharge_token is what Flutterwave actually uses, and leaving it out of
  // this list cost somebody the token for a ₦1,000 meter payment: the money
  // left, the purchase succeeded, and the one thing they needed was dropped on
  // the way out. It is first now because it is the one that fires.
  const tokenKeys = [
    "recharge_token",
    "token",
    "purchased_code",
    "elec_token",
    "meter_token",
    "std_token",
  ];
  const unitsKeys = ["units", "unit", "kwh"];
  const sources = [data, data.extra, data.product_details, data.response];

  let token: string | null = null;
  let units: string | null = null;

  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    for (const k of tokenKeys) {
      if (!token && src[k] != null && String(src[k]).trim() !== "") token = String(src[k]).trim();
    }
    for (const k of unitsKeys) {
      if (!units && src[k] != null && String(src[k]).trim() !== "") units = String(src[k]).trim();
    }
  }

  // Some discos return the token inside a sentence rather than a field.
  if (!token && typeof data.extra === "string") {
    const m = data.extra.match(/\b(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{0,4})\b/);
    if (m) token = m[1].replace(/[\s-]/g, "");
  }

  return { token, units };
}
