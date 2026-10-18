/**
 * Stellar, for Money Moves Business: where customers pay USDC and USDT (USD₮0)
 * on Stellar, and where crypto can settle.
 *
 * Stellar signs with Ed25519, as Solana does, so the float's Solana key is
 * also its Stellar key - the same 32 public-key bytes in Stellar's encoding,
 * the way the app gives its users a Stellar address. Customers pay that
 * account (or TREASURY_STELLAR_ADDRESS when set) with a memo naming their
 * payment; settlements on Stellar are paid from it.
 *
 * An account must be opened (funded with XLM) before it can hold anything, and
 * needs a trustline per coin. Once ours is open, the trustlines it lacks are
 * added by itself (when it's the float's own account, which we can sign for).
 * Until then Stellar isn't offered live, and the admin console says why.
 */
import { Asset, BASE_FEE, Horizon, Keypair, Memo, Networks, Operation, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import bs58 from "bs58";
import { env } from "../config/env";
import { log } from "./log";

export type StellarCoin = "USDC" | "USDT";

const HORIZON = () => env.STELLAR_HORIZON_URL ?? "https://horizon.stellar.org";
export const horizon = () => new Horizon.Server(HORIZON());

/** Circle's USDC, and Tether's USD₮0 - the issuers the app lists, verified against the network. */
const ISSUERS: Record<StellarCoin, string> = {
  USDC: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  USDT: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
};
const CODES: Record<StellarCoin, string> = { USDC: "USDC", USDT: "USDT0" };
export const stellarAsset = (coin: StellarCoin) => new Asset(CODES[coin], ISSUERS[coin]);
/** Which coin an asset on Stellar is, if it's one of ours. */
export function coinOfAsset(code?: string, issuer?: string): StellarCoin | null {
  for (const c of ["USDC", "USDT"] as StellarCoin[]) if (code === CODES[c] && issuer === ISSUERS[c]) return c;
  return null;
}

/** The float's key on Stellar: the first 32 bytes of its Solana secret are the Ed25519 seed. */
export function stellarFloat(): Keypair | null {
  if (!env.FLOAT_SOLANA_PRIVATE_KEY) return null;
  try {
    const secret = bs58.decode(env.FLOAT_SOLANA_PRIVATE_KEY);
    return Keypair.fromRawEd25519Seed(Buffer.from(secret.subarray(0, 32)));
  } catch {
    return null;
  }
}

/** Where customers pay on Stellar. */
export function stellarReceiveAddress(): string | null {
  return env.TREASURY_STELLAR_ADDRESS ?? stellarFloat()?.publicKey() ?? null;
}

/** A Solana address's Stellar twin: the same public key, Stellar's encoding. */
export function stellarFromSolana(solana: string): string | null {
  try {
    const raw = bs58.decode(solana);
    return raw.length === 32 ? StrKey.encodeEd25519PublicKey(Buffer.from(raw)) : null;
  } catch {
    return null;
  }
}

export const isStellarAddress = (v: string) => StrKey.isValidEd25519PublicKey(v);

/** Six decimals from Stellar's seven ("5.0000000" is 5000000). */
export function stellarMicros(amount: string): bigint {
  const [whole = "0", frac = ""] = String(amount).split(".");
  return BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
}
const toStellarAmount = (micros: bigint) => `${micros / 1_000_000n}.${(micros % 1_000_000n).toString().padStart(6, "0")}`;

// ─── Is it ready ──────────────────────────────────────────────────────────

type State = { address: string | null; open: boolean; trust: Record<StellarCoin, boolean>; xlm: number; at: number; why: string | null };
let state: State = { address: null, open: false, trust: { USDC: false, USDT: false }, xlm: 0, at: 0, why: "Checking the Stellar account." };

async function readAccount(address: string) {
  try {
    return await horizon().loadAccount(address);
  } catch (e) {
    if ((e as { response?: { status?: number } }).response?.status === 404) return null;
    throw e;
  }
}

const trustOf = (acct: Awaited<ReturnType<typeof readAccount>>) => {
  const t: Record<StellarCoin, boolean> = { USDC: false, USDT: false };
  for (const b of acct?.balances ?? []) {
    const c = "asset_code" in b ? coinOfAsset(b.asset_code, b.asset_issuer) : null;
    if (c) t[c] = true;
  }
  return t;
};

/** Adds the USDC and USDT0 trustlines the float's own account lacks, once it's open (2 XLM covers the account and both). */
async function trustFromFloat(float: Keypair, acct: NonNullable<Awaited<ReturnType<typeof readAccount>>>) {
  const missing = (["USDC", "USDT"] as StellarCoin[]).filter((c) => !trustOf(acct)[c]);
  if (!missing.length) return false;
  const tx = new TransactionBuilder(acct, { fee: String(Number(BASE_FEE) * 10), networkPassphrase: Networks.PUBLIC }).setTimeout(120);
  for (const c of missing) tx.addOperation(Operation.changeTrust({ asset: stellarAsset(c) }));
  const built = tx.build();
  built.sign(float);
  try {
    await horizon().submitTransaction(built);
    log.info("[stellar] trustlines added", { account: float.publicKey(), coins: missing });
    return true;
  } catch (e) {
    log.warn("[stellar] couldn't add trustlines, the account may need more XLM", { reason: resultOf(e) });
    return false;
  }
}

/**
 * Reads our receiving account, and adds any trustline the float's account
 * lacks - whether or not customers pay it - so USDC sent to top it up lands.
 * The worker calls this every few minutes; checkouts read the answer.
 */
export async function refreshStellar(): Promise<State> {
  const float = stellarFloat();
  // The float on its own, when customers pay somewhere else: it still needs its trustlines to hold USDC.
  if (float && float.publicKey() !== stellarReceiveAddress()) {
    const own = await readAccount(float.publicKey()).catch(() => null);
    if (own) await trustFromFloat(float, own);
  }
  const address = stellarReceiveAddress();
  if (!address) {
    state = { address: null, open: false, trust: { USDC: false, USDT: false }, xlm: 0, at: Date.now(), why: "Needs FLOAT_SOLANA_PRIVATE_KEY or TREASURY_STELLAR_ADDRESS set." };
    return state;
  }
  try {
    let acct = await readAccount(address);
    if (!acct) {
      state = { address, open: false, trust: { USDC: false, USDT: false }, xlm: 0, at: Date.now(), why: `The Stellar account isn't open yet. Send at least 3 XLM to ${address} to open it.` };
      return state;
    }
    let trust = trustOf(acct);
    if (float && float.publicKey() === address && (await trustFromFloat(float, acct))) {
      acct = (await readAccount(address)) ?? acct;
      trust = trustOf(acct);
    }
    const xlm = Number(acct.balances.find((b) => b.asset_type === "native")?.balance ?? 0);
    const ours = float?.publicKey() === address;
    const why = trust.USDC || trust.USDT ? null : ours ? `The Stellar account has no USDC or USDT trustline yet. Top ${address} up with XLM and it adds them by itself.` : `${address} needs USDC and USDT0 trustlines.`;
    state = { address, open: true, trust, xlm, at: Date.now(), why };
  } catch (e) {
    state = { ...state, address, at: Date.now(), why: state.open ? state.why : "Stellar couldn't be read just now." };
    log.warn("[stellar] couldn't read the account", { reason: e instanceof Error ? e.message : String(e) });
  }
  return state;
}

export const stellarState = () => state;
/** Why a coin can't be paid on Stellar right now, or null when it can. */
export function stellarWhy(coin?: StellarCoin): string | null {
  if (state.why) return state.why;
  if (coin && !state.trust[coin]) return `The Stellar account has no ${coin} trustline yet.`;
  return null;
}

function resultOf(e: unknown): string {
  const codes = (e as { response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } } }).response?.data?.extras?.result_codes;
  if (codes) return [codes.transaction, ...(codes.operations ?? [])].filter(Boolean).join(", ");
  return e instanceof Error ? e.message : String(e);
}

