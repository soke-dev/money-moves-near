/**
 * ton.ts — The Open Network: addresses, balances, deposits, and gasless sends.
 *
 * TON is neither EVM nor Solana and the differences are not cosmetic.
 *
 * ── An address is a contract, not a key ──────────────────────────────
 *
 * Everywhere else we run, an address is a function of the key alone. On TON it
 * is a function of the key AND the wallet program, so one key has a different
 * address under every wallet version - v3R2, v4R2, v5R1 are three addresses
 * for the same person. We always use v5R1 ("W5"), and nothing here may ever
 * quietly fall back to another version: that would be a different wallet, and
 * money sent to it would sit somewhere the app is not looking.
 *
 * W5 is not an arbitrary preference. It is the only version that accepts a
 * request relayed by somebody else, which is what makes the gasless path below
 * possible at all.
 *
 * ── The key is the Solana key ────────────────────────────────────────
 *
 * TON signs with Ed25519, and so does Solana, and Dynamic gives us one Ed25519
 * wallet. So a user's TON address is derived from their Solana public key,
 * exactly as their Movement address already is. No second wallet, no change to
 * the Dynamic project, and nothing new in the app bundle - the address is
 * computed here on the server from the Solana address we already store.
 *
 * The cost of that choice: there is no 24-word phrase for the TON wallet,
 * because the key did not come from one, and TON's mnemonic scheme is not the
 * BIP39 one our legacy wallets use anyway. Movement has the same property.
 *
 * ── Nobody needs TON coin ────────────────────────────────────────────
 *
 * A jetton transfer normally needs the sender to hold TON for gas. W5 can
 * instead sign a request that a relay carries, paying the gas itself and
 * taking its fee in the jetton being moved. Measured against the live relay:
 * a flat 0.006 USDT per transfer, whatever the size, and the same whether or
 * not the recipient has ever held USDT.
 *
 * Which means our users never hold TON, we never run a gas wallet for this
 * chain, and there is no equivalent of the Solana rent-farming that emptied
 * the fee payer in September.
 *
 * USDT only. USDC is not issued on TON - Circle's 38 native chains do not
 * include it, and the bridged jUSDC has about $56k of supply chain-wide.
 */
import { PublicKey } from "@solana/web3.js";
import {
  Address,
  Cell,
  beginCell,
  external,
  internal,
  storeMessage,
  type MessageRelaxed,
} from "@ton/core";
import { WalletContractV5R1 } from "@ton/ton";
import { env } from "../config/env";

// ─── Constants ──────────────────────────────────────────────

/** Tether USD on TON. The only jetton we list here. */
export const TON_USDT_MASTER =
  "0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe";

/** USDT on TON carries six decimals, like USDT everywhere else. */
export const TON_USDT_DECIMALS = 6;

/** The jetton-transfer opcode, TEP-74. */
const OP_JETTON_TRANSFER = 0x0f8a7ea5;

/**
 * Held back from a send so the relay can be paid.
 *
 * The relay takes its fee in USDT out of the same signed request, so a user
 * sending their entire balance leaves nothing to pay it with and the transfer
 * simply fails. Measured commission is 0.006; this is generous against it
 * because the figure is TON gas priced in USDT and moves with the TON price.
 *
 * Applied ONCE, at quote time, exactly like Arc's gas reserve - see
 * netOfTonFee below and the comment on ARC_SWEEP_RESERVE in sweep.ts. The
 * trap is subtracting again at send, which quotes one number and moves
 * another.
 */
export const TON_FEE_RESERVE = 0.02;

/** What a balance can actually be sent, once the relay's fee is accounted for. */
export function netOfTonFee(balance: number): number {
  const left = balance - TON_FEE_RESERVE;
  // Floored to the stored precision so the figure offered can never round up
  // past what the chain will let go.
  return left > 0 ? Math.floor(left * 1e8) / 1e8 : 0;
}

// ─── The API ────────────────────────────────────────────────

const TONAPI = () => env.TONAPI_BASE_URL.replace(/\/+$/, "");

