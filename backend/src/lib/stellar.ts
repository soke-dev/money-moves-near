/**
 * Stellar: USDC and USDT0, on the same key as Solana.
 *
 * Stellar signs with Ed25519, the curve Solana uses, so the user's Solana key
 * IS their Stellar key - the G... address is the same 32 public-key bytes in
 * Stellar's own encoding. No second wallet, nothing new in Dynamic, and the
 * app signs a Stellar transaction exactly as it signs a Solana one: a 32-byte
 * hash through signEd25519Hex.
 *
 * Two things make Stellar unlike the other chains here.
 *
 * 1. An account has to be opened before it can hold anything, and each coin
 *    needs a trustline on top. Both lock up XLM as a reserve - 1 XLM for the
 *    account, 0.5 per trustline. Our treasury sponsors those reserves, so the
 *    user's account can start at zero XLM, and the XLM stays in the treasury
 *    (counted against its minimum balance) rather than moving to the user.
 *    Nothing is opened until the user actually picks Stellar, and only the
 *    coin they picked gets a trustline.
 *
 * 2. Fees. A user payment is built with the user as its source, they sign it,
 *    and the treasury wraps it in a fee bump - the treasury pays the fee, and a
 *    fee bump uses none of the treasury's sequence numbers, so any number of
 *    users can send at once without colliding. The fee is about 0.00001 XLM.
 *
 * Off-ramp, bills, username transfers and withdrawals only. Buying lands on
 * Movement, so nothing here ever sends money out of the treasury to a user.
 */
import {
  Asset as StellarAsset,
  BASE_FEE,
  FeeBumpTransaction,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  StrKey,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import bs58 from "bs58";
import { env } from "../config/env";

export type StellarCoin = "USDC" | "USDT";

const IS_PUBLIC = env.STELLAR_NETWORK !== "TESTNET";
export const STELLAR_PASSPHRASE = IS_PUBLIC ? Networks.PUBLIC : Networks.TESTNET;
const HORIZON_URL =
  env.STELLAR_HORIZON_URL ||
  (IS_PUBLIC ? "https://horizon.stellar.org" : "https://horizon-testnet.stellar.org");
export const horizon = new Horizon.Server(HORIZON_URL);

/**
 * The two coins, by issuer. Mainnet values verified 2 Oct 2026: USDC is
 * Circle's (home domain circle.com, 2.4M holders); USDT0 is the issuer the
 * Stellar docs list for it (developers.stellar.org/launch/usdt0). USDT0 sets
 * auth_revocable and auth_clawback_enabled - Tether can freeze and claw back.
 */
const ISSUERS: Record<StellarCoin, string> = {
  USDC: env.STELLAR_USDC_ISSUER || "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  USDT: env.STELLAR_USDT_ISSUER || "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
};
const CODES: Record<StellarCoin, string> = { USDC: "USDC", USDT: "USDT0" };

export function stellarAsset(coin: StellarCoin): StellarAsset {
  return new StellarAsset(CODES[coin], ISSUERS[coin]);
}

export function isStellarCoin(v: string): v is StellarCoin {
  return v === "USDC" || v === "USDT";
}

// ─── Treasury ────────────────────────────────────────────────

export function isStellarConfigured(): boolean {
  return !!env.STELLAR_TREASURY_SECRET;
}

function treasury(): Keypair {
  if (!env.STELLAR_TREASURY_SECRET) throw new StellarError("Stellar is not available right now");
  return Keypair.fromSecret(env.STELLAR_TREASURY_SECRET);
}

export function treasuryAddress(): string | null {
  return env.STELLAR_TREASURY_SECRET ? treasury().publicKey() : null;
}

/** Where sold and bill coins land: SELL_STELLAR_ADDRESS, else the treasury. */
export function sellAddress(): string | null {
  return env.SELL_STELLAR_ADDRESS || treasuryAddress();
}

/**
 * The fee per operation the treasury offers, in stroops.
 *
 * Horizon's last-ledger base fee, floored at the network minimum and capped
 * so a fee spike cannot quietly drain the treasury: at the cap a payment
 * costs 0.0002 XLM.
 */
async function feePerOp(): Promise<number> {
  try {
    const base = await horizon.fetchBaseFee();
    return Math.min(Math.max(base, Number(BASE_FEE)), 10_000);
  } catch {
    return 1_000;
  }
}

// ─── Errors ──────────────────────────────────────────────────

/** A refusal written for the person, safe to show as it stands. */
export class StellarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StellarError";
  }
}