// ─── What arrived ─────────────────────────────────────────────────────────

export interface StellarPayment {
  id: string;
  coin: StellarCoin;
  micros: bigint;
  from: string;
  memo: string | null;
  tx: string;
  at: Date;
}

/**
 * Payments to our account after `cursor`, oldest first, with each one's memo.
 * Returns the cursor to carry on from.
 */
export async function stellarArrivals(cursor: string | null, since: Date): Promise<{ list: StellarPayment[]; cursor: string | null }> {
  const address = stellarReceiveAddress();
  if (!address) return { list: [], cursor };
  // The first look starts just before the oldest payment still watched: nothing earlier can be for it.
  if (!cursor) {
    const r = await fetch(`${HORIZON()}/accounts/${address}/payments?order=desc&limit=50`, { signal: AbortSignal.timeout(15_000) });
    const recent: any[] = r.ok ? ((await r.json()) as any)?._embedded?.records ?? [] : [];
    const before = recent.find((x) => new Date(x.created_at) < since) ?? recent[recent.length - 1];
    return { list: [], cursor: before ? String(before.paging_token) : "0" };
  }
  const r = await fetch(`${HORIZON()}/accounts/${address}/payments?order=asc&limit=100&join=transactions&cursor=${encodeURIComponent(cursor)}`, { signal: AbortSignal.timeout(15_000) });
  if (r.status === 404) return { list: [], cursor };
  if (!r.ok) throw new Error(`Horizon ${r.status}`);
  const body = (await r.json()) as any;
  const records: any[] = body?._embedded?.records ?? [];
  const list: StellarPayment[] = [];
  for (const p of records) {
    if (p.transaction_successful === false || p.to !== address) continue;
    if (p.type !== "payment" && p.type !== "path_payment_strict_receive" && p.type !== "path_payment_strict_send") continue;
    const coin = coinOfAsset(p.asset_code, p.asset_issuer);
    if (!coin) continue;
    const memo = p.transaction?.memo_type && p.transaction.memo_type !== "none" ? String(p.transaction.memo ?? "").trim() : null;
    list.push({ id: String(p.id), coin, micros: stellarMicros(p.amount), from: p.from, memo, tx: p.transaction_hash, at: new Date(p.created_at) });
  }
  return { list, cursor: records.length ? String(records[records.length - 1].paging_token) : cursor };
}