/**
 * One request at a time, no faster than the plan allows.
 *
 * TonAPI's free tier is one request per second, and going over it does not
 * return 429 - it drops the connection or hands back an empty body, which
 * reads as "this account holds nothing". A rate limit that looks like a zero
 * balance is worse than one that looks like an error, and worse still on the
 * send path, where the relay's estimate and broadcast run through the very
 * same budget: get throttled mid-send and the transfer fails rather than the
 * screen looking stale.
 *
 * So requests queue instead of racing. Everything here is either a background
 * sync, where a second's wait is invisible, or a send, where three seconds of
 * queueing beats a failure. The gap is the whole reason the caches below
 * exist - each one removes a request from this queue.
 *
 * TONAPI_RPS is the escape hatch: raise it the day the plan is upgraded and
 * nothing else has to change.
 */
const MIN_GAP_MS = () => Math.ceil(1000 / Math.max(0.2, env.TONAPI_RPS));
let queue: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

function throttle<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    const wait = lastCallAt + MIN_GAP_MS() - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    return run();
  });
  // The queue must keep moving even when a call rejects, or one failure
  // deadlocks every TON request for the life of the process.
  queue = next.catch(() => {});
  return next;
}

/**
 * A call to TonAPI, throttled and retried.
 *
 * An empty body is treated as a failure worth retrying rather than as valid
 * JSON, because that is what being over the limit looks like.
 */
async function tonApi<T = any>(
  path: string,
  init?: RequestInit,
  tries = 3,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) || {}),
  };
  if (env.TONAPI_KEY) headers.Authorization = `Bearer ${env.TONAPI_KEY}`;

  let lastErr: any = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await throttle(() => fetch(`${TONAPI()}${path}`, { ...init, headers }));
      const text = await res.text();
      if (!res.ok) {
        let detail = text.slice(0, 300);
        try {
          detail = JSON.parse(text).error ?? detail;
        } catch {}
        // A bad request will be bad again; only server-side and empty
        // responses are worth another go.
        if (res.status >= 400 && res.status < 500) {
          throw new Error(`TonAPI ${res.status}: ${detail}`);
        }
        lastErr = new Error(`TonAPI ${res.status}: ${detail}`);
      } else if (text.trim()) {
        return JSON.parse(text) as T;
      } else {
        lastErr = new Error("TonAPI returned an empty body");
      }
    } catch (err: any) {
      if (/TonAPI 4\d\d/.test(err?.message || "")) throw err;
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw lastErr ?? new Error("TonAPI unreachable");
}

// ─── Addresses ──────────────────────────────────────────────

/**
 * The W5 wallet for an Ed25519 public key.
 *
 * Non-bounceable form (UQ...) because that is what a wallet address is shown
 * as, and because coin sent to a bounceable address that has not been deployed
 * yet comes straight back to the sender. Our users' wallets are undeployed
 * until their first send, so bounceable would turn an ordinary first deposit
 * into a refund.
 */
export function tonAddressFromPublicKey(publicKey: Buffer): string {
  const wallet = WalletContractV5R1.create({ workchain: 0, publicKey });
  return wallet.address.toString({ bounceable: false, urlSafe: true });
}

/** The same, starting from the Solana address we already store for this user. */
export function tonAddressFromSolana(solanaAddress: string): string {
  const publicKey = Buffer.from(new PublicKey(solanaAddress).toBytes());
  return tonAddressFromPublicKey(publicKey);
}

/** The Ed25519 public key behind a Solana address, as TON wants it. */
export function publicKeyFromSolana(solanaAddress: string): Buffer {
  return Buffer.from(new PublicKey(solanaAddress).toBytes());
}

/**
 * Parse any of the forms a TON address is written in, or null.
 *
 * Accepts the friendly base64 forms (EQ... bounceable, UQ... not) and the raw
 * `0:<64 hex>`. All three name the same account; only the flags differ.
 */
export function parseTonAddress(value: string): Address | null {
  const s = (value || "").trim();
  if (!s) return null;
  try {
    return Address.parse(s);
  } catch {
    return null;
  }
}

export function isValidTonAddress(value: string): boolean {
  return parseTonAddress(value) !== null;
}

