/**
 * Our own wallets on the app side, for the admin console's Crypto page: what
 * each one is for, its address, and what it holds on every chain it uses,
 * read live from the chains. The keys never leave this file, only the
 * addresses they open, so the page is how to check a wallet after its key has
 * been replaced, or whether a treasury needs topping up.
 *
 * Read-only. Nothing here signs or sends.
 */
import { ethers } from "ethers";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { env } from "../config/env";
import { fetchAllBalances, getOnChainBalance, type ChainAddresses } from "./balances";
import { horizon, sellAddress as stellarSellAddress, treasuryAddress as stellarTreasuryAddress } from "./stellar";
import { getTonBalance } from "./ton";
import { voucherTreasuryAddress } from "./voucher-treasury";
import { voucherEscrowAddress } from "./voucher-escrow";

export type Holding = { chain: string; asset: string; amount: number | null };
export type WalletGroup = "treasury" | "gas" | "vouchers" | "sell";
export type OurWallet = {
  id: string;
  group: WalletGroup;
  name: string;
  does: string;
  address: string | null;
  /** Why there's no address: no key set, or one that can't be read. */
  missing: string | null;
  holdings: Holding[];
};

const CHAIN_NAME: Record<string, string> = { MOVE: "Movement", SOL: "Solana", BASE: "Base", BEP20: "BNB Chain", ARB: "Arbitrum", MONAD: "Monad", ARC: "Arc", TON: "TON", STELLAR: "Stellar" };
const chainName = (c: string) => CHAIN_NAME[c] ?? c;

const evmAddress = (key: string) => new ethers.Wallet(key).address;
const solanaAddress = (key: string) => Keypair.fromSecretKey(bs58.decode(key)).publicKey.toBase58();

/** A key turned into its address, or why it couldn't be. */
function open(key: string | undefined, toAddress: (k: string) => string): { address: string | null; missing: string | null } {
  if (!key) return { address: null, missing: "No key set" };
  try {
    return { address: toAddress(key), missing: null };
  } catch {
    return { address: null, missing: "The key can't be read" };
  }
}
const given = (address: string | null | undefined) => (address ? { address, missing: null } : { address: null, missing: "No address set" });

/** A chain's own coin on an EVM network, for gas. */
async function evmNative(url: string, address: string): Promise<number | null> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }) });
    const j = (await r.json()) as { result?: string };
    return j.result ? Number(BigInt(j.result)) / 1e18 : null;
  } catch {
    return null;
  }
}

async function xlm(address: string): Promise<number | null> {
  try {
    const account = await horizon.loadAccount(address);
    const native = account.balances.find((b) => b.asset_type === "native");
    return native ? Number(native.balance) : 0;
  } catch (e: any) {
    return e?.response?.status === 404 ? 0 : null;
  }
}

/** Never longer than this for one wallet: a slow chain shows as unreadable, not as a page that never loads. */
function capped<T>(p: Promise<T>, fallback: T, ms = 15_000): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

const tokens = async (addresses: ChainAddresses): Promise<Holding[]> =>
  (await capped(fetchAllBalances(addresses), [])).map((b) => ({ chain: chainName(b.chain), asset: b.asset, amount: b.balance }));

const EVM_GAS: [string, string, () => string][] = [
  ["Base", "ETH", () => env.BASE_RPC_URL],
  ["BNB Chain", "BNB", () => env.BSC_RPC_URL],
  ["Arbitrum", "ETH", () => env.ARB_RPC_URL],
  ["Monad", "MON", () => env.MONAD_RPC_URL],
];
const evmGas = (address: string): Promise<Holding[]> =>
  Promise.all(EVM_GAS.map(async ([chain, asset, url]) => ({ chain, asset, amount: await capped(evmNative(url(), address), null) })));

async function holdingsFor(kind: "evm" | "solana" | "movement" | "stellar" | "ton", address: string, withTokens = true): Promise<Holding[]> {
  if (kind === "evm") return [...(await evmGas(address)), ...(withTokens ? await tokens({ evm: address, monad: address }) : [])];
  if (kind === "solana") {
    const sol = await capped(getOnChainBalance("SOL", "SOL", address).catch(() => null), null);
    return [{ chain: "Solana", asset: "SOL", amount: sol }, ...(withTokens ? await tokens({ solana: address }) : [])];
  }
  if (kind === "movement") return tokens({ movement: address });
  if (kind === "stellar") return [{ chain: "Stellar", asset: "XLM", amount: await capped(xlm(address), null) }, ...(await tokens({ stellar: address }))];
  return [{ chain: "TON", asset: "TON", amount: await capped(getTonBalance(address).catch(() => null), null) }, ...(await tokens({ ton: address }))];
}