// ─── Sending (returns and settlements) ───────────────────────────────────

/** Nothing left: safe to fail, or to try again later. */
export class StellarNotSent extends Error {
  constructor(message: string, public retry = false) {
    super(message);
  }
}

/**
 * Pays `micros` of a coin from the float to `to` on Stellar. Checks first that
 * the account is open and trusts the coin, and that the float holds enough,
 * read live from the network. Resolves once the ledger has it: Stellar is
 * final when the transaction is in.
 */
export async function stellarSend(coin: StellarCoin, to: string, micros: bigint, memo?: string | null): Promise<{ txHash: string }> {
  const float = stellarFloat();
  if (!float) throw new StellarNotSent("FLOAT_SOLANA_PRIVATE_KEY isn't set, so Stellar can't pay out yet.");
  if (!isStellarAddress(to)) throw new StellarNotSent("That isn't a Stellar address.");
  const dest = await readAccount(to);
  if (!dest) throw new StellarNotSent("That Stellar account isn't open yet.");
  if (!trustOf(dest)[coin]) throw new StellarNotSent(`That Stellar account can't hold ${coin} yet: it needs a ${coin} trustline.`);
  const source = await readAccount(float.publicKey());
  if (!source) throw new StellarNotSent("The Stellar float isn't open yet.", true);
  const have = source.balances.find((b) => "asset_code" in b && coinOfAsset(b.asset_code, b.asset_issuer) === coin);
  if (!have || stellarMicros(have.balance) < micros) throw new StellarNotSent(`The Stellar float is low on ${coin}.`, true);
  const builder = new TransactionBuilder(source, { fee: String(Number(BASE_FEE) * 10), networkPassphrase: Networks.PUBLIC })
    .addOperation(Operation.payment({ destination: to, asset: stellarAsset(coin), amount: toStellarAmount(micros) }))
    .setTimeout(120);
  if (memo) builder.addMemo(/^\d{1,19}$/.test(memo) ? Memo.id(memo) : Memo.text(memo.slice(0, 28)));
  const tx = builder.build();
  tx.sign(float);
  try {
    const res = await horizon().submitTransaction(tx);
    return { txHash: (res as { hash: string }).hash };
  } catch (e) {
    // A refused transaction never reached a ledger: nothing moved.
    const status = (e as { response?: { status?: number } }).response?.status;
    if (status === 400) throw new StellarNotSent(`Stellar refused it: ${resultOf(e)}`);
    throw e;
  }
}

/** What the network says about a transaction we sent. */
export async function stellarTxStatus(hash: string): Promise<"settled" | "failed" | "pending" | "unknown"> {
  try {
    const t = (await horizon().transactions().transaction(hash).call()) as { successful?: boolean };
    return t.successful ? "settled" : "failed";
  } catch (e) {
    return (e as { response?: { status?: number } }).response?.status === 404 ? "unknown" : "pending";
  }
}