/** Two written forms of the same account compare equal. */
export function sameTonAddress(a: string, b: string): boolean {
  const x = parseTonAddress(a);
  const y = parseTonAddress(b);
  return !!x && !!y && x.equals(y);
}

/** The canonical form we store and display. */
export function normaliseTonAddress(value: string): string | null {
  const a = parseTonAddress(value);
  return a ? a.toString({ bounceable: false, urlSafe: true }) : null;
}

// ─── Balances ───────────────────────────────────────────────

/**
 * Somebody's USDT, as a decimal figure.
 *
 * Zero when the account has never held any: TonAPI reports no jetton wallet
 * rather than a zero balance, and an account with no history 404s outright.
 * Neither is an error worth surfacing - both mean nought.
 */
/**
 * Recently-read balances, for the refresh path only.
 *
 * A background sync asking the same question twice inside half a minute is
 * pure waste at one request a second, and several people opening the app at
 * once otherwise queue behind each other.
 *
 * Deliberately opt-in per caller rather than always on. A sync may read a
 * balance thirty seconds stale - the worst case is a deposit shown a moment
 * late. A send may not: it checks the balance to decide whether the transfer
 * can go at all, and deciding that from a cached figure is how somebody is
 * told they have money they have already spent. Callers on the send path pass
 * no maxAge and always hit the chain.
 */
const balanceCache = new Map<string, { at: number; value: number }>();
export const TON_BALANCE_TTL_MS = 30_000;

export async function getTonUsdtBalance(
  owner: string,
  maxAgeMs = 0,
): Promise<number> {
  const addr = parseTonAddress(owner);
  if (!addr) return 0;
  const key = addr.toRawString();

  if (maxAgeMs > 0) {
    const hit = balanceCache.get(key);
    if (hit && Date.now() - hit.at < maxAgeMs) return hit.value;
  }

  try {
    const res = await tonApi<{ balance?: string }>(
      `/v2/accounts/${key}/jettons/${TON_USDT_MASTER}`,
    );
    const raw = BigInt(res?.balance ?? "0");
    const value = Number(raw) / 10 ** TON_USDT_DECIMALS;
    balanceCache.set(key, { at: Date.now(), value });
    return value;
  } catch (err: any) {
    if (/TonAPI 404/.test(err?.message || "")) {
      balanceCache.set(key, { at: Date.now(), value: 0 });
      return 0;
    }
    throw err;
  }
}

/**
 * Native TON, which our users are not expected to have any of.
 *
 * Here for diagnostics and for the admin console rather than for the app: the
 * whole point of the gasless path is that this figure stays at zero and
 * nothing depends on it.
 */
export async function getTonBalance(owner: string): Promise<number> {
  const addr = parseTonAddress(owner);
  if (!addr) return 0;
  try {
    const res = await tonApi<{ balance?: number }>(
      `/v2/accounts/${addr.toRawString()}`,
    );
    return Number(res?.balance ?? 0) / 1e9;
  } catch (err: any) {
    if (/TonAPI 404/.test(err?.message || "")) return 0;
    throw err;
  }
}

/** The jetton wallet that holds this owner's USDT. */
export async function jettonWalletFor(owner: string): Promise<string | null> {
  const addr = parseTonAddress(owner);
  if (!addr) return null;
  try {
    const res = await tonApi<{ wallet_address?: { address?: string } }>(
      `/v2/accounts/${addr.toRawString()}/jettons/${TON_USDT_MASTER}`,
    );
    return res?.wallet_address?.address ?? null;
  } catch (err: any) {
    if (/TonAPI 404/.test(err?.message || "")) return null;
    throw err;
  }
}

/**
 * The jetton wallet an owner WOULD have, whether or not it exists yet.
 *
 * Asked of the master contract rather than of the account, because the account
 * route only answers for wallets that already hold something and a first send
 * has to name an address that does not exist yet.
 */
/**
 * Cached for the life of the process, and safe to be.
 *
 * A jetton wallet's address is a pure function of its owner and the jetton
 * master - the same inputs give the same answer for ever, whether or not the
 * contract has been deployed yet. So this is arithmetic we are asking a server
 * to do, and asking twice is waste we cannot afford at one request a second.
 */
