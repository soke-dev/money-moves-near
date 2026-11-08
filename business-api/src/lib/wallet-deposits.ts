/**
 * Money that reached a business wallet from anywhere - the owner's own wallet,
 * a customer, an exchange - read from each chain, so the wallet's activity
 * shows deposits as well as the settlements and sends we already know about.
 *
 * Read, never stored: each chain is asked for the recent transfers into the
 * wallet's address there. Movement from its indexer, Solana from the USDC and
 * USDT token accounts' signatures, Stellar from Horizon, and the EVM chains
 * from Alchemy's transfer history where the provider is Alchemy, or the recent
 * blocks' logs otherwise. A chain that can't be read is left out, not shown
 * as empty. Answers are kept a minute per wallet.
 */
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { env } from "../config/env";
import { EVM_CHAINS, MOVE_ASSETS, MOVE_INDEXER, SOL_MINTS, contractsOf, hexNum, rpc, sameHex, toHex, toMicros, type EvmChain } from "./chains";
import { coinOfAsset, stellarFromSolana, stellarMicros } from "./stellar";
import type { Coin } from "./accept";

export interface Deposit {
  /** The network, by name: "Monad", "Movement". */
  chain: string;
  asset: Coin;
  amount: number;
  from: string | null;
  tx: string;
  at: string;
}

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const SINCE_MS = 30 * 86_400_000;
const PER_CHAIN = 20;

// Transactions don't change once final: what each one was is kept here, so a reload asks only for what's new.
const seenSolana = new Map<string, Deposit | null>();
const seenMovement = new Map<number, { hash: string; sender: string | null }>();
const cache = new Map<string, { at: number; list: Deposit[] }>();

