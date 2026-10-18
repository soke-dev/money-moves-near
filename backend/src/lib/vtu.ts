/**
 * VTU.ng API Client
 * Handles authentication, airtime, data purchases, and requery.
 * Docs: https://vtu.ng/api/
 */
import axios from "axios";
import crypto from "crypto";
import { env } from "../config/env";

import http from "http";
import https from "https";

const BASE_URL = "https://vtu.ng/wp-json";

// Force fresh connections — avoids ECONNRESET from stale keep-alive sockets
const httpAgent = new http.Agent({ keepAlive: false });
const httpsAgent = new https.Agent({ keepAlive: false });

// ─── JWT Token Cache ────────────────────────────────────────
let cachedToken: string | null = null;
let tokenExpiresAt = 0; // unix ms

async function getToken(): Promise<string> {
  // Refresh 1 hour before expiry
  if (cachedToken && Date.now() < tokenExpiresAt - 3600_000) {
    return cachedToken;
  }

  const { data } = await axios.post(`${BASE_URL}/jwt-auth/v1/token`, {
    username: env.VTU_EMAIL,
    password: env.VTU_PASSWORD,
  });

  if (!data.token) {
    throw new Error(`VTU auth failed: ${JSON.stringify(data)}`);
  }

  cachedToken = data.token;
  // VTU tokens last 7 days
  tokenExpiresAt = Date.now() + 6 * 24 * 3600_000;
  return cachedToken!;
}

// ─── Retry helper for transient network errors ──────────────
const TRANSIENT_CODES = ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNABORTED", "EPIPE", "ERR_SOCKET_CONNECTION_TIMEOUT"];