/**
 * The treasury's sequence number moved under a prepared activation - another
 * activation got there first. Nothing happened on chain; prepare again.
 */
export class StellarRetry extends Error {
  constructor() {
    super("Please try that again.");
    this.name = "StellarRetry";
  }
}

function resultCodes(err: any): { tx?: string; ops?: string[] } {
  const codes = err?.response?.data?.extras?.result_codes;
  return { tx: codes?.transaction, ops: codes?.operations };
}

// ─── Addresses ───────────────────────────────────────────────

/** The user's G... address, from their Solana address. Same key, same bytes. */
export function stellarAddressFromSolana(solanaAddress: string): string {
  const raw = bs58.decode(solanaAddress);
  if (raw.length !== 32) throw new Error("Not a Solana public key");
  return StrKey.encodeEd25519PublicKey(Buffer.from(raw));
}

/** G... only. Muxed M... addresses are not taken; exchanges get a memo instead. */
export function isValidStellarAddress(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value);
}

export function stellarExplorerUrl(hash: string): string {
  return `https://stellar.expert/explorer/${IS_PUBLIC ? "public" : "testnet"}/tx/${hash}`;
}

// ─── Account state ───────────────────────────────────────────

export interface StellarAccountState {
  exists: boolean;
  trust: Record<StellarCoin, boolean>;
  balances: Record<StellarCoin, number>;
}

function isNotFound(err: any): boolean {
  return err?.response?.status === 404 || err?.name === "NotFoundError";
}

export async function getAccountState(address: string): Promise<StellarAccountState> {
  const empty: StellarAccountState = {
    exists: false,
    trust: { USDC: false, USDT: false },
    balances: { USDC: 0, USDT: 0 },
  };
  let account: Horizon.AccountResponse;
  try {
    account = await horizon.loadAccount(address);
  } catch (err: any) {
    if (isNotFound(err)) return empty;
    throw err;
  }
  const state: StellarAccountState = { ...empty, exists: true, trust: { ...empty.trust }, balances: { ...empty.balances } };
  for (const b of account.balances as any[]) {
    for (const coin of ["USDC", "USDT"] as StellarCoin[]) {
      if (b.asset_code === CODES[coin] && b.asset_issuer === ISSUERS[coin]) {
        state.trust[coin] = true;
        state.balances[coin] = Number(b.balance);
      }
    }
  }
  return state;
}

/**
 * Balances for the refresh path, cached briefly.
 *
 * SDF's public Horizon allows about 3,600 requests an hour per IP, so this is
 * only ever called for users who have opened Stellar, and a figure half a
 * minute old is fine for a balance screen. Sends read getAccountState fresh.
 */
const balanceCache = new Map<string, { at: number; value: StellarAccountState }>();
export async function getStellarBalances(address: string, maxAgeMs = 30_000): Promise<StellarAccountState> {
  const hit = balanceCache.get(address);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.value;
  const value = await getAccountState(address);
  balanceCache.set(address, { at: Date.now(), value });
  return value;
}

export async function getStellarCoinBalance(coin: StellarCoin, address: string): Promise<number> {
  const state = await getAccountState(address);
  return state.balances[coin];
}

// ─── Deposits ────────────────────────────────────────────────

export interface StellarDeposit {
  txHash: string;
  from: string;
  at: Date;
  amount: number;
}

/** The latest arrival of `coin` at `address`, for the deposit watcher. */
export async function findStellarDeposit(address: string, coin: StellarCoin): Promise<StellarDeposit | null> {
  try {
    const page = await horizon.payments().forAccount(address).order("desc").limit(20).call();
    for (const r of page.records as any[]) {
      const kind = r.type as string;
      if (kind !== "payment" && !kind.startsWith("path_payment")) continue;
      if (r.to !== address) continue;
      if (r.asset_code !== CODES[coin] || r.asset_issuer !== ISSUERS[coin]) continue;
      return { txHash: r.transaction_hash, from: r.from, at: new Date(r.created_at), amount: Number(r.amount) };
    }
    return null;
  } catch (err: any) {
    console.error("[STELLAR] deposit scan failed:", err?.message);
    return null;
  }
}

