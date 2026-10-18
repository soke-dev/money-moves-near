import { env } from "../config/env";

/**
 * Stableyard — routed deposits.
 *
 * Users receive BTC, Tron USDT and Ethereum assets into reusable deposit
 * addresses, and all of it settles as USDCx on Movement. Chains we already
 * accept natively never come through here.
 *
 * Two things about this integration are worth knowing before reading further.
 *
 * There is no staging. The credential is production-only, so every call in
 * this file is real, and anything that creates a UPA, a wallet link or a
 * deposit address is a live write against a real person's account.
 *
 * And their Movement USDC is byte-for-byte our USDCx
 * (0xba11833544a2f99eec743f41a228ca6ffa7f13c3b6b04681d5a79a8b75ff225e), which
 * is what makes the whole design work: what they settle is what we already
 * credit, with no bridging or wrapping of our own.
 */

export const SY_CHAIN = {
  BITCOIN: 10001,
  TRON: 728126428,
  ETHEREUM: 1,
  /** Where everything lands. USDC here is our USDCx. */
  MOVEMENT: 10002,
} as const;

export const SY_SETTLEMENT_ASSET = "USDC";

/**
 * What can arrive, and what the app admits to.
 *
 * Support and visibility are separate on purpose. Issuing a deposit address
 * costs nothing and can be done long before a button exists, so the chains
 * here are the ones we want working; `visible` is the much smaller set the app
 * offers today. Turning one on later is a flag, not a deployment of new
 * plumbing to a user who has already been sent an address.
 *
 * ── The thing to understand before adding to this ──────────────────────
 *
 * A deposit address belongs to a CHAIN, not a token. Stableyard's words: "a
 * request chooses a chain, not a token-specific address". So a Solana address
 * accepts SOL and USDC and USDT whatever this table says, and a BNB address
 * accepts BNB and both stablecoins.
 *
 * That collides with the two chains where we already take USDC and USDT into
 * the user's own wallet. It is survivable only because the app keeps them
 * apart: stablecoins have their own deposit screens showing the user's native
 * address, and these live under "other crypto" with their own instructions and
 * a different address. Someone who pastes the wrong one converts a stablecoin
 * they meant to keep - which is why the two screens must never look alike.
 *
 * Minimums are deliberately absent. They are read from the server per address;
 * the published table said Tron USDT was "greater than 3" when the live figure
 * was 100, and it has moved twice since.
 */
export type RoutedAsset = {
  chainId: number;
  symbol: string;
  /** Whether the app offers it today. Everything here works regardless. */
  visible: boolean;
};

export const SY_ROUTED_ASSETS: readonly RoutedAsset[] = [
  // Live in the app now.
  { chainId: 10001, symbol: "BTC", visible: true },
  { chainId: 728126428, symbol: "USDT", visible: true },
  { chainId: 1, symbol: "USDC", visible: true },
  { chainId: 1, symbol: "USDT", visible: true },
  { chainId: 56, symbol: "BNB", visible: true },
  { chainId: 10103, symbol: "SOL", visible: true },

  // Working, but no button yet.
  { chainId: 1, symbol: "ETH", visible: false },
  { chainId: 42161, symbol: "USDC", visible: false },
  { chainId: 42161, symbol: "USDT", visible: false },
  { chainId: 42161, symbol: "ETH", visible: false },
  { chainId: 137, symbol: "USDC", visible: false },
  { chainId: 137, symbol: "USDT", visible: false },
  { chainId: 137, symbol: "POL", visible: false },
  { chainId: 4663, symbol: "USDG", visible: false },
];

/** Every chain we need an address on, visible or not. */
export const SY_DEPOSIT_CHAINS: number[] = [
  ...new Set(SY_ROUTED_ASSETS.map((a) => a.chainId)),
];

/** What the app should draw. The server decides, not the client. */
export function visibleRoutedAssets(): RoutedAsset[] {
  return SY_ROUTED_ASSETS.filter((a) => a.visible);
}

export function isStableyardConfigured(): boolean {
  return !!(env.STABLEYARD_APP_ID && env.STABLEYARD_APP_SECRET);
}

function authHeader(): string {
  return (
    "Basic " +
    Buffer.from(`${env.STABLEYARD_APP_ID}:${env.STABLEYARD_APP_SECRET}`).toString("base64")
  );
}

export type SyResult<T> = { ok: boolean; status: number; data: T | null; error?: string };

/**
 * How long to wait for Stableyard before giving up.
 *
 * A call normally answers in well under a second. There was no limit at all,
 * so when their server stopped answering, every call sat for the ~100 seconds
 * Cloudflare waits before returning a 524 - the deposit screens spun for over
 * a minute and the background sweeps stacked up behind each other.
 */
const SY_TIMEOUT_MS = 15_000;

/**
 * Failures in a row, across every caller: timeouts, network errors and 5xx.
 * Any answer below 500 means their server is up, and resets it.
 *
 * The sweeps read it to stop a pass early when the provider is plainly down,
 * rather than walking every enrolled account into the same wall.
 */
let failureStreak = 0;
export function syFailureStreak(): number {
  return failureStreak;
}