async function withRetry<T>(fn: () => Promise<T>, label: string, maxAttempts = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const code = err?.code || "";
      const msg = err?.message || "";
      const isTransient = TRANSIENT_CODES.some((c) => code === c || msg.includes(c));
      if (!isTransient || attempt === maxAttempts) throw err;
      const delay = attempt * 2000; // 2s, 4s
      console.warn(`[VTU] ${label} attempt ${attempt}/${maxAttempts} failed (${code || msg}), retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

async function vtuPost(endpoint: string, body: Record<string, any>) {
  const token = await getToken();
  return withRetry(async () => {
    const { data } = await axios.post(`${BASE_URL}${endpoint}`, body, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 45_000,
      httpAgent,
      httpsAgent,
    });
    return data;
  }, `POST ${endpoint}`);
}

async function vtuGet(endpoint: string) {
  return withRetry(async () => {
    const { data } = await axios.get(`${BASE_URL}${endpoint}`, {
      timeout: 15_000,
      httpAgent,
      httpsAgent,
    });
    return data;
  }, `GET ${endpoint}`);
}

// ─── Generate unique request ID ─────────────────────────────
export function generateRequestId(): string {
  return `MM-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

// ─── Service ID mapping ─────────────────────────────────────
const NETWORK_TO_SERVICE: Record<string, string> = {
  MTN: "mtn",
  Airtel: "airtel",
  Glo: "glo",
  "9Mobile": "9mobile",
};

export function networkToServiceId(network: string): string {
  const sid = NETWORK_TO_SERVICE[network];
  if (!sid) throw new Error(`Unknown network: ${network}`);
  return sid;
}

// ─── Airtime Purchase ───────────────────────────────────────
export async function purchaseAirtime(params: {
  phone: string;
  network: string;
  amount: number;
  requestId: string;
}) {
  const serviceId = networkToServiceId(params.network);
  return vtuPost("/api/v2/airtime", {
    request_id: params.requestId,
    phone: params.phone,
    service_id: serviceId,
    amount: params.amount,
  });
}

// ─── Data Variations (public, no auth) ──────────────────────
export async function getDataVariations(network: string) {
  const serviceId = networkToServiceId(network);
  return vtuGet(`/api/v2/variations/data?service_id=${serviceId}`);
}

// ─── Data Purchase ──────────────────────────────────────────
export async function purchaseData(params: {
  phone: string;
  network: string;
  variationId: string;
  requestId: string;
}) {
  const serviceId = networkToServiceId(params.network);
  return vtuPost("/api/v2/data", {
    request_id: params.requestId,
    phone: params.phone,
    service_id: serviceId,
    variation_id: params.variationId,
  });
}

// ─── Requery Order ──────────────────────────────────────────
export async function requeryOrder(requestId: string) {
  return vtuPost("/api/v2/requery", { request_id: requestId });
}

// ─── Electricity: Service ID mapping ────────────────────────
const DISCO_TO_SERVICE: Record<string, string> = {
  IKEDC: "ikeja-electric",
  EKEDC: "eko-electric",
  KEDCO: "kano-electric",
  PHED: "portharcourt-electric",
  JED: "jos-electric",
  IBEDC: "ibadan-electric",
  KAEDCO: "kaduna-electric",
  AEDC: "abuja-electric",
  EEDC: "enugu-electric",
  BEDC: "benin-electric",
  ABEDC: "aba-electric",
  YEDC: "yola-electric",
};

export function discoToServiceId(disco: string): string {
  const sid = DISCO_TO_SERVICE[disco];
  if (!sid) throw new Error(`Unsupported disco: ${disco}`);
  return sid;
}

// ─── Electricity: Verify Meter ──────────────────────────────
export async function verifyMeter(params: {
  customerId: string;
  disco: string;
  type: "prepaid" | "postpaid";
}) {
  const serviceId = discoToServiceId(params.disco);
  return vtuPost("/api/v2/verify-customer", {
    customer_id: params.customerId,
    service_id: serviceId,
    variation_id: params.type,
  });
}

// ─── Electricity: Purchase ──────────────────────────────────
export async function purchaseElectricity(params: {
  customerId: string;
  disco: string;
  type: "prepaid" | "postpaid";
  amount: number;
  requestId: string;
}) {
  const serviceId = discoToServiceId(params.disco);
  return vtuPost("/api/v2/electricity", {
    request_id: params.requestId,
    customer_id: params.customerId,
    service_id: serviceId,
    variation_id: params.type,
    amount: params.amount,
  });
}

// ─── Betting: Service ID mapping ────────────────────────────
/**
 * The betting providers we offer, and the id vtu.ng knows each by.
 *
 * Case matters here in a way it does nowhere else in this file. Airtime and
 * electricity ids are lowercase slugs - "mtn", "ikeja-electric" - but the
 * betting ones are the provider's own capitalisation, and the API does not
 * fold them. "bet9ja" is a provider it has never heard of.
 *
 * Two of the fourteen vtu.ng carries, deliberately. The rest - 1xBet, BangBet,
 * BetKing, BetLand, BetLion, BetWay, CloudBet, LiveScoreBet, MerryBet,
 * NaijaBet, NairaBet, SupaBet - work identically and need only be named here.
 */
const BETTING_TO_SERVICE: Record<string, string> = {
  SportyBet: "SportyBet",
  Bet9ja: "Bet9ja",
};

export const BETTING_PROVIDERS = Object.keys(BETTING_TO_SERVICE);

export function bettingToServiceId(provider: string): string {
  const sid = BETTING_TO_SERVICE[provider];
  if (!sid) throw new Error(`Unsupported betting provider: ${provider}`);
  return sid;
}

// ─── Betting: Verify Account ────────────────────────────────
/**
 * Whose betting account this is.
 *
 * Same endpoint as the meter check, without the variation_id - that field is
 * electricity's meter type and betting has no equivalent. Sending one anyway
 * is how a working call starts returning nothing.
 *
 * The reply carries `minimum_amount` and `maximum_amount`, which are the
 * provider's own bounds rather than ours and can be tighter than the tier.
 */
export async function verifyBettingAccount(params: {
  customerId: string;
  provider: string;
}) {
  const serviceId = bettingToServiceId(params.provider);
  return vtuPost("/api/v2/verify-customer", {
    customer_id: params.customerId,
    service_id: serviceId,
  });
}

// ─── Betting: Fund Account ──────────────────────────────────
export async function fundBettingAccount(params: {
  customerId: string;
  provider: string;
  amount: number;
  requestId: string;
}) {
  const serviceId = bettingToServiceId(params.provider);
  return vtuPost("/api/v2/betting", {
    request_id: params.requestId,
    customer_id: params.customerId,
    service_id: serviceId,
    amount: params.amount,
  });
}

// ─── Webhook signature verification ─────────────────────────
export function verifyWebhookSignature(body: string, signature: string): boolean {
  const expected = crypto
    .createHmac("sha256", env.VTU_USER_PIN)
    .update(body)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
