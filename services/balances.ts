/**
 * Client-side on-chain balance fetcher.
 * On native: queries RPCs directly — no backend dependency.
 * On web: uses backend /wallet/balances to avoid CORS blocks from RPCs.
 */
import { Platform } from "react-native";
import { api } from "./api";
import { ARC_GAS_RESERVE } from "@/constants/transfer";
import { stellarBalances } from "./stellar";

// ─── Contract / Token addresses ─────────────────────────────
const MOVE_COIN_TYPE = "0x1::aptos_coin::AptosCoin";
// MOVE Fungible Asset metadata — must be the long form (64 hex)
// or the view function rejects with serialization errors.
const MOVE_FA_LONG = "0x000000000000000000000000000000000000000000000000000000000000000a";
const MOVE_USDC_METADATA = "0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39";
const MOVE_USDT_METADATA = "0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d";
const MOVE_USDCX_METADATA = "0xba11833544a2f99eec743f41a228ca6ffa7f13c3b6b04681d5a79a8b75ff225e";

const SOL_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

// Six decimals on both chains, where USDC and USDT are 6 on Base and 18 on
// BSC. Read off the contracts rather than assumed from the others.
const BASE_CNGN = "0x46C85152bFe9f96829aA94755D9f915F9B10EF5F";
const BSC_CNGN = "0xa8AEA66B361a8d53e8865c62D142167Af28Af058";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_USDT = "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2";

const BSC_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";

const ERC20_BALANCE_OF = "0x70a08231";

// ─── RPC URLs ───────────────────────────────────────────────
const MOVEMENT_RPC = "https://mainnet.movementnetwork.xyz/v1";
const MOVEMENT_INDEXER = "https://indexer.mainnet.movementnetwork.xyz/v1/graphql";
const SOLANA_RPC = "https://api.mainnet.solana.com";
const BASE_RPC = "https://mainnet.base.org";
const BSC_RPC = "https://bsc-dataseed1.ninicoin.io";
const ARB_RPC = "https://arb1.arbitrum.io/rpc";
// Arc, not Arbitrum above. One letter apart, both EVM.
const ARC_RPC = "https://rpc.mainnet.arc.io";
// Monad, chain 143. Its own public node, rate limited per caller - so per
// phone - and it takes batched calls.
const MONAD_RPC = "https://rpc.monad.xyz";
// Circle's USDC and Tether's USDT0, both six decimals. USDT0 is held as USDT.
const MONAD_USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const MONAD_USDT0 = "0xe7cd86e13AC4309349F30B3435a9d337750fC82D";
/** Tether USD on TON. The only jetton listed there. */
const TON_USDT_MASTER =
  "0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe";

/**
 * What is left on Arc once the part that can never move is taken off.
 *
 * Arc pays its fee in the same USDC being sent, so a balance at or under the
 * gas reserve cannot be sent, swapped or withdrawn - there is nothing left to
 * pay the fee with. A swap leaves exactly that behind, so after one the chain
 * sat in the holdings list showing 0.01 that no screen would let anybody
 * touch, and counted it in the total.
 *
 * Only the entirely-unusable case is dropped. A real balance is reported in
 * full: somebody holding five dollars has five dollars, and the reserve is
 * taken off at the point of sending, where it belongs.
 *
 * This does mean the app can show nothing while a block explorer shows a
 * fraction of a cent. That is the intended reading - it is a fee float, not a
 * holding.
 */
function usableOnArc(balance: number): number {
  return balance > ARC_GAS_RESERVE ? balance : 0;
}

/**
 * Somebody's USDT on TON.
 *
 * Unauthenticated, like the RPC calls above, and rate limited about as
 * gently - so a rejection is reported as a failure for this one pair rather
 * than thrown, and the caller falls back to the last known figure exactly as
 * it does when an RPC times out.
 */
async function tonUsdtBalance(owner: string): Promise<number> {
  const res = await fetch(
    `https://tonapi.io/v2/accounts/${encodeURIComponent(owner)}/jettons/${TON_USDT_MASTER}`,
  );
  // No jetton wallet yet, which is what an account that has never held USDT
  // looks like. Nought, not an error.
  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`TON balance unavailable (${res.status})`);
  const json = await res.json();
  return Number(BigInt(json?.balance ?? "0")) / 1e6;
}

