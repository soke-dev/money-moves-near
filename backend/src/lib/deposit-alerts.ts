import { prisma } from "./prisma";
import { env } from "../config/env";
import { fetchRates } from "../routes/rates";
import { auroraTokens } from "./aurora";
import { sendLargeDepositAlert } from "./email";

/**
 * Tell the team when a large deposit is on its way.
 *
 * Called wherever a deposit is first seen: a wallet deposit the balance sync
 * finds, a Bitcoin or Tron payment the chain watcher spots or the converter
 * reports, a converted deposit Stableyard reports. Anything worth
 * DEPOSIT_ALERT_USD or more (default $500) emails DEPOSIT_ALERT_EMAILS.
 *
 * Each deposit is alerted once: a marker row in service_status, keyed on the
 * transaction's reference, is the lock. A converted deposit is seen twice -
 * coming in, then again as USDC landing in the wallet - so a wallet deposit
 * close in value to a converted one already alerted for the same person in
 * the last day is taken to be that one and stays quiet.
 *
 * Best effort throughout: nothing here may hold up or fail the deposit itself.
 */

const STABLE = new Set(["USDC", "USDCx", "USDCe", "USDT", "USDT0", "USDG", "DAI"]);
const KEY = (userId: string, reference: string) => `depalert:${userId}:${reference}`;

/** Today's dollar price of a coin by its symbol, or null when we cannot say. */
async function priceOf(symbol: string): Promise<number | null> {
  if (STABLE.has(symbol)) return 1;
  const rates: any = await fetchRates().catch(() => null);
  if (symbol === "cNGN") {
    const ngn = Number(rates?.USDC?.ngn);
    return ngn > 0 ? 1 / ngn : null;
  }
  const fromFeed = Number(rates?.[symbol]?.usd);
  if (fromFeed > 0) return fromFeed;
  const tokens = await auroraTokens().catch(() => null);
  for (const t of tokens?.values() ?? []) if (t.symbol === symbol && t.price > 0) return t.price;
  return null;
}

export type IncomingDeposit = {
  userId: string;
  reference: string;
  amount: number;
  symbol: string;
  network: string;
  /** "wallet deposit", "converting to USDC" and so on: what kind of arrival it is. */
  kind: string;
  /** Converting deposits are remembered so their later landing in the wallet stays quiet. */
  converting?: boolean;
  txHash?: string | null;
};

export async function alertIfLargeDeposit(d: IncomingDeposit): Promise<void> {
  try {
    const to = env.DEPOSIT_ALERT_EMAILS.split(",").map((s) => s.trim()).filter(Boolean);
    if (!to.length || !(d.amount > 0)) return;
    const price = await priceOf(d.symbol);
    if (price == null) return;
    const usd = d.amount * price;
    if (usd < env.DEPOSIT_ALERT_USD) return;

    // The converting deposit this landing belongs to has already been reported.
    if (!d.converting) {
      const since = Date.now() - 24 * 60 * 60_000;
      const prior = await prisma.serviceStatus.findMany({
        where: { key: { startsWith: `depalert:${d.userId}:` } },
        select: { value: true },
      });
      const matched = prior.some((r) => {
        try {
          const v = JSON.parse(r.value ?? "");
          return v.converting && Date.parse(v.at) > since && Math.abs(v.usd - usd) <= v.usd * 0.15;
        } catch {
          return false;
        }
      });
      if (matched) return;
    }

    // The lock: whoever writes this marker sends the email, and nobody else does.
    try {
      await prisma.serviceStatus.create({
        data: { key: KEY(d.userId, d.reference), value: JSON.stringify({ usd, converting: !!d.converting, at: new Date().toISOString() }) },
      });
    } catch {
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: d.userId }, select: { email: true, username: true } });
    await sendLargeDepositAlert(to, {
      usd,
      amount: String(Number(d.amount.toFixed(8))),
      symbol: d.symbol,
      network: d.network,
      kind: d.kind,
      userEmail: user?.email ?? "unknown",
      username: user?.username ?? null,
      userId: d.userId,
      txHash: d.txHash ?? null,
      reference: d.reference,
      date: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC",
    });
    console.log(`[DEPOSIT-ALERT] ${d.reference}: $${usd.toFixed(2)} ${d.symbol} on ${d.network} for ${d.userId}`);
  } catch (e: any) {
    console.warn("[DEPOSIT-ALERT] skipped:", e?.message);
  }
}

const NETWORK: Record<string, string> = {
  MOVE: "Movement", SOL: "Solana", BASE: "Base", BEP20: "BNB Chain", ARC: "Arc", ARB: "Arbitrum",
  TON: "TON", STELLAR: "Stellar", MONAD: "Monad",
  1: "Ethereum", 56: "BNB Chain", 137: "Polygon", 4663: "Robinhood Chain", 10001: "Bitcoin",
  10103: "Solana", 42161: "Arbitrum", 728126428: "Tron",
};

/** A chain as a person would name it, from our chain code or a provider's chain id. */
export const networkName = (chain: string | number) => NETWORK[String(chain)] ?? String(chain);
