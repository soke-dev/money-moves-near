import { api } from "./api";

export interface TonRecoveryStatus {
  available: boolean;
  asset?: string;
  balance?: number;
  /** What will arrive: the balance less room for the relay's fee. */
  amount?: number;
  oldAddress?: string;
  currentAddress?: string;
}

export async function getTonRecovery(): Promise<TonRecoveryStatus> {
  const res = await api.get("/wallet/ton-recovery");
  return res.data;
}

/** Is this the key that controls the older wallet? Only the public address leaves the phone. */
export async function checkTonRecoveryKey(oldSolanaAddress: string): Promise<boolean> {
  const res = await api.post("/wallet/ton-recovery/check", { oldSolanaAddress });
  return !!res.data?.matches;
}

export async function prepareTonRecovery(oldSolanaAddress: string): Promise<{ id: string; signingMessage: string; amount: number }> {
  const res = await api.post("/wallet/ton-recovery/prepare", { oldSolanaAddress }, { timeout: 60_000 });
  return res.data;
}

/** Waits for the chain, so this can take a little while. */
export async function submitTonRecovery(id: string, signature: string): Promise<{ amount: number }> {
  const res = await api.post("/wallet/ton-recovery/submit", { id, signature }, { timeout: 120_000 });
  return res.data;
}
