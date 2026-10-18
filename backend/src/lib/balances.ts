/**
 * On-chain balance fetcher for all supported chains.
 *
 * Movement: REST API for MOVE native, GraphQL indexer for USDC fungible asset
 * Solana:   JSON-RPC for SPL token balances (USDC, USDT)
 * Base:     ethers.js ERC-20 balanceOf for USDC/USDT, native ETH
 * BSC:      ethers.js BEP-20 balanceOf for USDC/USDT
 * Arbitrum: native ETH balance
 */
import { env } from "../config/env";
import * as ton from "./ton";
import * as stellar from "./stellar";

// ═══════════════════════════════════════════════════════════
//  CONTRACT / TOKEN ADDRESSES
// ═══════════════════════════════════════════════════════════

// Movement
const MOVE_COIN_TYPE = "0x1::aptos_coin::AptosCoin";
// MOVE Fungible Asset metadata address — must be the long form (64 hex)
// or view-function calls reject with serialization errors.
const MOVE_FA_LONG = "0x000000000000000000000000000000000000000000000000000000000000000a";
const MOVE_USDC_METADATA = "0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39";
const MOVE_USDT_METADATA = "0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d";
// Circle-issued USDCx on Movement mainnet (verified). Same 6 decimals as USDC.
const MOVE_USDCX_METADATA = "0xba11833544a2f99eec743f41a228ca6ffa7f13c3b6b04681d5a79a8b75ff225e";

// Solana SPL token mints
const SOL_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

// Base ERC-20 contracts
// cNGN is six decimals on both chains, where USDC and USDT are 6 on Base and
// 18 on BSC. Read off the contracts rather than assumed from the others.
const BASE_CNGN = "0x46C85152bFe9f96829aA94755D9f915F9B10EF5F";
const BSC_CNGN = "0xa8AEA66B361a8d53e8865c62D142167Af28Af058";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_USDT = "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2";

// BSC BEP-20 contracts
const BSC_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";

/**
 * USDC on Arc, as a token. The SAME money as the native balance.
 *
 * Arc's own currency is USDC, and this contract - Circle's NativeFiatTokenV2_2
 * at a precompile-style address - is a view over it rather than a separate
 * holding. Reading both would show everybody twice what they have, which is
 * why nothing reads this for balances; nativeEvmBalance is the single source.
 *
 * It is recorded because incoming transfers can arrive either way: a native
 * value send leaves no log, an ERC-20 send emits a Transfer against this
 * address, and anything watching Arc for deposits has to know both shapes.
 *
 * THE DECIMALS DISAGREE, AND THAT IS NOT A MISTAKE. The native balance is 18
 * decimals; this contract reports 6. Same amount of money, expressed a million
 * million apart - so a figure read from one and sent through the other without
 * converting is wrong by 10^12.
 */
const ARC_USDC_ERC20 = "0x3600000000000000000000000000000000000000";
const ARC_USDC_ERC20_DECIMALS = 6;
const ARC_NATIVE_DECIMALS = 18;
const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";

/**
 * Monad's two dollars, both ERC-20s at six decimals (checked against the
 * contracts' own decimals() and symbol()). USDT0 is Tether's USDT there and is
 * held under the USDT key, as it is on Stellar.
 */
const MONAD_USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const MONAD_USDT0 = "0xe7cd86e13AC4309349F30B3435a9d337750fC82D";

// ERC-20 ABI fragment for balanceOf + decimals
const ERC20_BALANCE_OF = "0x70a08231"; // balanceOf(address)

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * A missing answer is not an answer of zero.
 *
 * `BigInt(raw || "0x0")` read an absent result as an empty wallet. Under load a
 * gateway can return `result: null` on a 200, and the public Base endpoint is
 * under load constantly - it rate-limits with a JSON-RPC error on a 200 response
 * rather than an HTTP 429. Every one of those wrote a zero balance over a real
 * one, the next good read put it back, and that is the flicker.
 *
 * Worse than the flicker: the sync hands the balance it reads to the external
 * deposit detector, so the read that restored the figure looked like money
 * arriving from outside.
 *
 * Throwing instead means fetchAllBalances drops that one asset - it uses
 * allSettled - and the stored balance is simply left as it was. A balance we
 * could not read this second keeps its last known value, which is true, rather
 * than becoming zero, which is not.
 */
function hexQuantity(raw: unknown, what: string): bigint {
  if (typeof raw !== "string" || !/^0x[0-9a-fA-F]+$/.test(raw)) {
    throw new Error(`Bad RPC result for ${what}: ${JSON.stringify(raw)}`);
  }
  return BigInt(raw);
}