const jettonWalletCache = new Map<string, string>();

export async function derivedJettonWallet(owner: string): Promise<string> {
  const addr = parseTonAddress(owner);
  if (!addr) throw new Error("Invalid TON address");
  const key = addr.toRawString();

  const cached = jettonWalletCache.get(key);
  if (cached) return cached;

  const res = await tonApi<{
    decoded?: { jetton_wallet_address?: string };
    stack?: Array<{ cell?: string }>;
  }>(
    `/v2/blockchain/accounts/${TON_USDT_MASTER}/methods/get_wallet_address` +
      `?args=${encodeURIComponent(key)}`,
  );
  const found = res?.decoded?.jetton_wallet_address ?? res?.stack?.[0]?.cell;
  if (!found) throw new Error("Could not resolve the jetton wallet for this address");
  jettonWalletCache.set(key, found);
  return found;
}

// ─── Deposits ───────────────────────────────────────────────

export interface TonDeposit {
  amount: number;
  txHash: string;
  from: string | null;
  at: Date;
}

/**
 * The most recent USDT to arrive at an address, if any.
 *
 * Reads the account's own events rather than scanning the chain, which is the
 * only practical way round here: TON has no log filter to sweep and a jetton
 * arrival is several transactions that only an indexer reassembles into one
 * "somebody was paid" event.
 *
 * Only incoming transfers count. A JettonTransfer event fires for both
 * directions and the recipient field is what tells them apart - without that
 * check a user's own withdrawal reads back as a deposit.
 */
export async function findTonDeposit(
  address: string,
  since?: Date,
): Promise<TonDeposit | null> {
  const addr = parseTonAddress(address);
  if (!addr) return null;

  let res: any;
  try {
    res = await tonApi(`/v2/accounts/${addr.toRawString()}/events?limit=20`);
  } catch (err: any) {
    if (/TonAPI 404/.test(err?.message || "")) return null;
    throw err;
  }

  for (const event of res?.events ?? []) {
    const at = new Date(Number(event?.timestamp ?? 0) * 1000);
    if (since && at < since) continue;

    for (const action of event?.actions ?? []) {
      if (action?.type !== "JettonTransfer") continue;
      const t = action.JettonTransfer;
      if (!t) continue;

      // Ours, and the right token, and inbound.
      const master = t?.jetton?.address;
      if (master !== TON_USDT_MASTER) continue;
      const recipient = t?.recipient?.address;
      if (!recipient || !parseTonAddress(recipient)?.equals(addr)) continue;

      const decimals = Number(t?.jetton?.decimals ?? TON_USDT_DECIMALS);
      const amount = Number(BigInt(t?.amount ?? "0")) / 10 ** decimals;
      if (!(amount > 0)) continue;

      return {
        amount,
        txHash: String(event?.event_id ?? ""),
        from: t?.sender?.address ?? null,
        at,
      };
    }
  }
  return null;
}

// ─── The gasless relay ──────────────────────────────────────

export interface GaslessConfig {
  relay_address: string;
  gas_jettons: Array<{ master_id: string }>;
}

let configCache: { at: number; value: GaslessConfig } | null = null;

/**
 * Who the relay is, and what it will accept as payment.
 *
 * Cached for five minutes. It changes about never, and every send needs it.
 */
export async function gaslessConfig(): Promise<GaslessConfig> {
  if (configCache && Date.now() - configCache.at < 5 * 60_000) {
    return configCache.value;
  }
  const value = await tonApi<GaslessConfig>("/v2/gasless/config");
  configCache = { at: Date.now(), value };
  return value;
}

/**
 * Whether the relay will still take USDT as its fee.
 *
 * Deliberately does NOT swallow a failed lookup. It used to, and a rate limit
 * or a dropped connection then surfaced to the user as "the relay is not
 * accepting USDT right now" - which describes a chain that has stopped
 * supporting us rather than a request that needs retrying, and sent me
 * looking in the wrong place for half an hour. A config we could not read is
 * not the same fact as a config that says no.
 */
export async function gaslessSupportsUsdt(): Promise<boolean> {
  const cfg = await gaslessConfig();
  return (cfg.gas_jettons ?? []).some((j) => j.master_id === TON_USDT_MASTER);
}