// ─── Prepared transactions ───────────────────────────────────

interface Prepared {
  kind: "activate" | "payment";
  xdr: string;
  signer: string;
  coin: StellarCoin;
  expiresAt: number;
}
const prepared = new Map<string, Prepared>();
const sweeper: any = setInterval(() => {
  const now = Date.now();
  for (const [id, p] of prepared) if (p.expiresAt < now) prepared.delete(id);
}, 60_000);
sweeper.unref?.();

const VALID_FOR_SECONDS = 120;

const BASE_RESERVE_XLM = 0.5;

/**
 * XLM the treasury keeps for fees and never lends out as reserve. A transfer
 * costs it 0.00002 XLM at the base fee and 0.002 at the busiest clamp, so two
 * XLM is a thousand transfers at worst and a hundred thousand normally.
 */
export const FEE_FLOOR_XLM = 2;

/** What an account can spend: its XLM less the reserve its entries lock. */
function freeXlm(acc: any): { xlm: number; spendable: number } {
  const native = acc.balances.find((b: any) => b.asset_type === "native");
  const xlm = Number(native?.balance ?? 0);
  const minimum =
    (2 + Number(acc.subentry_count ?? 0) + Number(acc.num_sponsoring ?? 0) - Number(acc.num_sponsored ?? 0)) *
    BASE_RESERVE_XLM;
  return { xlm, spendable: Math.max(0, xlm - minimum - Number(native?.selling_liabilities ?? 0)) };
}

function amountString(amount: number): string {
  // Seven decimals is Stellar's precision; more would be refused.
  const s = amount.toFixed(7);
  if (Number(s) <= 0) throw new StellarError("Amount too small to send");
  return s;
}

// ─── Opening Stellar for a coin ──────────────────────────────

/**
 * Open the user's Stellar account for one coin, or add that coin to an open
 * account. Returns null when there is nothing to do.
 *
 * Sourced from the treasury, which pays the fee and puts up the reserve
 * through the sponsorship sandwich: begin (treasury), create the account at
 * zero XLM (treasury, first time only), add the trustline (user), end (user).
 * Both sign. Using the treasury's sequence number means two activations
 * prepared at the same moment collide; the second gets StellarRetry at submit
 * and simply prepares again.
 */
export async function prepareActivation(
  id: string,
  userAddress: string,
  coin: StellarCoin,
): Promise<{ signingMessage: string } | null> {
  const state = await getAccountState(userAddress);
  if (state.exists && state.trust[coin]) return null;

  const sponsor = treasury();
  const source = await horizon.loadAccount(sponsor.publicKey());

  // New accounts stop while there is still XLM for fees. Every transfer is
  // fee-bumped from this same balance, so letting sign-ups spend it to the
  // last stroop would strand the people already holding coins on Stellar:
  // unable to sell or withdraw until someone tops the treasury up.
  const cost = (state.exists ? 1 : 3) * BASE_RESERVE_XLM;
  if (freeXlm(source).spendable - cost < FEE_FLOOR_XLM) {
    console.error(`[STELLAR] treasury low, refusing new reserves. Top up ${sponsor.publicKey()}`);
    throw new StellarError("Stellar is not available right now. Please try again later.");
  }

  const fee = await feePerOp();
  const builder = new TransactionBuilder(source, {
    fee: String(fee),
    networkPassphrase: STELLAR_PASSPHRASE,
  }).addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: userAddress }));

  if (!state.exists) {
    builder.addOperation(Operation.createAccount({ destination: userAddress, startingBalance: "0" }));
  }
  builder
    .addOperation(Operation.changeTrust({ asset: stellarAsset(coin), source: userAddress }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: userAddress }))
    .setTimeout(VALID_FOR_SECONDS);

  const tx = builder.build();
  prepared.set(id, {
    kind: "activate",
    xdr: tx.toXDR(),
    signer: userAddress,
    coin,
    expiresAt: Date.now() + VALID_FOR_SECONDS * 1000,
  });
  return { signingMessage: tx.hash().toString("hex") };
}