/** What the float holds on Stellar, read live. */
export async function stellarFloatBalances(): Promise<{ usdcMicros: bigint; usdtMicros: bigint; xlm: number } | null> {
  const float = stellarFloat();
  if (!float) return null;
  const acct = await readAccount(float.publicKey());
  if (!acct) return { usdcMicros: 0n, usdtMicros: 0n, xlm: 0 };
  const of = (c: StellarCoin) => {
    const b = acct.balances.find((x) => "asset_code" in x && coinOfAsset(x.asset_code, x.asset_issuer) === c);
    return b ? stellarMicros(b.balance) : 0n;
  };
  return { usdcMicros: of("USDC"), usdtMicros: of("USDT"), xlm: Number(acct.balances.find((b) => b.asset_type === "native")?.balance ?? 0) };
}

// ─── Opening a business wallet on Stellar ────────────────────────────────

/**
 * A business wallet's Stellar account has to exist and trust USDC before a
 * settlement can land there. The float sponsors both reserves (1.5 XLM, held
 * by the float, not moved to the owner) and pays the fee; the owner signs the
 * transaction's hash with their own key, in the dashboard - the key never
 * leaves their sign-in.
 */
const openings = new Map<string, { xdr: string; at: number }>();

/** Whether a Stellar account is open for USDC, read live. */
export async function stellarOpenForUsdc(address: string): Promise<boolean> {
  return trustOf(await readAccount(address)).USDC;
}

/** The opening transaction, for the owner to sign: its hash, hex. Null when it's open already. */
export async function prepareStellarOpening(owner: string): Promise<{ hash: string } | null> {
  const float = stellarFloat();
  if (!float) throw new StellarNotSent("Stellar isn't switched on for business wallets yet.");
  const acct = await readAccount(owner);
  if (trustOf(acct).USDC) return null;
  const source = await readAccount(float.publicKey());
  if (!source) throw new StellarNotSent("Stellar isn't ready on our side yet. Try again later.", true);
  const b = new TransactionBuilder(source, { fee: String(Number(BASE_FEE) * 10), networkPassphrase: Networks.PUBLIC })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: owner }))
    .setTimeout(180);
  if (!acct) b.addOperation(Operation.createAccount({ destination: owner, startingBalance: "0" }));
  b.addOperation(Operation.changeTrust({ asset: stellarAsset("USDC"), source: owner }));
  b.addOperation(Operation.endSponsoringFutureReserves({ source: owner }));
  const tx = b.build();
  openings.set(owner, { xdr: tx.toXDR(), at: Date.now() });
  return { hash: tx.hash().toString("hex") };
}

/** The owner's signature on the opening: checked against their key, the float's added, and sent. */
export async function submitStellarOpening(owner: string, signature: Buffer): Promise<string> {
  const float = stellarFloat();
  const pending = openings.get(owner);
  if (!float || !pending || Date.now() - pending.at > 170_000) throw new StellarNotSent("That took too long. Try again.");
  const tx = TransactionBuilder.fromXDR(pending.xdr, Networks.PUBLIC);
  if (!("operations" in tx)) throw new StellarNotSent("Something went wrong. Try again.");
  if (!Keypair.fromPublicKey(owner).verify(tx.hash(), signature)) throw new StellarNotSent("That signature isn't from your wallet.");
  tx.addSignature(owner, signature.toString("base64"));
  tx.sign(float);
  try {
    const res = await horizon().submitTransaction(tx);
    openings.delete(owner);
    return (res as { hash: string }).hash;
  } catch (e) {
    throw new StellarNotSent(`Stellar refused it: ${resultOf(e)}`);
  }
}

/** What a Stellar account holds in our two coins, read live. Unopened: nothing. */
export async function stellarHoldings(address: string): Promise<{ coin: StellarCoin; micros: bigint }[]> {
  const acct = await readAccount(address);
  if (!acct) return [];
  const out: { coin: StellarCoin; micros: bigint }[] = [];
  for (const b of acct.balances) {
    const c = "asset_code" in b ? coinOfAsset(b.asset_code, b.asset_issuer) : null;
    if (c) out.push({ coin: c, micros: stellarMicros(b.balance) });
  }
  return out;
}