export interface GaslessEstimate {
  relay_address: string;
  commission: string;
  from: string;
  valid_until: number;
  messages: Array<{ address: string; amount: string; payload: string }>;
}

/**
 * Ask the relay what it would charge, and what to sign.
 *
 * What comes back is not advice - those messages ARE the transfer. The relay
 * rewrites the one we propose into two, the transfer itself and its own fee,
 * and signing anything else means signing something it will not carry.
 */
export async function estimateGasless(
  walletAddress: string,
  walletPublicKey: Buffer,
  message: Cell,
): Promise<GaslessEstimate> {
  const addr = parseTonAddress(walletAddress);
  if (!addr) throw new Error("Invalid TON address");
  return tonApi<GaslessEstimate>(`/v2/gasless/estimate/${TON_USDT_MASTER}`, {
    method: "POST",
    body: JSON.stringify({
      wallet_address: addr.toRawString(),
      wallet_public_key: walletPublicKey.toString("hex"),
      // Hex, not base64. The relay rejects base64 with a hex parse error that
      // names a character rather than the encoding, which is a slow half hour.
      messages: [{ boc: message.toBoc().toString("hex") }],
    }),
  });
}

/** Hand the signed external message to the relay to broadcast. */
export async function sendGasless(
  walletPublicKey: Buffer,
  boc: Cell,
): Promise<{ external?: string }> {
  return tonApi<{ external?: string }>("/v2/gasless/send", {
    method: "POST",
    body: JSON.stringify({
      wallet_public_key: walletPublicKey.toString("hex"),
      boc: boc.toBoc().toString("hex"),
    }),
  });
}

/** One event by id. Throws when the chain has never heard of it. */
export async function eventById(eventId: string): Promise<any> {
  return tonApi(`/v2/events/${eventId}`);
}

/** An account's recent events, newest first. */
export async function accountEvents(owner: string, limit = 20): Promise<any[]> {
  const addr = parseTonAddress(owner);
  if (!addr) return [];
  const res = await tonApi<any>(
    `/v2/accounts/${addr.toRawString()}/events?limit=${limit}`,
  );
  return res?.events ?? [];
}

/**
 * The on-chain event a relayed send turned into.
 *
 * Needed because a gasless send leaves no on-chain trace of its own. What we
 * sign goes to the relay over HTTP, and the relay makes its OWN transaction
 * carrying our request inside it - so the hash of the envelope we built never
 * appears on the chain, and every explorer link built from it is a 404. That
 * is exactly what shipped.
 *
 * What does exist is an event on the sender's account with a GasRelay action
 * in it, and its id is what tonviewer and TonAPI both answer to. It takes a
 * few seconds to appear, so this is polled rather than asked once, and is
 * meant to run after the caller has already replied.
 *
 * Returns null rather than throwing when nothing turns up: the money has
 * moved either way, and a missing explorer link is not worth failing a
 * transfer over.
 */
/**
 * Events already handed to a caller as proof of a payment, with when.
 *
 * Two requests signed against the same seqno are both accepted by the relay,
 * but only one can execute - and both waiters then see that one event, of the
 * right amount to the right place. Without this, a sell and a second sell
 * prepared while the first was still landing were both paid for one transfer.
 * JavaScript runs this check and the claim with nothing in between, so within
 * this process an event is handed out once.
 */
const claimedEvents = new Map<string, number>();
const CLAIM_KEEP_MS = 6 * 3_600_000;