export async function submitActivation(id: string, signatureHex: string): Promise<string> {
  const p = prepared.get(id);
  if (!p || p.kind !== "activate") throw new StellarError("That request expired. Please try again.");
  const tx = TransactionBuilder.fromXDR(p.xdr, STELLAR_PASSPHRASE) as Transaction;
  addUserSignature(tx, p.signer, signatureHex);
  tx.sign(treasury());
  try {
    const res = await horizon.submitTransaction(tx);
    prepared.delete(id);
    balanceCache.delete(p.signer);
    return res.hash;
  } catch (err: any) {
    prepared.delete(id);
    const { tx: code, ops } = resultCodes(err);
    console.error(`[STELLAR] activation failed: ${code} ${JSON.stringify(ops ?? [])}`);
    if (code === "tx_bad_seq") throw new StellarRetry();
    if (code === "tx_insufficient_balance" || ops?.includes("op_low_reserve")) {
      throw new StellarError("Stellar is not available right now. Please try again later.");
    }
    throw new StellarError("Could not set up Stellar. Please try again.");
  }
}

// ─── Payments ────────────────────────────────────────────────

/**
 * A payment from the user, for them to sign.
 *
 * The destination is checked first, because a payment to an account that
 * does not exist, or has no trustline for the coin, fails on chain with a
 * code nobody can read. Our own treasury is trusted without a look.
 */
export async function preparePayment(
  id: string,
  args: { from: string; to: string; coin: StellarCoin; amount: number; memo?: string | null },
): Promise<{ signingMessage: string }> {
  const { from, to, coin, amount } = args;
  if (!isValidStellarAddress(to)) throw new StellarError("That is not a valid Stellar address");
  if (to === from) throw new StellarError("You cannot send to your own address");

  if (to !== sellAddress()) {
    const dest = await getAccountState(to);
    if (!dest.exists) {
      throw new StellarError(
        "That Stellar address is not active yet. It needs to be opened, with a " +
          `${coin === "USDT" ? "USDT0" : "USDC"} trustline, before it can receive.`,
      );
    }
    if (!dest.trust[coin]) {
      throw new StellarError(
        `That address cannot receive ${coin === "USDT" ? "USDT0" : "USDC"} on Stellar yet. ` +
          "It has to add a trustline for it first.",
      );
    }
  }

  let account: Horizon.AccountResponse;
  try {
    account = await horizon.loadAccount(from);
  } catch (err: any) {
    if (isNotFound(err)) throw new StellarError("Your Stellar wallet is not set up yet");
    throw err;
  }

  const builder = new TransactionBuilder(account, {
    // The inner fee is never charged - the fee bump pays - but it sets the fee
    // rate the bump has to meet, so it stays at the network minimum.
    fee: BASE_FEE,
    networkPassphrase: STELLAR_PASSPHRASE,
  })
    .addOperation(Operation.payment({ destination: to, asset: stellarAsset(coin), amount: amountString(amount) }))
    .setTimeout(VALID_FOR_SECONDS);

  const memo = args.memo?.trim();
  if (memo) builder.addMemo(memoFor(memo));

  const tx = builder.build();
  prepared.set(id, {
    kind: "payment",
    xdr: tx.toXDR(),
    signer: from,
    coin,
    expiresAt: Date.now() + VALID_FOR_SECONDS * 1000,
  });
  return { signingMessage: tx.hash().toString("hex") };
}

/**
 * Attach the user's signature, wrap in the treasury's fee bump, and submit.
 *
 * Horizon answers once the ledger has closed, so a hash back from here means
 * the money moved - which is what the callers rely on: a sell pays naira the
 * moment this resolves.
 */
