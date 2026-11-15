/**
 * VTU.ng Partner API (v1).
 * Docs: https://developer.vtu.ng/docs  Spec: https://developer.vtu.ng/openapi/partner-v1.json
 *
 * Authenticated with a secret key (vtu_sk_live_... on api.vtu.ng, vtu_sk_test_...
 * on sandbox.vtu.ng; mixing them is refused). Every purchase carries an
 * Idempotency-Key, which is our own request id: the same id can never be
 * charged twice, and it is also how we look the purchase up again.
 *
 * The rest of the app was written against the old API's shapes, so replies are
 * translated back into them here: purchases and requeries come back as
 * { code: "success", data: { status } } with status completed-api, pending-api
 * or refunded; plans as { data: [{ variation_id, data_plan, price }] }; checks
 * as { data: { customer_name, ... } }. Nothing outside this file had to change.
 */
import axios, { AxiosError } from "axios";
import crypto from "crypto";
import http from "http";
import https from "https";
import { env } from "../config/env";

const httpAgent = new http.Agent({ keepAlive: false });
const httpsAgent = new https.Agent({ keepAlive: false });

export function vtuConfigured(): boolean {
  return !!env.VTU_API_KEY;
}

function headers(idempotencyKey?: string) {
  if (!env.VTU_API_KEY) throw new Error("VTU.ng isn't set up: VTU_API_KEY is missing");
  return {
    Authorization: `Bearer ${env.VTU_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };
}

/** Their errors are { error: { code, message } }; the callers read response.data.message. */
function lift(err: unknown): never {
  const e = err as AxiosError<any>;
  const body = e?.response?.data;
  if (body?.error?.message && e.response) {
    e.response.data = { ...body, message: body.error.message, code: body.error.code };
    e.message = body.error.message;
  }
  throw e;
}

const TRANSIENT = ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNABORTED", "EPIPE"];

async function call<T = any>(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { data } = await axios.request({
        method,
        url: `${env.VTU_BASE_URL}${path}`,
        data: body,
        headers: headers(idempotencyKey),
        timeout: method === "POST" ? 45_000 : 20_000,
        httpAgent,
        httpsAgent,
      });
      return data;
    } catch (err: any) {
      const transient = TRANSIENT.some((c) => err?.code === c || String(err?.message || "").includes(c));
      // A purchase is only retried with its own idempotency key, so a retry can never buy twice.
      if (!transient || attempt === 3) lift(err);
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  throw new Error("unreachable");
}

// ─── Request ids ─────────────────────────────────────────────
export function generateRequestId(): string {
  return `MM-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

// ─── Slugs ───────────────────────────────────────────────────
const NETWORK_TO_SERVICE: Record<string, string> = {
  MTN: "mtn",
  Airtel: "airtel",
  Glo: "glo",
  // 9mobile is t2mobile on the new API.
  "9Mobile": "t2mobile",
};

export function networkToServiceId(network: string): string {
  const sid = NETWORK_TO_SERVICE[network];
  if (!sid) throw new Error(`Unknown network: ${network}`);
  return sid;
}

const DISCO_TO_SERVICE: Record<string, string> = {
  IKEDC: "ikedc",
  EKEDC: "ekedc",
  KEDCO: "kedco",
  PHED: "phed",
  JED: "jed",
  IBEDC: "ibedc",
  KAEDCO: "kaedco",
  AEDC: "aedc",
  EEDC: "eedc",
  BEDC: "bedc",
  ABEDC: "abedc",
  YEDC: "yedc",
};

export function discoToServiceId(disco: string): string {
  const sid = DISCO_TO_SERVICE[disco];
  if (!sid) throw new Error(`Unsupported disco: ${disco}`);
  return sid;
}

/** The bookmakers we offer, and their slug on VTU.ng (lowercase on the new API). */
const BETTING_TO_SERVICE: Record<string, string> = {
  SportyBet: "sportybet",
  Bet9ja: "bet9ja",
};

export const BETTING_PROVIDERS = Object.keys(BETTING_TO_SERVICE);

export function bettingToServiceId(provider: string): string {
  const sid = BETTING_TO_SERVICE[provider];
  if (!sid) throw new Error(`Unsupported betting provider: ${provider}`);
  return sid;
}

// ─── Transactions, in the old shape ──────────────────────────

/** completed -> completed-api; failed, refunded, cancelled -> refunded; anything else pending-api. */
function oldStatus(v: string): string {
  if (v === "completed") return "completed-api";
  if (v === "failed" || v === "refunded" || v === "cancelled") return "refunded";
  return "pending-api";
}

function asOld(tx: any) {
  const meta = (tx?.metadata && !Array.isArray(tx.metadata) ? tx.metadata : {}) as Record<string, any>;
  return {
    code: "success",
    message: tx?.failure_reason || tx?.description || "",
    data: {
      status: oldStatus(String(tx?.status?.value || "")),
      reference: tx?.reference,
      request_id: tx?.idempotency_key,
      amount: tx?.amount?.raw,
      failure_reason: tx?.failure_reason || null,
      // Prepaid electricity: the token to load on the meter, once it is done.
      token: meta.electricity_token || null,
      units: meta.electricity_units || meta.units || null,
    },
    raw: tx,
  };
}

/** Looks a purchase up by our request id (the Idempotency-Key it was sent with). 404 throws. */
async function lookup(requestId: string) {
  const r = await call("GET", `/transactions/${encodeURIComponent(requestId)}?type=bill_payment`);
  return r?.data ?? r;
}

/**
 * Buys, then waits a few seconds for the final answer: most airtime and data
 * completes in seconds, and saying "delivered" at once beats a pending row the
 * app has to poll. Still processing after that is returned as pending.
 */
async function buy(path: string, body: Record<string, unknown>, requestId: string) {
  const r = await call("POST", path, body, requestId);
  let tx = r?.transaction ?? r?.data ?? r;
  for (let i = 0; i < 4 && !tx?.status?.is_final; i++) {
    await new Promise((res) => setTimeout(res, 3000));
    try {
      tx = await lookup(requestId);
    } catch {
      break; // the purchase stands; the requery finishes it later
    }
  }
  return asOld(tx);
}

export async function requeryOrder(requestId: string) {
  return asOld(await lookup(requestId));
}

// ─── Airtime and data ────────────────────────────────────────
export async function purchaseAirtime(params: { phone: string; network: string; amount: number; requestId: string }) {
  return buy(
    "/bills/airtime",
    { phone: params.phone, network: networkToServiceId(params.network), amount: params.amount },
    params.requestId,
  );
}

/** Plans for a network, as the app reads them: variation_id, data_plan, price. */
export async function getDataVariations(network: string) {
  const r = await call("GET", `/bills/data-plans?network=${networkToServiceId(network)}`);
  const plans: any[] = r?.data || [];
  return {
    code: "success",
    data: plans.map((p) => ({
      variation_id: p.variation_code,
      data_plan: p.name,
      price: p.amount,
      availability: "Available",
      fixed_price: p.fixed_price,
    })),
  };
}

export async function purchaseData(params: { phone: string; network: string; variationId: string; requestId: string }) {
  return buy(
    "/bills/data",
    { phone: params.phone, network: networkToServiceId(params.network), variation_code: params.variationId },
    params.requestId,
  );
}

// ─── Electricity ─────────────────────────────────────────────
export async function verifyMeter(params: { customerId: string; disco: string; type: "prepaid" | "postpaid" }) {
  const r = await call("POST", "/bills/electricity/verify-meter", {
    disco_slug: discoToServiceId(params.disco),
    meter_number: params.customerId,
    meter_type: params.type,
  });
  const v = r?.verification;
  if (!v || Array.isArray(v) || !v.customer_name) {
    return { code: "failed", message: r?.message || "Meter not found", data: null };
  }
  return {
    code: "success",
    data: {
      customer_name: v.customer_name,
      customer_address: v.address || "",
      meter_number: v.meter_number || params.customerId,
      min_purchase_amount: v.minimum_purchase_amount,
      meter_type: v.meter_type,
    },
  };
}

export async function purchaseElectricity(params: {
  customerId: string;
  disco: string;
  type: "prepaid" | "postpaid";
  amount: number;
  requestId: string;
}) {
  return buy(
    "/bills/electricity",
    {
      disco_slug: discoToServiceId(params.disco),
      meter_number: params.customerId,
      meter_type: params.type,
      amount: params.amount,
    },
    params.requestId,
  );
}

// ─── Betting ─────────────────────────────────────────────────
export async function verifyBettingAccount(params: { customerId: string; provider: string }) {
  const r = await call("POST", "/bills/bet-funding/verify-account", {
    provider: bettingToServiceId(params.provider),
    account_id: params.customerId,
  });
  const v = r?.validation;
  return {
    code: v?.name ? "success" : "failed",
    data: v?.name
      ? {
          customer_name: v.name,
          customer_username: v.username ?? null,
          minimum_amount: v.min_payable_amount ?? null,
          maximum_amount: null,
        }
      : null,
  };
}

export async function fundBettingAccount(params: { customerId: string; provider: string; amount: number; requestId: string }) {
  return buy(
    "/bills/bet-funding",
    { provider: bettingToServiceId(params.provider), account_id: params.customerId, amount: params.amount },
    params.requestId,
  );
}

// ─── Wallet ──────────────────────────────────────────────────
/** Our NGN balance at VTU.ng, for the console. */
export async function vtuWalletBalance(): Promise<number | null> {
  const r = await call("GET", "/wallet");
  const ngn = (r?.data || []).find((w: any) => w.currency === "NGN");
  return ngn ? Number(ngn.balance) : null;
}