async function jsonRpc(url: string, method: string, params: any[]): Promise<any> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (res.status === 429) {
        lastError = new Error("Too many requests for a specific RPC call");
        // exponential back-off: 1s, 2s, 4s
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
      const json: any = await res.json();
      /**
       * Rate limiting does not always arrive as a 429.
       *
       * mainnet.base.org answers 200 with `{"error":{"code":-32016,"message":
       * "over rate limit"}}`, which fell through to the generic throw below and
       * spent a retry on an immediate re-ask. Treated as what it is, it gets
       * the same exponential back-off as a 429.
       */
      const rateLimited =
        json.error &&
        (json.error.code === -32016 || /rate limit|too many/i.test(String(json.error.message ?? "")));
      if (rateLimited) {
        lastError = new Error(`RPC rate limited: ${json.error.message}`);
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
      return json.result;
    } catch (err: any) {
      lastError = err;
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw lastError!;
}

/**
 * Every token on one chain, in a single request.
 *
 * Three separate eth_calls per chain was six requests a refresh across Base and
 * BSC, and the public nodes rate-limit on exactly that. The retry in jsonRpc
 * hid it for a while by spending seven seconds of back-off before giving up -
 * so a balance read failed slowly rather than quickly, and the log said "too
 * many requests" about a call nobody thought was excessive.
 *
 * Replies are matched by the id that was SENT, never by position. A node that
 * drops one entry would otherwise shift every later token onto the wrong
 * decimals, and reading a six-decimal balance as an eighteen-decimal one is
 * not a small error.
 *
 * A token that comes back missing is null rather than zero. Zero is a balance;
 * this is the absence of one, and the caller should keep what it had rather
 * than show an empty wallet.
 */
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

  const results = (await res.json()) as any[];
  const byId = new Map<number, any>(
    (Array.isArray(results) ? results : []).map((r: any) => [r?.id, r]),
  );
  return tokens.map((t, i) => {
    const r = byId.get(i + 1);
    if (!r || r.error || r.result == null) return null;
    return Number(BigInt(r.result)) / 10 ** t.decimals;
  });
}

/** Pad an EVM address to 32 bytes for ABI encoding */
function padAddress(address: string): string {
  return "0x" + ERC20_BALANCE_OF.slice(2) + address.slice(2).toLowerCase().padStart(64, "0");
}

/** Call ERC-20 balanceOf and return human-readable balance */
async function erc20Balance(rpcUrl: string, tokenContract: string, walletAddress: string, decimals: number): Promise<number> {
  const data = padAddress(walletAddress);
  const raw = await jsonRpc(rpcUrl, "eth_call", [
    { to: tokenContract, data },
    "latest",
  ]);
  return Number(hexQuantity(raw, `${tokenContract} balanceOf`)) / 10 ** decimals;
}

/** Get native ETH/BNB balance */
async function nativeEvmBalance(rpcUrl: string, walletAddress: string): Promise<number> {
  const raw = await jsonRpc(rpcUrl, "eth_getBalance", [walletAddress, "latest"]);
  return Number(hexQuantity(raw, "eth_getBalance")) / 1e18;
}

// ═══════════════════════════════════════════════════════════
//  MOVEMENT BALANCES
// ═══════════════════════════════════════════════════════════

/**
 * Fetch MOVE held as legacy Coin via the resource API.
 *
 * A failed read throws rather than answering zero. Zero was written over the
 * stored balance, and the next good read then looked like the whole balance
 * arriving - a "Crypto Received" for money that had been there all along. Only
 * a 404, an account the chain has never seen, is genuinely nothing.
 */
async function getMovementMoveCoinBalance(address: string): Promise<number> {
  const url = `${env.MOVEMENT_RPC_URL}/accounts/${address}/resources`;
  const res = await fetch(url);
  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`Movement resources ${res.status}`);
  const resources = (await res.json()) as any[];
  const coinStore = resources.find(
    (r: any) => r.type === `0x1::coin::CoinStore<${MOVE_COIN_TYPE}>`
  );
  if (!coinStore) return 0;
  return Number(coinStore.data.coin.value) / 1e8;
}

/** Fetch MOVE held as Fungible Asset via the view function at 0xa. */
/** Fetch MOVE held as Fungible Asset via the view function at 0xa. Throws on a failed read, like the Coin half. */
async function getMovementMoveFaBalance(address: string): Promise<number> {
  const res = await fetch(`${env.MOVEMENT_RPC_URL}/view`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      function: "0x1::primary_fungible_store::balance",
      type_arguments: ["0x1::fungible_asset::Metadata"],
      arguments: [address, MOVE_FA_LONG],
    }),
  });
  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`Movement view ${res.status}`);
  const data = (await res.json()) as unknown[];
  const octas = parseInt(String(data?.[0] ?? "0"), 10);
  if (isNaN(octas) || octas <= 0) return 0;
  return octas / 1e8;
}

/**
 * Total spendable MOVE = legacy Coin + Fungible Asset.
 * Both forms coexist post-FA migration; the chain auto-pairs them at transfer time.
 *
 * Both halves or nothing. Either one failing used to count as zero, so the
 * total came out short, was written down as the balance, and the next full
 * read reported the missing half as a deposit. Throwing lets the caller keep
 * the figure it already had.
 */
async function getMovementMoveBalance(address: string): Promise<number> {
  const [coinVal, faVal] = await Promise.all([
    getMovementMoveCoinBalance(address),
    getMovementMoveFaBalance(address),
  ]);
  return coinVal + faVal;
}

