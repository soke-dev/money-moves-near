/**
 * An app payment, checked on chain before it counts.
 *
 * The app says when a customer's send has gone through, but we don't settle on
 * its word: the transaction it names is read from the chain itself, and it has
 * to have succeeded and moved at least the payment's amount of the right coin
 * to our own treasury address on that chain. Anything else - a hash that
 * failed, paid somebody else, or paid less - is not a payment.
 *
 * Returns true or false when the chain answered, and null when it couldn't be
 * asked (no RPC, a timeout), so the worker simply looks again later.
 */
import { env } from "../config/env";
import { treasuryAddresses } from "./app-pay";

type Check = { chain: string; asset: string; txHash: string; micros: bigint };

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const EVM: Record<string, { url?: string; tokens: Record<string, { address: string; decimals: number }> }> = {
  BASE: { url: env.BASE_RPC_URL, tokens: { USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 }, USDT: { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 } } },
  BEP20: { url: env.BSC_RPC_URL, tokens: { USDC: { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 }, USDT: { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 } } },
  MONAD: { url: env.MONAD_RPC_URL, tokens: { USDC: { address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 }, USDT: { address: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D", decimals: 6 } } },
};
const SOL_MINTS: Record<string, string> = { USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" };
// What the app sends on Movement: native USDC (kept as USDCx) and USDT, as fungible assets.
const MOVE_ASSETS: Record<string, string> = {
  USDCx: "0xba11833544a2f99eec743f41a228ca6ffa7f13c3b6b04681d5a79a8b75ff225e",
  USDT: "0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d",
};

/** A token amount in its own decimals, as millionths. */
const toMicros = (raw: bigint, decimals: number) => (decimals >= 6 ? raw / 10n ** BigInt(decimals - 6) : raw * 10n ** BigInt(6 - decimals));
const sameHex = (a: string, b: string) => {
  const n = (x: string) => x.toLowerCase().replace(/^0x/, "").replace(/^0+/, "");
  return n(a) === n(b);
};

async function rpc(url: string, method: string, params: unknown[]): Promise<any> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
  const j = (await r.json()) as { result?: unknown; error?: { message?: string } };
  if (!r.ok || j.error) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
  return j.result;
}

async function evm(c: Check, to: string): Promise<boolean | null> {
  const net = EVM[c.chain];
  const token = net?.tokens[c.asset];
  if (!net?.url || !token) return null;
  const receipt = await rpc(net.url, "eth_getTransactionReceipt", [c.txHash]);
  if (!receipt) return null; // not mined yet, or the node hasn't seen it
  if (receipt.status !== "0x1") return false;
  let paid = 0n;
  for (const l of receipt.logs ?? []) {
    if (!sameHex(l.address, token.address) || l.topics?.[0] !== TRANSFER_TOPIC || l.topics.length < 3) continue;
    if (!sameHex(l.topics[2], to)) continue;
    paid += BigInt(l.data);
  }
  return toMicros(paid, token.decimals) >= c.micros;
}

/** Arc: USDC is the chain's own currency, sent as a plain value transfer (18 decimals). */
async function arc(c: Check, to: string): Promise<boolean | null> {
  if (!env.ARC_RPC_URL || c.asset !== "USDC") return null;
  const [tx, receipt] = await Promise.all([rpc(env.ARC_RPC_URL, "eth_getTransactionByHash", [c.txHash]), rpc(env.ARC_RPC_URL, "eth_getTransactionReceipt", [c.txHash])]);
  if (!tx || !receipt) return null;
  if (receipt.status !== "0x1") return false;
  if (!tx.to || !sameHex(tx.to, to)) return false;
  return toMicros(BigInt(tx.value), 18) >= c.micros;
}

async function solana(c: Check, to: string): Promise<boolean | null> {
  const mint = SOL_MINTS[c.asset];
  if (!env.SOLANA_RPC_URL || !mint) return null;
  const tx = await rpc(env.SOLANA_RPC_URL, "getTransaction", [c.txHash, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]);
  if (!tx) return null;
  if (tx.meta?.err) return false;
  const held = (list: any[]) =>
    (list ?? []).filter((b) => b.mint === mint && b.owner === to).reduce((t, b) => t + BigInt(b.uiTokenAmount?.amount ?? "0"), 0n);
  const gained = held(tx.meta?.postTokenBalances) - held(tx.meta?.preTokenBalances);
  return gained >= c.micros;
}

async function movement(c: Check, to: string): Promise<boolean | null> {
  const meta = MOVE_ASSETS[c.asset];
  if (!env.MOVEMENT_RPC_URL || !meta) return null;
  const base = env.MOVEMENT_RPC_URL.replace(/\/+$/, "");
  const r = await fetch(`${base}/transactions/by_hash/${c.txHash}`, { signal: AbortSignal.timeout(15_000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const tx: any = await r.json();
  if (tx.type === "pending_transaction") return null;
  if (tx.success !== true) return false;
  const p = tx.payload ?? {};
  if (p.function !== "0x1::primary_fungible_store::transfer") return false;
  const [metadata, recipient, amount] = p.arguments ?? [];
  const metaAddr = typeof metadata === "string" ? metadata : metadata?.inner;
  if (!metaAddr || !sameHex(metaAddr, meta) || !recipient || !sameHex(String(recipient), to)) return false;
  return BigInt(String(amount)) >= c.micros;
}

export async function verifyAppTransfer(c: Check): Promise<boolean | null> {
  const to = treasuryAddresses()[c.chain];
  if (!to || !c.txHash) return null;
  try {
    if (c.chain === "ARC") return await arc(c, to);
    if (c.chain === "SOL") return await solana(c, to);
    if (c.chain === "MOVE") return await movement(c, to);
    return await evm(c, to);
  } catch {
    return null;
  }
}