export async function findRelayedEvent(
  owner: string,
  sinceUnix: number,
  expect?: { units: bigint; destination: Address },
  attempts = 6,
  /** Already used by another transaction, as far as the database knows. */
  usedElsewhere?: (eventId: string) => Promise<boolean>,
): Promise<string | null> {
  const addr = parseTonAddress(owner);
  if (!addr) return null;
  for (const [id, at] of claimedEvents) if (Date.now() - at > CLAIM_KEEP_MS) claimedEvents.delete(id);

  for (let i = 0; i < attempts; i++) {
    // Generous first wait: the relay batches, and asking immediately only
    // spends a request from a one-per-second budget to be told nothing yet.
    await new Promise((r) => setTimeout(r, i === 0 ? 5000 : 4000));
    try {
      const res = await tonApi<any>(
        `/v2/accounts/${addr.toRawString()}/events?limit=5`,
      );
      for (const event of res?.events ?? []) {
        if (Number(event?.timestamp ?? 0) < sinceUnix) continue;
        const actions = event?.actions ?? [];
        if (!actions.some((a: any) => a?.type === "GasRelay")) continue;

        /**
         * When the caller says what it expects, the event has to contain it.
         *
         * A relayed send produces two jetton transfers: the one that was
         * asked for and the relay's own fee. Matching on "an event happened"
         * would accept the fee leg alone, or somebody else's transfer landing
         * in the same window. What proves the money moved is a transfer of
         * the right size to the right place.
         */
        if (expect) {
          const moved = actions.some((a: any) => {
            const jt = a?.JettonTransfer;
            // A transfer that bounced is listed too, marked failed: it moved nothing.
            if (a?.status && a.status !== "ok") return false;
            if (!jt || jt?.jetton?.address !== TON_USDT_MASTER) return false;
            const to = jt?.recipient?.address;
            if (!to || !parseTonAddress(to)?.equals(expect.destination)) return false;
            try {
              return BigInt(jt.amount ?? "0") === expect.units;
            } catch {
              return false;
            }
          });
          if (!moved) continue;
        }

        if (!event?.event_id) continue;
        const id = String(event.event_id);
        if (expect) {
          if (claimedEvents.has(id)) continue;
          claimedEvents.set(id, Date.now());
          // Unsure counts as used: a transfer left waiting for a person beats one paid twice.
          if (usedElsewhere && (await usedElsewhere(id).catch(() => true))) continue;
        }
        return id;
      }
    } catch {
      // Rate limited, or the indexer is behind. Try again.
    }
  }
  return null;
}

// ─── Building a transfer ────────────────────────────────────

/**
 * The body of a jetton transfer, TEP-74.
 *
 * `responseDestination` is where unspent gas goes, and on the gasless path it
 * MUST be the relay. A transfer attaches more TON than it burns; name the
 * relay and it gets its own float back and charges only what was consumed,
 * name anyone else and it charges for the whole attachment. Measured, same
 * transfer either way: 0.006 USDT against 0.168. Nothing errors if this is
 * wrong - the fee is just twenty-eight times larger, for ever.
 */
export function jettonTransferBody(args: {
  amount: bigint;
  destination: Address;
  responseDestination: Address;
  forwardTonAmount?: bigint;
  queryId?: bigint;
}): Cell {
  return beginCell()
    .storeUint(OP_JETTON_TRANSFER, 32)
    .storeUint(args.queryId ?? 0n, 64)
    .storeCoins(args.amount)
    .storeAddress(args.destination)
    .storeAddress(args.responseDestination)
    .storeMaybeRef(null) // custom_payload
    .storeCoins(args.forwardTonAmount ?? 1n)
    .storeMaybeRef(null) // forward_payload
    .endCell();
}

/** What a jetton transfer body says, read back out of it. */
export function readJettonTransfer(
  body: Cell,
): { amount: bigint; destination: Address } | null {
  try {
    const sl = body.beginParse();
    if (sl.loadUint(32) !== OP_JETTON_TRANSFER) return null;
    sl.loadUintBig(64); // query_id
    const amount = sl.loadCoins();
    const destination = sl.loadAddress();
    return { amount, destination };
  } catch {
    return null;
  }
}

/**
 * The estimate's messages, checked before they are handed over to be signed.
 *
 * This is the one place a third party writes something our user will sign.
 * We propose one transfer; the relay hands back two - ours, and its own fee -
 * and whatever comes back is what the wallet authorises. Signing it because
 * it arrived from the right URL would mean a relay bug, or a relay taken
 * over, could return "send your whole balance to me" and be obeyed.
 *
 * So each message is read back: a jetton transfer, to either the intended
 * recipient for exactly the intended amount, or to the relay for no more
 * than the cap. Anything else and nothing gets signed.
 *
 * The cap is the same figure held back from the balance in the first place,
 * which gives the invariant worth having: what leaves is never more than the
 * amount chosen plus the reserve that was already subtracted from it.
 */