/** Fetch USDC balance on Movement via GraphQL indexer */
async function getMovementUsdcBalance(address: string): Promise<number> {
  const query = `
    query GetFungibleAssetBalance($address: String!, $assetType: String!) {
      current_fungible_asset_balances(
        where: {
          owner_address: { _eq: $address },
          asset_type: { _eq: $assetType }
        }
      ) {
        amount
      }
    }
  `;
  const res = await fetch(env.MOVEMENT_INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      variables: { address, assetType: MOVE_USDC_METADATA },
    }),
  });
  if (!res.ok) throw new Error(`Movement indexer ${res.status}`);
  const json: any = await res.json();
  if (json.errors) throw new Error("Movement indexer GraphQL error");
  const balances = json?.data?.current_fungible_asset_balances;
  if (!balances || balances.length === 0) return 0;
  return Number(balances[0].amount) / 1e6;
}

/** Fetch USDCx balance on Movement via GraphQL indexer */
async function getMovementUsdcxBalance(address: string): Promise<number> {
  const query = `
    query GetFungibleAssetBalance($address: String!, $assetType: String!) {
      current_fungible_asset_balances(
        where: {
          owner_address: { _eq: $address },
          asset_type: { _eq: $assetType }
        }
      ) {
        amount
      }
    }
  `;
  const res = await fetch(env.MOVEMENT_INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      variables: { address, assetType: MOVE_USDCX_METADATA },
    }),
  });
  if (!res.ok) throw new Error(`Movement indexer ${res.status}`);
  const json: any = await res.json();
  if (json.errors) throw new Error("Movement indexer GraphQL error");
  const balances = json?.data?.current_fungible_asset_balances;
  if (!balances || balances.length === 0) return 0;
  return Number(balances[0].amount) / 1e6;
}

/** Fetch USDT balance on Movement via GraphQL indexer */
async function getMovementUsdtBalance(address: string): Promise<number> {
  const query = `
    query GetFungibleAssetBalance($address: String!, $assetType: String!) {
      current_fungible_asset_balances(
        where: {
          owner_address: { _eq: $address },
          asset_type: { _eq: $assetType }
        }
      ) {
        amount
      }
    }
  `;
  const res = await fetch(env.MOVEMENT_INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      variables: { address, assetType: MOVE_USDT_METADATA },
    }),
  });
  if (!res.ok) throw new Error(`Movement indexer ${res.status}`);
  const json: any = await res.json();
  if (json.errors) throw new Error("Movement indexer GraphQL error");
  const balances = json?.data?.current_fungible_asset_balances;
  if (!balances || balances.length === 0) return 0;
  return Number(balances[0].amount) / 1e6;
}

// ═══════════════════════════════════════════════════════════
//  SOLANA BALANCES
// ═══════════════════════════════════════════════════════════

/**
 * Fetch ALL SPL token balances in one RPC call, return map of mint → uiAmount.
 */
async function solanaRpc(method: string, params: any[]): Promise<any> {
  try {
    return await jsonRpc(env.SOLANA_RPC_URL, method, params);
  } catch (err: any) {
    console.warn(`[BALANCES] Primary Solana RPC failed (${err.message}), trying fallback`);
    return await jsonRpc(env.SOLANA_RPC_FALLBACK, method, params);
  }
}

async function getAllSolanaTokenBalances(walletAddress: string): Promise<Map<string, number>> {
  const result = await solanaRpc("getTokenAccountsByOwner", [
    walletAddress,
    { programId: SPL_TOKEN_PROGRAM },
    { encoding: "jsonParsed" },
  ]);
  const map = new Map<string, number>();
  // An answer with no account list is a failed read, not an empty wallet: a
  // wallet with no tokens still answers with an empty list. Read as empty, it
  // zeroed USDC and USDT and the next good read came back as a deposit.
  if (!Array.isArray(result?.value)) throw new Error("Solana token accounts unreadable");
  for (const acct of result.value) {
    const info = acct?.account?.data?.parsed?.info;
    if (info?.mint) map.set(info.mint, Number(info.tokenAmount?.uiAmount || 0));
  }
  return map;
}

/** Get a single SPL token balance (used by getOnChainBalance) */
async function getSolanaTokenBalance(walletAddress: string, mintAddress: string): Promise<number> {
  const map = await getAllSolanaTokenBalances(walletAddress);
  return map.get(mintAddress) || 0;
}

// ═══════════════════════════════════════════════════════════
//  PUBLIC API — Fetch all balances for a set of addresses
// ═══════════════════════════════════════════════════════════