/**
 * One line a person can read, never an HTML page.
 *
 * Cloudflare answers for Stableyard when their origin is down, with a whole
 * error document; logged raw it came out as a dozen log lines of markup per
 * failure. Its 52x codes each mean one specific thing, so they are named.
 */
const CLOUDFLARE: Record<number, string> = {
  520: "origin returned an unknown error",
  521: "origin is down",
  522: "connection to origin timed out",
  523: "origin unreachable",
  524: "origin took too long to answer",
};

function errorSummary(status: number, parsed: any, text: string): string {
  const fromJson = parsed?.error?.message || parsed?.message;
  if (fromJson) return String(fromJson).replace(/\s+/g, " ").slice(0, 300);
  if (/^\s*</.test(text)) {
    return CLOUDFLARE[status] ? `Cloudflare ${status}: ${CLOUDFLARE[status]}` : `HTML error page (HTTP ${status})`;
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 300) || `HTTP ${status}`;
}

/**
 * One request, with the idempotency key where they want it.
 *
 * Their docs are firm that creates are not idempotent without it and that
 * replaying the same key with changed data is a conflict rather than an
 * update - so the key is always derived from something stable about the
 * subject, never from the clock.
 */
export async function sy<T = any>(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<SyResult<T>> {
  const base = env.STABLEYARD_BASE_URL.replace(/\/$/, "");
  const headers: Record<string, string> = {
    Authorization: authHeader(),
    "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // Covers reading the body too, not only the headers arriving.
      signal: AbortSignal.timeout(SY_TIMEOUT_MS),
    });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    failureStreak = res.status >= 500 ? failureStreak + 1 : 0;

    if (!res.ok) {
      const message = errorSummary(res.status, parsed, text);
      console.error(`[SY] ${method} ${path} -> ${res.status} ${message}`);
      return { ok: false, status: res.status, data: null, error: message };
    }

    return { ok: true, status: res.status, data: (parsed?.data ?? parsed) as T };
  } catch (err: any) {
    failureStreak++;
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    const message = timedOut ? `no answer within ${SY_TIMEOUT_MS / 1000}s` : err?.message || "request failed";
    console.error(`[SY] ${method} ${path} ${timedOut ? "timed out" : "threw"}: ${message}`);
    return { ok: false, status: 0, data: null, error: message };
  }
}

/* ─── The four steps, in the order their team gave them ─────────────── */

/** A UPA per Money Moves user, keyed on our own id so it cannot be doubled. */
export function createAccount(externalUserId: string) {
  // Wrapped as { account, connectedWallets } rather than the account itself.
  return sy<{ account: { id: string; status: string } }>(
    "POST",
    "/v2/accounts",
    { externalUserId, subjectType: "individual" },
    `upa-${externalUserId}`,
  );
}

/**
 * Look a UPA up by our own user id.
 *
 * A path segment, not a query - /v2/accounts?externalUserId= is not a route
 * and answers "Cannot GET", and there is no collection endpoint to list them.
 */
export function getAccountByExternalId(externalUserId: string) {
  return sy<any>("GET", `/v2/accounts/external/${encodeURIComponent(externalUserId)}`);
}

/**
 * Their Movement wallet becomes the settlement destination. No signature
 * needed - an address and a chain id is the whole contract.
 *
 * Address and chainId only. Stableyard's own integration note includes
 * `label` and `isPreferredSettlement: true` on this call, and sending them
 * returns a 500 - not a validation error, a server fault. Without them it
 * succeeds and creates the settlement profile by itself, which is what those
 * fields were presumably meant to do.
 */
export function linkMovementWallet(accountId: string, address: string) {
  return sy<any>("POST", `/v2/accounts/${accountId}/wallets`, {
    wallets: [{ address, chainId: SY_CHAIN.MOVEMENT }],
  });
}

export function listSettlementDestinations(accountId: string) {
  return sy<any>(
    "GET",
    `/v2/accounts/${accountId}/settlement-destinations?type=crypto_wallet&status=active`,
  );
}

export function setSettlementProfile(accountId: string, settlementDestinationId: string) {
  return sy<any>("PUT", `/v2/accounts/${accountId}/settlement-profile`, {
    settlementDestinationId,
    assetSymbol: SY_SETTLEMENT_ASSET,
  });
}

/**
 * One address per chain, not per token.
 *
 * A Bitcoin address only ever receives BTC and a Tron one only USDT, so these
 * two are unambiguous. Ethereum would also catch USDC, USDT and native ETH on
 * the same address, which is fine - all of it routes to the same place.
 */
export function createDepositAddresses(accountId: string, chainIds: number[]) {
  return sy<any>(
    "POST",
    `/v2/accounts/${accountId}/deposit-addresses`,
    { chainIds },
    `dep-${accountId}-${chainIds.join("-")}`,
  );
}

export function listDepositAddresses(accountId: string) {
  return sy<any>("GET", `/v2/accounts/${accountId}/deposit-addresses`);
}

export function listDeposits(accountId: string) {
  return sy<any>("GET", `/v2/accounts/${accountId}/deposits`);
}