// ─── Helpers ────────────────────────────────────────────────
async function jsonRpc(url: string, method: string, params: any[]): Promise<any> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (res.status === 429) {
        lastError = new Error("Too many requests");
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`RPC ${res.status}`);
      const json: any = await res.json();
      if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
      return json.result;
    } catch (err: any) {
      lastError = err;
      if (attempt < 2) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastError!;
}

/** Batch multiple eth_call requests into a single HTTP call */
async function batchErc20Balances(
  rpcUrl: string,
  tokens: { contract: string; decimals: number }[],
  walletAddress: string,
): Promise<(number | null)[]> {
  const calls = tokens.map((t, i) => ({
    jsonrpc: "2.0",
    id: i + 1,
    method: "eth_call",
    params: [{ to: t.contract, data: padAddress(walletAddress) }, "latest"],
  }));
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(calls),
  });
  if (!res.ok) throw new Error(`Batch RPC ${res.status}`);
  const results: any[] = await res.json();
  // Keyed by the id that was sent, never by position in the reply. A node that
  // drops one entry used to shift every later token onto the wrong decimals -
  // reading a six-decimal balance as an eighteen-decimal one.
  const byId = new Map<number, any>(results.map((r) => [r.id, r]));
  return tokens.map((t, i) => {
    const r = byId.get(i + 1);
    // Null, not zero. Zero is a balance; this is the absence of one, and the
    // caller keeps the last known figure rather than showing an empty wallet.
    if (!r || r.error || r.result == null) return null;
    return Number(BigInt(r.result)) / 10 ** t.decimals;
  });
}

/** Batch EVM: ERC-20 balances + native ETH in one HTTP round-trip */
async function batchEvmBalances(
  rpcUrl: string,
  tokens: { contract: string; decimals: number }[],
  walletAddress: string,
): Promise<{ tokenBalances: (number | null)[]; nativeBalance: number }> {
  const calls: any[] = tokens.map((t, i) => ({
    jsonrpc: "2.0",
    id: i + 1,
    method: "eth_call",
    params: [{ to: t.contract, data: padAddress(walletAddress) }, "latest"],
  }));
  // Append native balance as last call
  const nativeId = tokens.length + 1;
  calls.push({
    jsonrpc: "2.0",
    id: nativeId,
    method: "eth_getBalance",
    params: [walletAddress, "latest"],
  });
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(calls),
  });
  if (!res.ok) throw new Error(`Batch RPC ${res.status}`);
  const results: any[] = await res.json();
  const byId = new Map<number, any>(results.map((r) => [r.id, r]));
  const tokenBalances = tokens.map((t, i) => {
    const r = byId.get(i + 1);
    // Null, not zero - see batchErc20Balances above.
    if (!r || r.error || r.result == null) return null;
    return Number(BigInt(r.result)) / 10 ** t.decimals;
  });
  const nativeRes = byId.get(nativeId);
  const nativeBalance = nativeRes?.error ? 0 : Number(BigInt(nativeRes?.result || "0x0")) / 1e18;
  return { tokenBalances, nativeBalance };
}

function padAddress(walletAddress: string): string {
  return "0x" + ERC20_BALANCE_OF.slice(2) + walletAddress.slice(2).toLowerCase().padStart(64, "0");
}

async function erc20Balance(rpcUrl: string, tokenContract: string, walletAddress: string, decimals: number): Promise<number> {
  const data = padAddress(walletAddress);
  const raw = await jsonRpc(rpcUrl, "eth_call", [{ to: tokenContract, data }, "latest"]);
  const wei = BigInt(raw || "0x0");
  return Number(wei) / 10 ** decimals;
}

async function nativeEvmBalance(rpcUrl: string, walletAddress: string): Promise<number> {
  const raw = await jsonRpc(rpcUrl, "eth_getBalance", [walletAddress, "latest"]);
  const wei = BigInt(raw || "0x0");
  return Number(wei) / 1e18;
}

// ─── Movement ───────────────────────────────────────────────
/** MOVE held as legacy Coin (CoinStore<AptosCoin>). */
async function getMovementMoveCoinBalance(address: string): Promise<number> {
  try {
    const res = await fetch(`${MOVEMENT_RPC}/accounts/${address}/resources`);
    if (!res.ok) return 0;
    const resources: any[] = await res.json();
    const coinStore = resources.find(
      (r: any) => r.type === `0x1::coin::CoinStore<${MOVE_COIN_TYPE}>`
    );
    if (!coinStore) return 0;
    return Number(coinStore.data.coin.value) / 1e8;
  } catch {
    return 0;
  }
}