export async function submitPayment(id: string, signatureHex: string): Promise<string> {
  const p = prepared.get(id);
  if (!p || p.kind !== "payment") throw new StellarError("That request expired. Please try again.");
  const inner = TransactionBuilder.fromXDR(p.xdr, STELLAR_PASSPHRASE) as Transaction;
  addUserSignature(inner, p.signer, signatureHex);

  const payer = treasury();
  const bump: FeeBumpTransaction = TransactionBuilder.buildFeeBumpTransaction(
    payer,
    String(await feePerOp()),
    inner,
    STELLAR_PASSPHRASE,
  );
  bump.sign(payer);

  try {
    const res = await horizon.submitTransaction(bump);
    prepared.delete(id);
    balanceCache.delete(p.signer);
    return res.hash;
  } catch (err: any) {
    prepared.delete(id);
    const { tx: code, ops } = resultCodes(err);
    console.error(`[STELLAR] payment failed: ${code} ${JSON.stringify(ops ?? [])}`);
    if (ops?.includes("op_underfunded")) throw new StellarError("Insufficient balance for this transfer");
    if (ops?.includes("op_no_trust") || ops?.includes("op_no_destination")) {
      throw new StellarError("The destination cannot receive this coin on Stellar");
    }
    if (code === "tx_bad_seq" || code === "tx_too_late") {
      throw new StellarError("That request expired. Please try again.");
    }
    if (code === "tx_insufficient_fee" || code === "tx_fee_bump_inner_failed") {
      throw new StellarError("Stellar is busy right now. Please try again.");
    }
    throw new StellarError("The Stellar transfer did not go through. Nothing was sent.");
  }
}

/** Throws if the signature does not verify against the transaction hash. */
function addUserSignature(tx: Transaction, signer: string, signatureHex: string): void {
  const sig = Buffer.from(signatureHex, "hex");
  if (sig.length !== 64) throw new StellarError("Invalid signature");
  try {
    tx.addSignature(signer, sig.toString("base64"));
  } catch {
    throw new StellarError("The signature did not match. Please try again.");
  }
}

/**
 * What an exchange asks for. A whole number goes as a memo ID - Binance and
 * most others use those - and anything else as text, which Stellar caps at
 * 28 bytes.
 */
function memoFor(memo: string) {
  if (/^\d{1,19}$/.test(memo)) {
    try {
      return Memo.id(memo);
    } catch {
      /* falls through to text */
    }
  }
  if (Buffer.byteLength(memo, "utf8") > 28) {
    throw new StellarError("A Stellar memo can be at most 28 characters");
  }
  return Memo.text(memo);
}

// ─── Treasury housekeeping ───────────────────────────────────

export interface TreasuryStatus {
  address: string;
  xlm: number;
  /** XLM free to spend on fees and new reserves. */
  spendableXlm: number;
  sponsoring: number;
  trust: Record<StellarCoin, boolean>;
}

export async function treasuryStatus(): Promise<TreasuryStatus> {
  const address = treasury().publicKey();
  const acc: any = await horizon.loadAccount(address);
  const { xlm, spendable } = freeXlm(acc);
  const trust = { USDC: false, USDT: false } as Record<StellarCoin, boolean>;
  for (const b of acc.balances) {
    for (const coin of ["USDC", "USDT"] as StellarCoin[]) {
      if (b.asset_code === CODES[coin] && b.asset_issuer === ISSUERS[coin]) trust[coin] = true;
    }
  }
  return {
    address,
    xlm,
    spendableXlm: spendable,
    sponsoring: Number(acc.num_sponsoring ?? 0),
    trust,
  };
}

/**
 * Give the treasury trustlines for both coins, so it can receive sells and
 * bills. One-off; run from the setup script, never on a request.
 */
export async function ensureTreasuryTrustlines(): Promise<string | null> {
  const status = await treasuryStatus();
  const missing = (["USDC", "USDT"] as StellarCoin[]).filter((c) => !status.trust[c]);
  if (!missing.length) return null;
  const payer = treasury();
  const builder = new TransactionBuilder(await horizon.loadAccount(payer.publicKey()), {
    fee: String(await feePerOp()),
    networkPassphrase: STELLAR_PASSPHRASE,
  });
  for (const coin of missing) builder.addOperation(Operation.changeTrust({ asset: stellarAsset(coin) }));
  const tx = builder.setTimeout(VALID_FOR_SECONDS).build();
  tx.sign(payer);
  const res = await horizon.submitTransaction(tx);
  return res.hash;
}
