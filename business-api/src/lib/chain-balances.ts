/**
 * What a business wallet holds, read from each chain: USDC and USDT on the
 * settle chains and the two busiest EVM ones. Token addresses and decimals are
 * the app's own (backend/src/lib/balances.ts), checked against each contract
 * there - note BNB Chain's two are 18 decimals, and Arc's USDC is its native
 * balance (18 decimals), not the ERC-20 view of it.
 *
 * A chain that can't be read is left out rather than shown as zero.
 */
import { env } from "../config/env";
import { stellarFromSolana, stellarHoldings } from "./stellar";

export interface Holding {
  chain: string;
  asset: "USDC" | "USDT";
  amount: number;
}

// USDC on Movement is USDCx - what the app and the float hold and send (the older bridged token is 0x83121c…).
const MOVE_USDC = "0xba11833544a2f99eec743f41a228ca6ffa7f13c3b6b04681d5a79a8b75ff225e";
const MOVE_USDT = "0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d";
const SOL_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

const EVM_TOKENS: { chain: string; url: string | undefined; tokens: { asset: "USDC" | "USDT"; address: string; decimals: number }[] }[] = [
  { chain: "Base", url: env.BASE_RPC_URL, tokens: [{ asset: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 }, { asset: "USDT", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 }] },
  { chain: "BNB Chain", url: env.BSC_RPC_URL, tokens: [{ asset: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 }, { asset: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 }] },
  { chain: "Monad", url: env.MONAD_RPC_URL, tokens: [{ asset: "USDC", address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 }, { asset: "USDT", address: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D", decimals: 6 }] },
  { chain: "Arbitrum", url: env.ARB_RPC_URL, tokens: [{ asset: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 }, { asset: "USDT", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 }] },
  { chain: "Optimism", url: env.OPTIMISM_RPC_URL, tokens: [{ asset: "USDC", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 }, { asset: "USDT", address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6 }, { asset: "USDT", address: "0x01bFF41798a0BcF287b996046Ca68b395DbC1071", decimals: 6 }] },
  { chain: "Ethereum", url: env.ETHEREUM_RPC_URL, tokens: [{ asset: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 }, { asset: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 }] },
];

const units = (raw: bigint, decimals: number) => Number(raw / 10n ** BigInt(Math.max(0, decimals - 6))) / 1e6;

/** One retry: a provider's brief rate limit shouldn't drop a chain from the page. */
async function rpc(url: string, method: string, params: unknown[]): Promise<any> {
  try {
    return await rpcOnce(url, method, params);
  } catch {
    await new Promise((r) => setTimeout(r, 400));
    return rpcOnce(url, method, params);
  }
}

async function rpcOnce(url: string, method: string, params: unknown[]): Promise<any> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12_000) });
  const j = (await r.json()) as { result?: unknown; error?: { message?: string } };
  if (!r.ok || j.error) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
  return j.result;
}

async function evmBalances(address: string): Promise<Holding[]> {
  const out: Holding[] = [];
  await Promise.all(
    EVM_TOKENS.filter((c) => c.url).map(async (c) => {
      for (const t of c.tokens) {
        try {
          const data = "0x70a08231" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
          const raw = BigInt((await rpc(c.url!, "eth_call", [{ to: t.address, data }, "latest"])) || "0x0");
          out.push({ chain: c.chain, asset: t.asset, amount: units(raw, t.decimals) });
        } catch {
          /* left out: unreadable, not zero */
        }
      }
    }),
  );
  // Arc pays its fees in USDC, and its native balance is that USDC.
  if (env.ARC_RPC_URL) {
    try {
      out.push({ chain: "Arc", asset: "USDC", amount: units(BigInt(await rpc(env.ARC_RPC_URL, "eth_getBalance", [address, "latest"])), 18) });
    } catch {
      /* left out */
    }
  }
  return out;
}

async function solanaBalances(owner: string): Promise<Holding[]> {
  if (!env.SOLANA_RPC_URL) return [];
  const out: Holding[] = [];
  for (const [asset, mint] of [["USDC", SOL_USDC], ["USDT", SOL_USDT]] as const) {
    try {
      const r = await rpc(env.SOLANA_RPC_URL, "getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed" }]);
      const total = (r?.value ?? []).reduce((t: number, a: any) => t + Number(a?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0);
      out.push({ chain: "Solana", asset, amount: total });
    } catch {
      /* left out */
    }
  }
  return out;
}

async function movementBalances(address: string): Promise<Holding[]> {
  if (!env.MOVEMENT_RPC_URL) return [];
  const out: Holding[] = [];
  for (const [asset, metadata] of [["USDC", MOVE_USDC], ["USDT", MOVE_USDT]] as const) {
    try {
      const r = await fetch(`${env.MOVEMENT_RPC_URL.replace(/\/$/, "")}/view`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ function: "0x1::primary_fungible_store::balance", type_arguments: ["0x1::fungible_asset::Metadata"], arguments: [address, metadata] }),
        signal: AbortSignal.timeout(12_000),
      });
      if (r.status === 404) {
        out.push({ chain: "Movement", asset, amount: 0 });
        continue;
      }
      if (!r.ok) continue;
      const data = (await r.json()) as unknown[];
      out.push({ chain: "Movement", asset, amount: Number(BigInt(String(data?.[0] ?? "0"))) / 1e6 });
    } catch {
      /* left out */
    }
  }
  return out;
}

/** Stellar: the Solana key's twin, once it's been opened. */
async function stellarBalances(solana: string): Promise<Holding[]> {
  const address = stellarFromSolana(solana);
  if (!address) return [];
  try {
    return (await stellarHoldings(address)).map((h) => ({ chain: "Stellar", asset: h.coin, amount: Number(h.micros) / 1e6 }));
  } catch {
    return [];
  }
}

export async function walletHoldings(w: { evmAddress: string | null; solanaAddress: string | null; movementAddress: string | null }): Promise<Holding[]> {
  const parts = await Promise.all([
    w.movementAddress ? movementBalances(w.movementAddress) : [],
    w.solanaAddress ? solanaBalances(w.solanaAddress) : [],
    w.evmAddress ? evmBalances(w.evmAddress) : [],
    w.solanaAddress ? stellarBalances(w.solanaAddress) : [],
  ]);
  // One line per coin and network: Optimism's two USDT contracts add up.
  const by = new Map<string, Holding>();
  for (const h of parts.flat()) {
    const k = `${h.asset}:${h.chain}`;
    const was = by.get(k);
    by.set(k, was ? { ...was, amount: was.amount + h.amount } : h);
  }
  return [...by.values()];
}