export interface ChainAddresses {
  movement?: string; // 0x + 64 hex
  solana?: string;   // base58
  evm?: string;      // 0x + 40 hex (shared for Base, BSC, Arbitrum)
  /**
   * UQ... (non-bounceable). Derived from the Solana key rather than held
   * separately, so callers that have `solana` can always fill this in with
   * ton.tonAddressFromSolana - it is the same wallet seen through a different
   * chain's rules.
   */
  ton?: string;
  /**
   * G... Also the Solana key, re-encoded - but only filled in for users who
   * have opened Stellar, because reading it costs a Horizon request and the
   * public Horizon allows about 3,600 an hour.
   */
  stellar?: string;
  /**
   * The EVM address again, read on Monad. Its own slot rather than riding on
   * `evm` so the deposit watcher can poll Monad - one batched call, on a node
   * with room for it - without dragging Base and BSC along, whose public RPCs
   * already refuse batches under the app's own load.
   */
  monad?: string;
}

export interface BalanceResult {
  asset: string;
  chain: string;
  balance: number;
}

/**
 * Fetch all on-chain balances in parallel.
 * Returns an array of { asset, chain, balance } entries.
 */
/**
 * The transfer behind a Movement balance that went up.
 *
 * An external deposit is noticed by a balance being larger than it was, which
 * says that money arrived and nothing about where from - so the receipt had no
 * hash on it and no link to an explorer. The chain does know: the indexer lists
 * deposit activities per address and asset, and the fullnode turns the version
 * it gives back into a hash and a sender.
 *
 * Best effort by design. It runs inside a balance sync, so a slow indexer must
 * not hold one up: everything is bounded, every failure returns null, and the
 * deposit is still recorded without a hash exactly as it was before.
 */
const MOVE_ASSET_METADATA: Record<string, string> = {
  USDC: MOVE_USDC_METADATA,
  USDT: MOVE_USDT_METADATA,
  USDCx: MOVE_USDCX_METADATA,
};

export interface MovementDeposit {
  hash: string;
  sender: string | null;
  version: string;
  at: string | null;
  /**
   * What the transfer moved, when the chain will say.
   *
   * Worth more than the balance difference that prompted the look. A deposit
   * and a withdrawal landing minutes apart leave a difference that is neither
   * of them - two arrived and one left on a test account, and the figure
   * written down was 0.409508, a number that had never been sent anywhere.
   */
  amount: number | null;
}

export async function findMovementDeposit(
  address: string,
  asset: string,
): Promise<MovementDeposit | null> {
  const assetType = MOVE_ASSET_METADATA[asset];
  if (!assetType) return null;

  try {
    const query = `query LatestDeposit($address: String!, $assetType: String!) {
      fungible_asset_activities(
        where: {
          owner_address: { _eq: $address },
          asset_type: { _eq: $assetType },
          type: { _eq: "0x1::fungible_asset::Deposit" }
        }
        order_by: { transaction_version: desc }
            limit: 1
      ) { transaction_version transaction_timestamp amount }
    }`;

    const res = await fetch(env.MOVEMENT_INDEXER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { address, assetType } }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;

    const body: any = await res.json();
    const row = body?.data?.fungible_asset_activities?.[0];
    if (!row?.transaction_version) return null;

    const byVersion = `${env.MOVEMENT_RPC_URL.replace(/\/$/, "")}/transactions/by_version/${row.transaction_version}`;
    const txRes = await fetch(byVersion, { signal: AbortSignal.timeout(10_000) });
    if (!txRes.ok) return null;

    const tx: any = await txRes.json();
    if (!tx?.hash) return null;

    return {
      hash: tx.hash,
      sender: tx.sender ?? null,
      version: String(row.transaction_version),
      at: row.transaction_timestamp ?? null,
      // Movement's fungible assets are six decimal places.
      amount: row.amount != null ? Number(row.amount) / 1e6 : null,
    };
  } catch (err: any) {
    console.warn("[BALANCES] Movement deposit lookup failed:", err?.message);
    return null;
  }
}

/**
 * The same question on Solana: which transfer put this here?
 *
 * Two plain RPC calls. The owner's token account for the mint, then the most
 * recent signature against that account - which is the transfer, because a
 * token account does very little else. No key derivation and no library: the
 * associated-token-account address is asked for rather than computed.
 */
export async function findSolanaDeposit(
  owner: string,
  asset: string,
): Promise<MovementDeposit | null> {
  const mint = asset === "USDC" ? SOL_USDC_MINT : asset === "USDT" ? SOL_USDT_MINT : null;
  if (!mint) return null;

  try {
    const accounts = await solanaRpc("getTokenAccountsByOwner", [
      owner,
      { mint },
      { encoding: "jsonParsed" },
    ]);
    const tokenAccount = accounts?.value?.[0]?.pubkey;
    if (!tokenAccount) return null;

    const sigs = await solanaRpc("getSignaturesForAddress", [tokenAccount, { limit: 1 }]);
    const hit = Array.isArray(sigs) ? sigs[0] : null;
    if (!hit?.signature || hit.err) return null;

    return {
      hash: hit.signature,
      // A signature listing carries no amount; fetching the transaction for
      // one costs a round trip the receipt does not need.
      amount: null,
      // Solana does not hand the payer back on a signature listing, and
      // fetching the whole transaction to find one costs a second round trip
      // for a field the receipt does not print.
      sender: null,
      version: String(hit.slot ?? ""),
      at: hit.blockTime ? new Date(hit.blockTime * 1000).toISOString() : null,
    };
  } catch (err: any) {
    console.warn("[BALANCES] Solana deposit lookup failed:", err?.message);
    return null;
  }
}