/** MOVE held as Fungible Asset (primary_fungible_store at 0xa). */
async function getMovementMoveFaBalance(address: string): Promise<number> {
  try {
    const res = await fetch(`${MOVEMENT_RPC}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        function: "0x1::primary_fungible_store::balance",
        type_arguments: ["0x1::fungible_asset::Metadata"],
        arguments: [address, MOVE_FA_LONG],
      }),
    });
    if (!res.ok) return 0;
    const data = (await res.json()) as unknown[];
    const octas = parseInt(String(data?.[0] ?? "0"), 10);
    if (isNaN(octas) || octas <= 0) return 0;
    return octas / 1e8;
  } catch {
    return 0;
  }
}

/** Total spendable MOVE = legacy Coin + Fungible Asset (chain auto-pairs them). */
async function getMovementMoveBalance(address: string): Promise<number> {
  const [coin, fa] = await Promise.allSettled([
    getMovementMoveCoinBalance(address),
    getMovementMoveFaBalance(address),
  ]);
  const coinVal = coin.status === "fulfilled" ? coin.value : 0;
  const faVal = fa.status === "fulfilled" ? fa.value : 0;
  return coinVal + faVal;
}

async function getMovementUsdcBalance(address: string): Promise<number> {
  const query = `
    query GetFungibleAssetBalance($address: String!, $assetType: String!) {
      current_fungible_asset_balances(
        where: {
          owner_address: { _eq: $address },
          asset_type: { _eq: $assetType }
        }
      ) { amount }
    }
  `;
  const res = await fetch(MOVEMENT_INDEXER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { address, assetType: MOVE_USDC_METADATA } }),
  });
  if (!res.ok) throw new Error(`Movement indexer ${res.status}`);
  const json: any = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message || "GraphQL error");
  const balances = json?.data?.current_fungible_asset_balances;
  if (!balances || balances.length === 0) return 0;
  return Number(balances[0].amount) / 1e6;
}

async function getMovementUsdcxBalance(address: string): Promise<number> {
  const query = `
    query GetFungibleAssetBalance($address: String!, $assetType: String!) {
      current_fungible_asset_balances(
        where: {
          owner_address: { _eq: $address },
          asset_type: { _eq: $assetType }
        }
      ) { amount }
    }
  `;
  const res = await fetch(MOVEMENT_INDEXER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { address, assetType: MOVE_USDCX_METADATA } }),
  });
  if (!res.ok) throw new Error(`Movement indexer ${res.status}`);
  const json: any = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message || "GraphQL error");
  const balances = json?.data?.current_fungible_asset_balances;
  if (!balances || balances.length === 0) return 0;
  return Number(balances[0].amount) / 1e6;
}

async function getMovementUsdtBalance(address: string): Promise<number> {
  const query = `
    query GetFungibleAssetBalance($address: String!, $assetType: String!) {
      current_fungible_asset_balances(
        where: {
          owner_address: { _eq: $address },
          asset_type: { _eq: $assetType }
        }
      ) { amount }
    }
  `;
  const res = await fetch(MOVEMENT_INDEXER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { address, assetType: MOVE_USDT_METADATA } }),
  });
  if (!res.ok) throw new Error(`Movement indexer ${res.status}`);
  const json: any = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message || "GraphQL error");
  const balances = json?.data?.current_fungible_asset_balances;
  if (!balances || balances.length === 0) return 0;
  return Number(balances[0].amount) / 1e6;
}

// ─── Solana ─────────────────────────────────────────────────
async function getSolanaNativeBalance(walletAddress: string): Promise<number> {
  const result = await jsonRpc(SOLANA_RPC, "getBalance", [walletAddress]);
  return (result?.value ?? 0) / 1e9;
}

/** Fetch ALL SPL token balances in one call, return map of mint → uiAmount */
async function getAllSolanaTokenBalances(walletAddress: string): Promise<Map<string, number>> {
  const result = await jsonRpc(SOLANA_RPC, "getTokenAccountsByOwner", [
    walletAddress,
    { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
    { encoding: "jsonParsed" },
  ]);
  const map = new Map<string, number>();
  if (!result?.value) return map;
  for (const acct of result.value) {
    const info = acct?.account?.data?.parsed?.info;
    if (info?.mint) map.set(info.mint, Number(info.tokenAmount?.uiAmount || 0));
  }
  return map;
}

// ─── Public API ─────────────────────────────────────────────
export interface ChainBalance {
  asset: string;
  chain: string;
  balance: number;
}

/**
 * Fetch all on-chain balances directly from RPCs.
 * Only updates balances for chains that successfully respond.
 * Pass previousBalances so failed chains keep their last-known value.
 */
/**
 * The balance, or a failure.
 *
 * `fetchOnChainBalances` keeps the last known figure when a read rejects, and
 * has no way to tell a genuine zero from a call the node refused. Turning the
 * absence into a rejection is what stops a balance flickering to zero and back
 * every time one call in a batch is throttled.
 */
function need(v: number | null, what: string): number {
  if (v == null) throw new Error(`balance unavailable: ${what}`);
  return v;
}

export async function fetchOnChainBalances(
  addresses: Record<string, string>,
  previousBalances: ChainBalance[] = [],
): Promise<{ balances: ChainBalance[]; totals: Record<string, number> }> {
  // On web, many RPC endpoints (Solana, etc.) block browser requests (CORS).
  // Use the backend /wallet/balances endpoint which proxies through the server.
  if (Platform.OS === "web") {
    try {
      const { data } = await api.get("/wallet/balances");
      const balances: ChainBalance[] = (data.wallets || []).map((w: any) => ({
        asset: w.asset,
        chain: w.chain,
        balance: Number(w.balance),
      }));
      const totals: Record<string, number> = data.totals || {};
      return { balances, totals };
    } catch (err) {
      console.warn("[BALANCES] Backend fetch failed on web, falling back to previous:", err);
      return { balances: previousBalances, totals: {} };
    }
  }

  const jobs: { key: string; p: Promise<ChainBalance> }[] = [];

  const moveAddr = addresses.MOVE;
  const solAddr = addresses.SOL;
  const evmAddr = addresses.BASE || addresses.BEP20 || addresses.ARB || addresses.ARC;

  if (moveAddr) {
    jobs.push({ key: "MOVE-MOVE", p: getMovementMoveBalance(moveAddr).then(balance => ({ asset: "MOVE", chain: "MOVE", balance })) });
    jobs.push({ key: "USDC-MOVE", p: getMovementUsdcBalance(moveAddr).then(balance => ({ asset: "USDC", chain: "MOVE", balance })) });
    jobs.push({ key: "USDT-MOVE", p: getMovementUsdtBalance(moveAddr).then(balance => ({ asset: "USDT", chain: "MOVE", balance })) });
    jobs.push({ key: "USDCx-MOVE", p: getMovementUsdcxBalance(moveAddr).then(balance => ({ asset: "USDCx", chain: "MOVE", balance })) });
  }

  if (solAddr) {
    // 2 calls: native SOL + all SPL tokens in one shot
    jobs.push({ key: "SOL-SOL", p: getSolanaNativeBalance(solAddr).then(balance => ({ asset: "SOL", chain: "SOL", balance })) });
    const splPromise = getAllSolanaTokenBalances(solAddr);
    jobs.push({ key: "USDC-SOL", p: splPromise.then(m => ({ asset: "USDC", chain: "SOL", balance: m.get(SOL_USDC_MINT) || 0 })) });
    jobs.push({ key: "USDT-SOL", p: splPromise.then(m => ({ asset: "USDT", chain: "SOL", balance: m.get(SOL_USDT_MINT) || 0 })) });
  }

  if (evmAddr) {
    // Batch Base USDC + USDT + cNGN + native ETH into a single HTTP request.
    // The index each token is read back at is its position in this array, so
    // anything appended here must be appended to the reads below too.
    const baseBatch = batchEvmBalances(BASE_RPC, [
      { contract: BASE_USDC, decimals: 6 },
      { contract: BASE_USDT, decimals: 6 },
      { contract: BASE_CNGN, decimals: 6 },
    ], evmAddr);
    jobs.push({ key: "USDC-BASE", p: baseBatch.then(b => ({ asset: "USDC", chain: "BASE", balance: need(b.tokenBalances[0], "USDC on Base") })) });
    jobs.push({ key: "USDT-BASE", p: baseBatch.then(b => ({ asset: "USDT", chain: "BASE", balance: need(b.tokenBalances[1], "USDT on Base") })) });
    jobs.push({ key: "cNGN-BASE", p: baseBatch.then(b => ({ asset: "cNGN", chain: "BASE", balance: need(b.tokenBalances[2], "cNGN on Base") })) });
    // Batch BSC USDC + USDT + cNGN into a single RPC call for speed
    const bscBatchPromise = batchErc20Balances(BSC_RPC, [
      { contract: BSC_USDC, decimals: 18 },
      { contract: BSC_USDT, decimals: 18 },
      { contract: BSC_CNGN, decimals: 6 },
    ], evmAddr);
    jobs.push({ key: "USDC-BEP20", p: bscBatchPromise.then(b => ({ asset: "USDC", chain: "BEP20", balance: need(b[0], "USDC on BSC") })) });
    jobs.push({ key: "USDT-BEP20", p: bscBatchPromise.then(b => ({ asset: "USDT", chain: "BEP20", balance: need(b[1], "USDT on BSC") })) });
    jobs.push({ key: "cNGN-BEP20", p: bscBatchPromise.then(b => ({ asset: "cNGN", chain: "BEP20", balance: need(b[2], "cNGN on BSC") })) });

    /**
     * Arc, read as the native balance because that is what USDC is there.
     *
     * The ERC-20 at 0x3600…0000 is the same money seen through a contract, and
     * it reports SIX decimals where the native balance reports eighteen. Read
     * both and every Arc holder sees double; read the token and divide by the
     * wrong power and the figure is out by a million million. One read, from
     * the chain's own balance.
     */
    jobs.push({
      key: "USDC-ARC",
      p: nativeEvmBalance(ARC_RPC, evmAddr).then(balance => ({
        asset: "USDC" as const,
        chain: "ARC" as const,
        balance: usableOnArc(balance),
      })),
    });

    // Monad: both coins in one batched call.
    const monadBatch = batchErc20Balances(MONAD_RPC, [
      { contract: MONAD_USDC, decimals: 6 },
      { contract: MONAD_USDT0, decimals: 6 },
    ], evmAddr);
    jobs.push({ key: "USDC-MONAD", p: monadBatch.then(b => ({ asset: "USDC", chain: "MONAD", balance: need(b[0], "USDC on Monad") })) });
    jobs.push({ key: "USDT-MONAD", p: monadBatch.then(b => ({ asset: "USDT", chain: "MONAD", balance: need(b[1], "USDT0 on Monad") })) });
  }

  /**
   * TON, read through an indexer rather than an RPC.
   *
   * Every other chain here answers a balance question directly. TON holds a
   * jetton balance in a contract of its own per holder, so reading it means
   * knowing that contract's address first - two round trips, or one to an
   * indexer that already knows. The indexer.
   *
   * USDT only. USDC is not issued on TON at all.
   */
  if (addresses.TON) {
    jobs.push({
      key: "USDT-TON",
      p: tonUsdtBalance(addresses.TON).then(balance => ({
        asset: "USDT" as const,
        chain: "TON" as const,
        balance,
      })),
    });
  }

  /**
   * Stellar: one Horizon read for both coins.
   *
   * An account that has never been opened answers 404, which reads as zero of
   * each rather than an error - so users who have not turned Stellar on pay a
   * single cheap request and see nothing. A real failure rejects, and the
   * last-known figure stands like every other chain here.
   */
  if (addresses.STELLAR) {
    const stellarRead = stellarBalances(addresses.STELLAR);
    jobs.push({ key: "USDC-STELLAR", p: stellarRead.then(b => ({ asset: "USDC", chain: "STELLAR", balance: b.USDC })) });
    jobs.push({ key: "USDT-STELLAR", p: stellarRead.then(b => ({ asset: "USDT", chain: "STELLAR", balance: b.USDT })) });
  }

  const results = await Promise.allSettled(jobs.map(j => j.p));

  // Build a map of previous balances for fallback
  const prevMap = new Map<string, ChainBalance>();
  for (const b of previousBalances) {
    prevMap.set(`${b.asset}-${b.chain}`, b);
  }

  // Merge: use fresh value on success, keep previous on failure
  const balances: ChainBalance[] = [];
  for (let i = 0; i < jobs.length; i++) {
    const r = results[i];
    const key = jobs[i].key;
    if (r.status === "fulfilled") {
      balances.push(r.value);
    } else {
      // RPC failed — keep last-known balance
      const prev = prevMap.get(key);
      if (prev) balances.push(prev);
      // else: no previous data, skip (will appear as 0 in totals)
    }
  }

  // Aggregate totals per asset
  const totals: Record<string, number> = {};
  for (const b of balances) {
    totals[b.asset] = (totals[b.asset] || 0) + b.balance;
  }

  return { balances, totals };
}
