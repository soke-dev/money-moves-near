import { api } from "./api";
import { saveTonAddress } from "./wallet-core";
import { dynamicClient } from "@/config/dynamic";
import { getDynamicToken, isDynamicAuthenticated } from "./dynamic-wallet";

// ─── Types ──────────────────────────────────────────────────
export interface Wallet {
  id: string;
  asset: string;
  chain: string;
  balance: number | string;
  address?: string;
}

export interface WalletBalances {
  wallets: Wallet[];
  totals: Record<string, number>;
}

/**
 * Remember the TON address the server derived for us.
 *
 * TON is the one chain whose address the app cannot work out for itself: it
 * is the hash of a wallet CONTRACT holding the Solana key, not of the key
 * alone, which would mean a TON library in the bundle for one string. The
 * server derives it from the Solana address it already has, and this keeps
 * whatever it said so balances and sends can name it offline.
 *
 * Safe to take on trust because the derivation is deterministic and the
 * Solana address it comes from IS verified here - see the note on
 * saveTonAddress, and the matching check in withdraw/prepare.
 */
function rememberTonAddress(data: WalletBalances | undefined): void {
  const found = data?.wallets?.find((w) => w.chain === "TON" && w.address);
  if (found?.address) void saveTonAddress(found.address);
}

// ─── Endpoints ──────────────────────────────────────────────
export async function getBalances(): Promise<WalletBalances> {
  const res = await api.get("/wallet/balances");
  rememberTonAddress(res.data);
  return res.data;
}

export async function getBalance(asset: string, chain: string): Promise<Wallet> {
  const res = await api.get(`/wallet/balance/${asset}/${chain}`);
  return res.data;
}

export async function initializeWallets(): Promise<{ message: string; wallets: Wallet[] }> {
  const res = await api.post("/wallet/initialize");
  return res.data;
}

/**
 * Sent with the email wallet's sign-in token.
 *
 * The server takes a new address only when something proves it is this
 * account's, and the token is that proof: Dynamic signs the account's wallet
 * addresses into it. A wallet made moments ago may not be in the token yet, so
 * a refusal gets one refresh of the token and one more try.
 */
export async function saveWalletAddresses(
  addresses: { chain: string; address: string }[],
  opts: { waitForToken?: boolean } = {},
): Promise<{ message: string }> {
  /**
   * The email wallet restores its session in the background after launch, so
   * a save sent straight away carried no token, was refused, and every launch
   * did the same again - the account's wallet was never recorded on the
   * server. Email-wallet callers wait for the token first. Others (a 12-word
   * wallet, which never has one) send at once, as before.
   */
  const token = async () => (opts.waitForToken ? await tokenWithin(20_000) : getDynamicToken());
  const send = async () => api.post("/wallet/addresses", { addresses, dynamicToken: (await token()) ?? undefined });
  try {
    return (await send()).data;
  } catch (e: any) {
    if (e?.response?.data?.code !== "ADDRESS_NOT_PROVEN" || !(opts.waitForToken || isDynamicAuthenticated())) throw e;
    // A wallet made moments ago may not be in the token yet: refresh it, give it a moment, try again.
    let last = e;
    for (const pause of [1_500, 5_000]) {
      try {
        await (dynamicClient.auth as any).refreshUser();
      } catch {}
      await new Promise((r) => setTimeout(r, pause));
      try {
        return (await send()).data;
      } catch (e2: any) {
        if (e2?.response?.data?.code !== "ADDRESS_NOT_PROVEN") throw e2;
        last = e2;
      }
    }
    throw last;
  }
}

/** The email wallet's token, waiting up to `ms` for its session to come back after launch. */
async function tokenWithin(ms: number): Promise<string | null> {
  const end = Date.now() + ms;
  let t = getDynamicToken();
  while (!t && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 500));
    t = getDynamicToken();
  }
  return t;
}

// ─── Record the chosen wallet kind (MNEMONIC | EMBEDDED) ─────
export async function saveWalletType(
  type: "MNEMONIC" | "EMBEDDED"
): Promise<{ message: string; walletType: string }> {
  const res = await api.post("/wallet/type", { type });
  return res.data;
}

// ─── Sync on-chain balances ─────────────────────────────────
export async function syncBalances(): Promise<WalletBalances> {
  const res = await api.post("/wallet/sync");
  rememberTonAddress(res.data);
  return res.data;
}

// ─── Check if user has wallet addresses saved ──────────────
// NOTE: this THROWS on network/backend error on purpose. Callers must be able
// to tell "user has no wallet" (returns false) apart from "couldn't reach the
// backend" (throws). Swallowing the error and returning false previously caused
// a stray wallet to be created during a backend hiccup — never do that.
export async function hasWalletAddresses(): Promise<boolean> {
  const { wallets } = await getBalances();
  return wallets.some((w) => !!w.address);
}