/** Transfer(address,address,uint256) */
const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * How far back to look for the transfer.
 *
 * Public RPCs cap an eth_getLogs range, and this only ever runs the moment a
 * balance is seen to have risen, so the transfer is minutes old rather than
 * days. Five thousand blocks is a couple of hours on Base and rather more on
 * BSC: comfortably enough, and inside every provider limit worth caring about.
 */
const EVM_LOOKBACK_BLOCKS = 5_000;

/**
 * And on the EVM chains: the last Transfer of this token into this address.
 *
 * Read straight from the logs rather than an explorer API, so it needs no key
 * and no third party. The sender is the second indexed topic, which is what
 * makes this worth doing over simply knowing that a balance moved.
 */
export async function findEvmDeposit(
  rpcUrl: string,
  tokenContract: string,
  address: string,
): Promise<MovementDeposit | null> {
  try {
    const headHex = await jsonRpc(rpcUrl, "eth_blockNumber", []);
    const head = Number(BigInt(headHex || "0x0"));
    if (!head) return null;
    const from = Math.max(0, head - EVM_LOOKBACK_BLOCKS);

    const logs = await jsonRpc(rpcUrl, "eth_getLogs", [
      {
        address: tokenContract,
        fromBlock: "0x" + from.toString(16),
        toBlock: "latest",
        // [event, from (any), to (us)]
        topics: [ERC20_TRANSFER_TOPIC, null, "0x" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0")],
      },
    ]);

    const last = Array.isArray(logs) && logs.length ? logs[logs.length - 1] : null;
    if (!last?.transactionHash) return null;

    const fromTopic: string | undefined = last.topics?.[1];
    // The value is the log's unindexed data: a single uint256.
    const decimals = tokenContract.toLowerCase() === BSC_USDC.toLowerCase() ||
      tokenContract.toLowerCase() === BSC_USDT.toLowerCase() ? 18 : 6;

    return {
      hash: last.transactionHash,
      sender: fromTopic ? "0x" + fromTopic.slice(-40) : null,
      version: String(Number(BigInt(last.blockNumber || "0x0"))),
      at: null,
      amount: last.data && last.data !== "0x"
        ? Number(BigInt(last.data)) / 10 ** decimals
        : null,
    };
  } catch (err: any) {
    console.warn("[BALANCES] EVM deposit lookup failed:", err?.message);
    return null;
  }
}

/** The token contract a given asset uses on a given EVM chain. */
export function evmTokenFor(asset: string, chain: string): { rpcUrl: string; token: string } | null {
  if (chain === "BASE") {
    if (asset === "USDC") return { rpcUrl: env.BASE_RPC_URL, token: BASE_USDC };
    if (asset === "USDT") return { rpcUrl: env.BASE_RPC_URL, token: BASE_USDT };
    if (asset === "cNGN") return { rpcUrl: env.BASE_RPC_URL, token: BASE_CNGN };
  }
  if (chain === "BEP20") {
    if (asset === "USDC") return { rpcUrl: env.BSC_RPC_URL, token: BSC_USDC };
    if (asset === "USDT") return { rpcUrl: env.BSC_RPC_URL, token: BSC_USDT };
    if (asset === "cNGN") return { rpcUrl: env.BSC_RPC_URL, token: BSC_CNGN };
  }
  /**
   * Arc catches only HALF its deposits here, and that is on purpose.
   *
   * Somebody can be paid on Arc two ways. Through the token contract, which
   * emits a Transfer log this finds; or as a plain value send, which emits no
   * log at all and is invisible to any amount of eth_getLogs. findArcDeposit
   * below covers the second, and the caller tries both.
   */
  if (chain === "ARC" && asset === "USDC") {
    return { rpcUrl: env.ARC_RPC_URL, token: ARC_USDC_ERC20 };
  }
  return null;
}

/**
 * The last USDC or USDT0 transfer into this address on Monad, and when.
 *
 * Its own function because Monad's blocks are under half a second: the five
 * thousand blocks findEvmDeposit looks back are half an hour here, and public
 * nodes cap one eth_getLogs at 1,000 blocks (Ankr) or 100 (rpc.monad.xyz). So
 * it walks back in windows, newest first, and stops at the first hit - the
 * deposit being looked for is the one that just raised the balance.
 *
 * Unlike the other EVM chains it also reads the block's time, one more call,
 * so the deposit is dated when it arrived rather than when it was noticed.
 */
const MONAD_LOOKBACK_BLOCKS = 6_000;

export async function findMonadDeposit(address: string, asset: string): Promise<MovementDeposit | null> {
  const token = asset === "USDC" ? MONAD_USDC : asset === "USDT" ? MONAD_USDT0 : null;
  if (!token) return null;
  const rpc = env.MONAD_RPC_URL;
  try {
    const head = Number(BigInt((await jsonRpc(rpc, "eth_blockNumber", [])) || "0x0"));
    if (!head) return null;
    const to = "0x" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");

    // 1,000 where the node allows it; a node that caps lower says so, and the
    // rest of the walk drops to its 100.
    let span = 1_000;
    let last: any = null;
    // Each pass either steps back past the window it read or, once, narrows
    // the window - so this ends within about sixty requests whatever happens.
    for (let end = head; end >= 0 && end > head - MONAD_LOOKBACK_BLOCKS && !last; ) {
      const start = Math.max(0, end - span + 1);
      let logs: any;
      try {
        logs = await jsonRpc(rpc, "eth_getLogs", [
          {
            address: token,
            fromBlock: "0x" + start.toString(16),
            toBlock: "0x" + end.toString(16),
            topics: [ERC20_TRANSFER_TOPIC, null, to],
          },
        ]);
      } catch (err: any) {
        if (span > 100 && /range|limit/i.test(String(err?.message))) {
          span = 100;
          continue;
        }
        throw err;
      }
      if (Array.isArray(logs) && logs.length) last = logs[logs.length - 1];
      end = start - 1;
    }
    if (!last?.transactionHash) return null;

    const block = await jsonRpc(rpc, "eth_getBlockByNumber", [last.blockNumber, false]).catch(() => null);
    const fromTopic: string | undefined = last.topics?.[1];
    return {
      hash: last.transactionHash,
      sender: fromTopic ? "0x" + fromTopic.slice(-40) : null,
      version: String(Number(BigInt(last.blockNumber || "0x0"))),
      at: block?.timestamp ? new Date(Number(BigInt(block.timestamp)) * 1000).toISOString() : null,
      amount: last.data && last.data !== "0x" ? Number(BigInt(last.data)) / 1e6 : null,
    };
  } catch (err: any) {
    console.warn("[BALANCES] Monad deposit lookup failed:", err?.message);
    return null;
  }
}

/**
 * A native USDC arrival on Arc, which leaves no log to search for.
 *
 * Value transfers are not events, so the only record is the transaction inside
 * its block - which means walking blocks rather than querying logs. That is
 * expensive, so the window is short and it is only ever run when somebody is
 * already looking at their deposit screen.
 *
 * Amounts come back in whole USDC. The raw value is 18-decimal here, because
 * that is the scale the chain's own currency uses, while the token contract
 * reports the same money at six - a figure taken from one and divided by the
 * other is out by a factor of a million million.
 */
const ARC_NATIVE_LOOKBACK_BLOCKS = 300;

export async function findArcDeposit(address: string): Promise<MovementDeposit | null> {
  try {
    const headHex = await jsonRpc(env.ARC_RPC_URL, "eth_blockNumber", []);
    const head = Number(BigInt(headHex || "0x0"));
    if (!head) return null;

    const want = address.toLowerCase();
    const first = Math.max(0, head - ARC_NATIVE_LOOKBACK_BLOCKS);

    // Newest first: the deposit somebody is waiting on is the recent one, and
    // finding it early means not reading the rest of the window at all.
    for (let n = head; n >= first; n--) {
      const block = await jsonRpc(env.ARC_RPC_URL, "eth_getBlockByNumber", [
        "0x" + n.toString(16),
        true,
      ]).catch(() => null);

      const txs: any[] = block?.transactions ?? [];
      for (const t of txs) {
        if (!t?.to || String(t.to).toLowerCase() !== want) continue;
        const value = BigInt(t.value || "0x0");
        if (value <= 0n) continue;
        return {
          hash: String(t.hash),
          // The payer is on the transaction itself, which a log-based scan has
          // to dig for - one advantage of walking blocks.
          sender: t.from ? String(t.from) : null,
          version: String(t.blockNumber ?? n),
          at: block?.timestamp
            ? new Date(Number(BigInt(block.timestamp)) * 1000).toISOString()
            : null,
          amount: Number(value) / 1e18,
        };
      }
    }
    return null;
  } catch (e: any) {
    console.error("[balances] Arc native deposit scan failed:", e?.message);
    return null;
  }
}

export async function fetchAllBalances(addresses: ChainAddresses): Promise<BalanceResult[]> {
  const jobs: Promise<BalanceResult>[] = [];

  // ─── Movement ───
  if (addresses.movement) {
    const addr = addresses.movement;
    jobs.push(getMovementMoveBalance(addr).then(balance => ({ asset: "MOVE", chain: "MOVE", balance })));
    jobs.push(getMovementUsdcBalance(addr).then(balance => ({ asset: "USDC", chain: "MOVE", balance })));
    jobs.push(getMovementUsdtBalance(addr).then(balance => ({ asset: "USDT", chain: "MOVE", balance })));
    jobs.push(getMovementUsdcxBalance(addr).then(balance => ({ asset: "USDCx", chain: "MOVE", balance })));
  }

  // ─── Solana ───
  if (addresses.solana) {
    const addr = addresses.solana;
    // Single call gets both USDC and USDT
    const splPromise = getAllSolanaTokenBalances(addr);
    jobs.push(splPromise.then(m => ({ asset: "USDC", chain: "SOL", balance: m.get(SOL_USDC_MINT) || 0 })));
    jobs.push(splPromise.then(m => ({ asset: "USDT", chain: "SOL", balance: m.get(SOL_USDT_MINT) || 0 })));
  }

  // ─── TON ───
  // USDT only. USDC is not issued on TON, and the bridged jUSDC has about
  // $56k of supply chain-wide, so there is nothing there to read.
  if (addresses.ton) {
    const addr = addresses.ton;
    /**
     * Given a deadline, because this one queues where the others do not.
     *
     * Every other balance here is a direct RPC call that answers as fast as
     * the network allows. TON goes through an indexer we are rate limited on,
     * so its requests are queued one a second - and allSettled below waits
     * for the slowest job, which means one person's TON read can hold up
     * another person's entire balance refresh. Ten people opening the app at
     * once would have had the tenth waiting ten seconds for figures that were
     * ready immediately.
     *
     * Past the deadline it gives up and lets the stored balance stand.
     */
    const deadline = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("TON balance timed out")), 4000),
    );
    jobs.push(
      Promise.race([
        // Cached briefly: this is the refresh path, where a figure half a
        // minute old costs nothing. getOnChainBalance below passes no maxAge,
        // because a send must decide on what is actually there.
        ton.getTonUsdtBalance(addr, ton.TON_BALANCE_TTL_MS),
        deadline,
      ]).then((balance) => ({ asset: "USDT", chain: "TON", balance })),
      /**
       * Not caught, deliberately. It used to resolve to zero on any failure,
       * which writes a nought over a balance that is really there - a rate
       * limit would have emptied somebody's TON holding on screen and in the
       * database. Letting it reject means allSettled drops it and the last
       * known figure stands, which is what every other reader here does.
       */
    );
  }

  // ─── Stellar ───
  // One account read gives both coins. A coin without a trustline reads as
  // zero, which is true: it cannot hold any. A failed read rejects, so the
  // stored figure stands rather than being overwritten with nothing.
  if (addresses.stellar) {
    const read = stellar.getStellarBalances(addresses.stellar);
    jobs.push(read.then((s) => ({ asset: "USDC", chain: "STELLAR", balance: s.balances.USDC })));
    jobs.push(read.then((s) => ({ asset: "USDT", chain: "STELLAR", balance: s.balances.USDT })));
  }

  // ─── Base ───
  if (addresses.evm) {
    const addr = addresses.evm;
    // One request for all three, rather than three that compete with each other
    // for the same rate limit.
    const baseBatch = batchErc20Balances(
      env.BASE_RPC_URL,
      [
        { contract: BASE_USDC, decimals: 6 },
        { contract: BASE_USDT, decimals: 6 },
        { contract: BASE_CNGN, decimals: 6 },
      ],
      addr,
    );
    /**
     * A token the batch could not read is an ERROR, never a zero.
     *
     * Collapsing null to 0 here wrote "you have nothing" over a balance we
     * simply failed to fetch - and the next successful read then looked like
     * money arriving. A rate-limited Base call produced a cNGN deposit
     * notification for 101 cNGN that had been sitting there all along.
     *
     * Thrown so Promise.allSettled drops it and the stored figure stands.
     */
    const need = (v: number | null, what: string): number => {
      if (v == null) throw new Error(`could not read ${what}`);
      return v;
    };
    jobs.push(baseBatch.then(b => ({ asset: "USDC", chain: "BASE", balance: need(b[0], "USDC on Base") })));
    jobs.push(baseBatch.then(b => ({ asset: "USDT", chain: "BASE", balance: need(b[1], "USDT on Base") })));
    jobs.push(baseBatch.then(b => ({ asset: "cNGN", chain: "BASE", balance: need(b[2], "cNGN on Base") })));

    // ─── BSC ───
    const bscBatch = batchErc20Balances(
      env.BSC_RPC_URL,
      [
        { contract: BSC_USDC, decimals: 18 },
        { contract: BSC_USDT, decimals: 18 },
        { contract: BSC_CNGN, decimals: 6 },
      ],
      addr,
    );
    jobs.push(bscBatch.then(b => ({ asset: "USDC", chain: "BEP20", balance: need(b[0], "USDC on BSC") })));
    jobs.push(bscBatch.then(b => ({ asset: "USDT", chain: "BEP20", balance: need(b[1], "USDT on BSC") })));
    jobs.push(bscBatch.then(b => ({ asset: "cNGN", chain: "BEP20", balance: need(b[2], "cNGN on BSC") })));

    /**
     * ─── Arc ───
     *
     * Read as the NATIVE balance, because on Arc that is what USDC is - the
     * chain's own currency at 18 decimals, which is what nativeEvmBalance
     * already divides by.
     *
     * There is an ERC-20 USDC on Arc as well, and it is the same money rather
     * than a second holding. Reading both would show everybody twice what they
     * have, so only this one is read. Arc's own documentation says it plainly:
     * never present native and ERC-20 USDC as separate rows.
     */
    jobs.push(
      nativeEvmBalance(env.ARC_RPC_URL, addr).then(balance => ({
        asset: "USDC",
        chain: "ARC",
        balance,
      })),
    );
  }

  // ─── Monad ───
  // Both coins in one batched call. A coin the batch could not read is an
  // error rather than a zero, for the reason given under Base above.
  if (addresses.monad) {
    const monadBatch = batchErc20Balances(
      env.MONAD_RPC_URL,
      [
        { contract: MONAD_USDC, decimals: 6 },
        { contract: MONAD_USDT0, decimals: 6 },
      ],
      addresses.monad,
    );
    const need = (v: number | null, what: string): number => {
      if (v == null) throw new Error(`could not read ${what}`);
      return v;
    };
    jobs.push(monadBatch.then(b => ({ asset: "USDC", chain: "MONAD", balance: need(b[0], "USDC on Monad") })));
    jobs.push(monadBatch.then(b => ({ asset: "USDT", chain: "MONAD", balance: need(b[1], "USDT0 on Monad") })));
  }

  const results = await Promise.allSettled(jobs);
  for (const r of results) {
    if (r.status === "rejected") console.error("[balances] fetch failed:", r.reason);
  }
  return results
    .filter((r): r is PromiseFulfilledResult<BalanceResult> => r.status === "fulfilled")
    .map(r => r.value);
}