type Plan = Omit<OurWallet, "holdings" | "address" | "missing"> & { at: { address: string | null; missing: string | null }; kind: "evm" | "solana" | "movement" | "stellar" | "ton"; withTokens?: boolean };

/** An address helper that may throw on a malformed key: one bad key shows as its own row, not a failed page. */
const tryAddress = (f: () => string | null): string | null => {
  try {
    return f();
  } catch {
    return null;
  }
};

function plan(): Plan[] {
  const stellarTreasury = tryAddress(stellarTreasuryAddress);
  const stellarSell = tryAddress(stellarSellAddress);
  return [
    { id: "evm_treasury", group: "treasury", name: "EVM treasury", does: "Pays out USDC and USDT on Base, BNB Chain, Arbitrum, Monad and Arc.", kind: "evm", at: open(env.EVM_TREASURY_PRIVATE_KEY, evmAddress) },
    { id: "solana_treasury", group: "treasury", name: "Solana treasury", does: "Pays out USDC and USDT on Solana.", kind: "solana", at: open(env.SOLANA_TREASURY_PRIVATE_KEY, solanaAddress) },
    { id: "movement_treasury", group: "treasury", name: "Movement treasury", does: "Pays out on Movement.", kind: "movement", at: given(env.MOVEMENT_TREASURY_ADDRESS) },
    { id: "stellar_treasury", group: "treasury", name: "Stellar treasury", does: "Opens Stellar for people and pays out there. Needs XLM for each account it opens.", kind: "stellar", at: given(stellarTreasury) },
    { id: "evm_gas", group: "gas", name: "EVM gas sponsor", does: "Tops up gas so people can send from their wallets.", kind: "evm", withTokens: false, at: open(env.EVM_GAS_SPONSOR_PRIVATE_KEY, evmAddress) },
    { id: "solana_gasless", group: "gas", name: "Solana fee payer", does: "Pays Solana fees, so people send without holding SOL.", kind: "solana", withTokens: false, at: open(env.SOLANA_GASLESS_PRIVATE_KEY, solanaAddress) },
    { id: "voucher_treasury", group: "vouchers", name: "Voucher treasury", does: "Pays voucher rewards.", kind: "movement", at: given(voucherTreasuryAddress()) },
    { id: "voucher_escrow", group: "vouchers", name: "Voucher escrow", does: "Holds money people put into vouchers until they're claimed.", kind: "movement", at: given(voucherEscrowAddress()) },
    { id: "sell_evm", group: "sell", name: "EVM", does: "Where people send to sell on Base, BNB Chain, Arbitrum, Monad and Arc.", kind: "evm", at: given(env.SELL_EVM_ADDRESS) },
    { id: "sell_solana", group: "sell", name: "Solana", does: "Where people send to sell on Solana.", kind: "solana", at: given(env.SELL_SOLANA_ADDRESS) },
    { id: "sell_movement", group: "sell", name: "Movement", does: "Where people send to sell on Movement.", kind: "movement", at: given(env.SELL_MOVEMENT_ADDRESS) },
    ...(stellarSell && stellarSell !== stellarTreasury ? [{ id: "sell_stellar", group: "sell" as const, name: "Stellar", does: "Where people send to sell on Stellar.", kind: "stellar" as const, at: given(stellarSell) }] : []),
    { id: "sell_ton", group: "sell", name: "TON", does: "Where people send USDT to sell on TON.", kind: "ton", at: given(env.SELL_TON_ADDRESS) },
  ];
}

let cache: { at: number; wallets: OurWallet[] } | null = null;

/** Every wallet, read live. Kept for 30 seconds, so a busy console doesn't run up the chains' rate limits. */
export async function ourWallets(fresh = false): Promise<{ wallets: OurWallet[]; readAt: string }> {
  if (!fresh && cache && Date.now() - cache.at < 30_000) return { wallets: cache.wallets, readAt: new Date(cache.at).toISOString() };
  const wallets = await Promise.all(
    plan().map(async (p): Promise<OurWallet> => ({
      id: p.id,
      group: p.group,
      name: p.name,
      does: p.does,
      address: p.at.address,
      missing: p.at.missing,
      holdings: p.at.address ? await holdingsFor(p.kind, p.at.address, p.withTokens ?? true).catch(() => []) : [],
    })),
  );
  cache = { at: Date.now(), wallets };
  return { wallets, readAt: new Date(cache.at).toISOString() };
}
