import { api } from "./api";
import { signSolanaTransaction } from "./wallet-core";
export { stellarAddressFromSolana, isStellarAddress } from "./stellar-address";

/**
 * Stellar, on the Solana key.
 *
 * Stellar signs with Ed25519, so the user's Solana key is their Stellar key
 * and the G... address is the same 32 public-key bytes in Stellar's encoding
 * (worked out in stellar-address.ts without the Stellar SDK, which would be a
 * large new dependency for one string; the server re-derives and checks it).
 *
 * Nothing exists on Stellar until the user opens it, one coin at a time:
 * picking USDC opens the account with a USDC trustline only, and picking USDT
 * later adds USDT0. The treasury pays the fee and the reserve; the user never
 * holds XLM.
 */

export type StellarCoin = "USDC" | "USDT";

export function stellarExplorerUrl(hash: string): string {
  return `https://stellar.expert/explorer/public/tx/${hash}`;
}

/**
 * Sign a Stellar transaction: its 32-byte hash, with the same Ed25519 key as
 * Solana. Its own name for the reason signTonTransaction has one - the day
 * the two diverge, a call named after the wrong chain is how nobody notices.
 */
export async function signStellarTransaction(
  signingMessageHex: string,
): Promise<{ signature: string; publicKey: string }> {
  return signSolanaTransaction(signingMessageHex);
}

// ─── Opening Stellar ─────────────────────────────────────────

export interface StellarStatus {
  available: boolean;
  address?: string;
  exists?: boolean;
  trust?: Record<StellarCoin, boolean>;
  balances?: Record<StellarCoin, number>;
}

export async function getStellarStatus(): Promise<StellarStatus> {
  const { data } = await api.get("/wallet/stellar");
  return data;
}

/**
 * Open Stellar for one coin. Resolves to the address once it is open.
 *
 * Retried when the server says another activation took the treasury's turn
 * first - nothing happened on chain, so preparing and signing again is safe.
 */
export async function activateStellar(coin: StellarCoin): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: prep } = await api.post("/wallet/stellar/activate/prepare", { coin });
    if (prep.alreadyActive) return prep.address;
    const { signature } = await signStellarTransaction(prep.signingMessage);
    try {
      const { data } = await api.post("/wallet/stellar/activate/submit", {
        activationId: prep.activationId,
        signature,
        coin,
      });
      return data.address;
    } catch (err: any) {
      if (err?.response?.status === 409 && err?.response?.data?.retry && attempt < 2) continue;
      throw err;
    }
  }
  throw new Error("Could not set up Stellar. Please try again.");
}

/**
 * Which coins a Money Moves user can receive on Stellar. known is false when
 * the server could not reach Stellar: treat that as "don't know", not "no".
 */
export async function recipientStellar(
  recipientId: string,
): Promise<Record<StellarCoin, boolean> & { known: boolean }> {
  const { data } = await api.get(`/transactions/transfer/username/stellar/${encodeURIComponent(recipientId)}`);
  return data;
}

// ─── Balances ────────────────────────────────────────────────

const COINS: Record<StellarCoin, { code: string; issuer: string }> = {
  USDC: { code: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
  USDT: { code: "USDT0", issuer: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q" },
};

/**
 * Both coins, straight from Horizon. An account that has never been opened is
 * a 404, which is zero of each - not an error. Each phone has its own Horizon
 * allowance, so reading from here costs the server's none.
 */
export async function stellarBalances(address: string): Promise<Record<StellarCoin, number>> {
  const res = await fetch(`https://horizon.stellar.org/accounts/${encodeURIComponent(address)}`);
  if (res.status === 404) return { USDC: 0, USDT: 0 };
  if (!res.ok) throw new Error(`Stellar balance unavailable (${res.status})`);
  const acc = await res.json();
  const out: Record<StellarCoin, number> = { USDC: 0, USDT: 0 };
  for (const b of acc.balances ?? []) {
    for (const coin of ["USDC", "USDT"] as StellarCoin[]) {
      if (b.asset_code === COINS[coin].code && b.asset_issuer === COINS[coin].issuer) {
        out[coin] = Number(b.balance);
      }
    }
  }
  return out;
}