/**
 * Fetch a single asset+chain on-chain balance for a given wallet address.
 * Used to verify funds exist before debiting.
 */
export async function getOnChainBalance(
  asset: string,
  chain: string,
  walletAddress: string,
): Promise<number> {
  if (chain === "MOVE") {
    if (asset === "MOVE") return getMovementMoveBalance(walletAddress);
    if (asset === "USDC") return getMovementUsdcBalance(walletAddress);
    if (asset === "USDT") return getMovementUsdtBalance(walletAddress);
    if (asset === "USDCx") return getMovementUsdcxBalance(walletAddress);
    return 0;
  }
  if (chain === "SOL") {
    if (asset === "SOL") {
      const raw = await solanaRpc("getBalance", [walletAddress]);
      return (raw?.value ?? 0) / 1e9;
    }
    if (asset === "USDC") return getSolanaTokenBalance(walletAddress, SOL_USDC_MINT);
    if (asset === "USDT") return getSolanaTokenBalance(walletAddress, SOL_USDT_MINT);
    return 0;
  }
  if (chain === "BASE") {
    if (asset === "cNGN") return erc20Balance(env.BASE_RPC_URL, BASE_CNGN, walletAddress, 6);
    if (asset === "USDC") return erc20Balance(env.BASE_RPC_URL, BASE_USDC, walletAddress, 6);
    if (asset === "USDT") return erc20Balance(env.BASE_RPC_URL, BASE_USDT, walletAddress, 6);
    return 0;
  }
  if (chain === "BEP20") {
    // Six decimals, where USDC and USDT are eighteen on this chain.
    if (asset === "cNGN") return erc20Balance(env.BSC_RPC_URL, BSC_CNGN, walletAddress, 6);
    if (asset === "USDC") return erc20Balance(env.BSC_RPC_URL, BSC_USDC, walletAddress, 18);
    if (asset === "USDT") return erc20Balance(env.BSC_RPC_URL, BSC_USDT, walletAddress, 18);
    return 0;
  }
  if (chain === "ARC") {
    /**
     * Native, not a token. On Arc USDC is the chain's own currency, so the
     * balance comes from eth_getBalance at eighteen decimals - the ERC-20 view
     * of the same money reports six, and reading one through the other is the
     * difference between 23 USDC and 23 million.
     */
    if (asset === "USDC") return nativeEvmBalance(env.ARC_RPC_URL, walletAddress);
    return 0;
  }

  if (chain === "MONAD") {
    if (asset === "USDC") return erc20Balance(env.MONAD_RPC_URL, MONAD_USDC, walletAddress, 6);
    if (asset === "USDT") return erc20Balance(env.MONAD_RPC_URL, MONAD_USDT0, walletAddress, 6);
    return 0;
  }

  if (chain === "TON") {
    if (asset === "USDT") return ton.getTonUsdtBalance(walletAddress);
    return 0;
  }

  if (chain === "STELLAR") {
    if (stellar.isStellarCoin(asset)) return stellar.getStellarCoinBalance(asset, walletAddress);
    return 0;
  }

  /**
   * A chain nobody taught this function about.
   *
   * It used to fall through to zero, which every caller reads as "no money
   * here" - so an Arc withdrawal was refused for insufficient balance while the
   * balance sat there on screen. Zero and "I do not know" are different
   * answers, and only one of them should stop a transfer.
   */
  throw new Error(`No on-chain balance reader for ${asset} on ${chain}`);
}