export function messagesFromEstimate(
  estimate: GaslessEstimate,
  expect: { units: bigint; destination: Address; relay: Address },
): MessageRelaxed[] {
  const capUnits = BigInt(Math.round(TON_FEE_RESERVE * 10 ** TON_USDT_DECIMALS));
  let sawTransfer = false;
  let feeTotal = 0n;

  const messages = estimate.messages.map((m) => {
    const body = Cell.fromBoc(Buffer.from(m.payload, "hex"))[0];
    const parsed = readJettonTransfer(body);
    if (!parsed) {
      throw new Error("The relay returned something that is not a jetton transfer");
    }

    if (parsed.destination.equals(expect.destination) && parsed.amount === expect.units) {
      if (sawTransfer) throw new Error("The relay duplicated the transfer");
      sawTransfer = true;
    } else if (parsed.destination.equals(expect.relay)) {
      feeTotal += parsed.amount;
    } else {
      throw new Error(
        `The relay tried to send ${parsed.amount} to ${parsed.destination.toString()}`,
      );
    }

    return internal({
      to: Address.parse(m.address),
      value: BigInt(m.amount),
      bounce: true,
      body,
    });
  });

  if (!sawTransfer) {
    throw new Error("The relay dropped the transfer we asked for");
  }
  if (feeTotal > capUnits) {
    throw new Error(
      `The TON relay is asking ${Number(feeTotal) / 10 ** TON_USDT_DECIMALS} USDT to carry ` +
        `this, which is more than the ${TON_FEE_RESERVE} held back for it. Try again later.`,
    );
  }
  return messages;
}

/**
 * Wrap a signed W5 request in the envelope the relay expects.
 *
 * `init` is the wallet's code and data, and is required on a first send: the
 * account does not exist until something deploys it, and on TON that is
 * whichever message arrives first carrying its state. Leave it out and a
 * brand-new user's first withdrawal fails against an address with no contract
 * at it.
 */
export function wrapForRelay(
  walletAddress: Address,
  signedBody: Cell,
  init?: { code: Cell; data: Cell } | null,
): Cell {
  return beginCell()
    .storeWritable(
      storeMessage(
        external({
          to: walletAddress,
          init: init ?? undefined,
          body: signedBody,
        }),
      ),
    )
    .endCell();
}

/** The wallet contract for a user, which is how we get at seqno and init. */
export function walletFor(publicKey: Buffer): WalletContractV5R1 {
  return WalletContractV5R1.create({ workchain: 0, publicKey });
}

/**
 * The wallet's sequence number, which also says whether it has been deployed.
 *
 * Seqno zero means the wallet has never sent anything, and a W5 wallet is
 * deployed by its own first outgoing message - so zero and "needs state init"
 * are the same fact. This is what Tonkeeper's own gasless example does
 * (`init: seqno === 0 ? contract.init : undefined`), and it is why there is
 * no separate deployed flag: there was one, it asked a second endpoint, and
 * it was WRONG. /v2/wallet/{id}/seqno answers 200 with {"seqno":0} for an
 * account that does not exist rather than 404ing, so "it did not 404" proved
 * nothing and every brand-new wallet was treated as already deployed - which
 * drops the state init from its first send and guarantees that send fails.
 *
 * Receiving USDT does not deploy the wallet. It deploys the JETTON wallet,
 * which is a different contract; the W5 itself stays uninitialised until it
 * sends. So every user's first send is this case, not an edge one.
 *
 * Errors are not swallowed. Guessing zero after a timeout would attach state
 * init to an already-deployed wallet, which refuses it.
 */
export async function getSeqno(address: string): Promise<number> {
  const addr = parseTonAddress(address);
  if (!addr) return 0;
  const res = await tonApi<{ seqno?: number }>(
    `/v2/wallet/${addr.toRawString()}/seqno`,
  );
  const n = Number(res?.seqno);
  return Number.isFinite(n) ? n : 0;
}