async function movementDeposits(address: string): Promise<Deposit[]> {
  const node = env.MOVEMENT_RPC_URL;
  if (!node) return [];
  const owner = `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
  const assets = Object.entries(MOVE_ASSETS) as [Coin, string][];
  const query = `query Deposits($owner: String!, $assets: [String!], $since: timestamp!) {
    fungible_asset_activities(
      where: { owner_address: { _eq: $owner }, asset_type: { _in: $assets }, type: { _eq: "0x1::fungible_asset::Deposit" }, is_transaction_success: { _eq: true }, transaction_timestamp: { _gte: $since } }
      order_by: { transaction_version: desc }
      limit: ${PER_CHAIN}
    ) { transaction_version transaction_timestamp amount asset_type }
  }`;
  const r = await fetch(MOVE_INDEXER(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { owner, assets: assets.map(([, a]) => a), since: new Date(Date.now() - SINCE_MS).toISOString().replace("Z", "") } }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await r.json().catch(() => null)) as { data?: { fungible_asset_activities?: any[] }; errors?: unknown } | null;
  if (!r.ok || body?.errors) throw new Error(`Movement indexer ${r.status}`);
  const out: Deposit[] = [];
  for (const row of body?.data?.fungible_asset_activities ?? []) {
    const coin = assets.find(([, a]) => sameHex(a, row.asset_type))?.[0];
    if (!coin) continue;
    const version = Number(row.transaction_version);
    let tx = seenMovement.get(version);
    if (!tx) {
      const t = (await (await fetch(`${node.replace(/\/$/, "")}/transactions/by_version/${version}`, { signal: AbortSignal.timeout(10_000) })).json().catch(() => null)) as { hash?: string; sender?: string } | null;
      if (!t?.hash) continue;
      tx = { hash: t.hash, sender: t.sender ?? null };
      seenMovement.set(version, tx);
    }
    // A transfer it made to itself isn't money in.
    if (tx.sender && sameHex(tx.sender, address)) continue;
    const at = String(row.transaction_timestamp).endsWith("Z") ? row.transaction_timestamp : `${row.transaction_timestamp}Z`;
    out.push({ chain: "Movement", asset: coin, amount: Number(BigInt(String(row.amount))) / 1e6, from: tx.sender, tx: tx.hash, at: new Date(at).toISOString() });
  }
  return out;
}

async function solanaDeposits(owner: string): Promise<Deposit[]> {
  const url = env.SOLANA_RPC_URL;
  if (!url) return [];
  const out: Deposit[] = [];
  for (const [coin, mint] of Object.entries(SOL_MINTS) as [Coin, string][]) {
    const account = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner)).toBase58();
    const sigs = await rpc<{ signature: string; err: unknown; blockTime: number | null }[]>(url, "getSignaturesForAddress", [account, { limit: PER_CHAIN }]);
    for (const s of sigs ?? []) {
      if (s.err || (s.blockTime != null && s.blockTime * 1000 < Date.now() - SINCE_MS)) continue;
      const key = `${s.signature}:${coin}`;
      if (!seenSolana.has(key)) {
        const tx = await rpc<any>(url, "getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1 }]).catch(() => null);
        if (!tx) continue;
        const balance = (list: any[] | undefined, who: string) => BigInt(list?.find((b) => b.mint === mint && b.owner === who)?.uiTokenAmount?.amount ?? "0");
        const got = balance(tx.meta?.postTokenBalances, owner) - balance(tx.meta?.preTokenBalances, owner);
        const sender = (tx.meta?.preTokenBalances ?? []).find((b: any) => b.mint === mint && b.owner !== owner && balance(tx.meta?.postTokenBalances, b.owner) < BigInt(b.uiTokenAmount?.amount ?? "0"))?.owner ?? null;
        seenSolana.set(key, got > 0n ? { chain: "Solana", asset: coin, amount: Number(got) / 1e6, from: sender, tx: s.signature, at: new Date((s.blockTime ?? tx.blockTime ?? 0) * 1000).toISOString() } : null);
      }
      const d = seenSolana.get(key);
      if (d) out.push(d);
    }
  }
  return out;
}

async function stellarDeposits(solana: string): Promise<Deposit[]> {
  const address = stellarFromSolana(solana);
  if (!address) return [];
  const r = await fetch(`${env.STELLAR_HORIZON_URL ?? "https://horizon.stellar.org"}/accounts/${address}/payments?order=desc&limit=${PER_CHAIN}`, { signal: AbortSignal.timeout(15_000) });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`Horizon ${r.status}`);
  const body = (await r.json()) as any;
  const out: Deposit[] = [];
  for (const p of body?._embedded?.records ?? []) {
    if (p.transaction_successful === false || p.to !== address) continue;
    const coin = coinOfAsset(p.asset_code, p.asset_issuer);
    if (!coin) continue;
    out.push({ chain: "Stellar", asset: coin, amount: Number(stellarMicros(p.amount)) / 1e6, from: p.from ?? null, tx: p.transaction_hash, at: new Date(p.created_at).toISOString() });
  }
  return out;
}

/** Alchemy keeps every chain's transfer history: one call. Anything else: the recent blocks, a window at a time. */
async function evmDeposits(c: EvmChain, address: string): Promise<Deposit[]> {
  const url = c.url();
  if (!url) return [];
  const contracts = contractsOf(c);
  try {
    const r = await rpc<{ transfers?: any[] }>(url, "alchemy_getAssetTransfers", [
      {
        toAddress: address,
        category: c.native ? ["external", "erc20"] : ["erc20"],
        ...(c.native ? {} : { contractAddresses: contracts.map((t) => t.address) }),
        order: "desc",
        maxCount: toHex(PER_CHAIN),
        withMetadata: true,
        excludeZeroValue: true,
        fromBlock: "0x0",
      },
    ]);
    const out: Deposit[] = [];
    for (const t of r.transfers ?? []) {
      const at = t.metadata?.blockTimestamp ? new Date(t.metadata.blockTimestamp) : null;
      if (at && at.getTime() < Date.now() - SINCE_MS) continue;
      const token = t.rawContract?.address ? contracts.find((x) => sameHex(x.address, t.rawContract.address)) : null;
      const coin: Coin | null = token?.coin ?? (t.category === "external" && c.native ? c.native.coin : null);
      if (!coin) continue;
      const decimals = token?.decimals ?? c.native?.decimals ?? 6;
      const raw = t.rawContract?.value ? BigInt(t.rawContract.value) : 0n;
      out.push({ chain: c.network, asset: coin, amount: Number(toMicros(raw, decimals)) / 1e6, from: t.from ?? null, tx: t.hash, at: (at ?? new Date()).toISOString() });
    }
    return out;
  } catch {
    /* not Alchemy: the recent blocks instead */
  }
  const tip = hexNum(await rpc<string>(url, "eth_blockNumber", []));
  const topic = `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
  const out: Deposit[] = [];
  let end = tip;
  let step = 2_000;
  for (let windows = 0; windows < 12 && end > 0 && out.length < PER_CHAIN; ) {
    const start = Math.max(0, end - step + 1);
    let logs: { address: string; topics: string[]; data: string; transactionHash: string; blockNumber: string }[];
    try {
      logs = await rpc(url, "eth_getLogs", [{ address: contracts.map((t) => t.address), topics: [TRANSFER, null, topic], fromBlock: toHex(start), toBlock: toHex(end) }]);
    } catch (e) {
      // The provider's own limit when it says one ("up to a 10 block range"), else a tenth as wide.
      const said = Number(/(\d+)\s*block range/i.exec(e instanceof Error ? e.message : String(e))?.[1] ?? NaN);
      const next = Number.isFinite(said) && said > 0 && said < step ? said : Math.max(10, Math.floor(step / 10));
      if (next < step) {
        step = next;
        continue;
      }
      break;
    }
    windows++;
    for (const l of logs.reverse()) {
      const token = contracts.find((t) => sameHex(t.address, l.address));
      if (!token) continue;
      const block = await rpc<{ timestamp: string } | null>(url, "eth_getBlockByNumber", [l.blockNumber, false]).catch(() => null);
      out.push({ chain: c.network, asset: token.coin, amount: Number(toMicros(BigInt(l.data), token.decimals)) / 1e6, from: l.topics[1] ? `0x${l.topics[1].slice(-40)}` : null, tx: l.transactionHash, at: new Date(block ? hexNum(block.timestamp) * 1000 : Date.now()).toISOString() });
    }
    end = start - 1;
  }
  return out;
}

/** Recent deposits into the wallet on every chain it has an address on, newest first. */
export async function walletDeposits(w: { id: string; evmAddress: string | null; solanaAddress: string | null; movementAddress: string | null }, fresh = false): Promise<Deposit[]> {
  const hit = cache.get(w.id);
  if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.list;
  const jobs: Promise<Deposit[]>[] = [];
  if (w.movementAddress) jobs.push(movementDeposits(w.movementAddress));
  if (w.solanaAddress) jobs.push(solanaDeposits(w.solanaAddress), stellarDeposits(w.solanaAddress));
  if (w.evmAddress) for (const c of EVM_CHAINS) if (c.url()) jobs.push(evmDeposits(c, w.evmAddress));
  const parts = await Promise.all(jobs.map((j) => j.catch(() => [] as Deposit[])));
  const list = parts.flat().sort((a, b) => b.at.localeCompare(a.at));
  cache.set(w.id, { at: Date.now(), list });
  return list;
}
