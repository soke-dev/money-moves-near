import { api } from "./api";

// ─── Types ──────────────────────────────────────────────────
export interface SavingsLock {
  id: string;
  asset: string;
  chain: string;
  amount: number | string;
  fee?: number | string;
  durationDays: number;
  lockedAt: string;
  unlocksAt: string;
  unlockedAt?: string;
  status: string;
  txHash?: string;
  name?: string;
}

export interface SavingsListResponse {
  locks: SavingsLock[];
  totalLocked: Record<string, number>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// ─── Endpoints ──────────────────────────────────────────────

/** Phase 1: Build on-chain create_lock tx with Shinami sponsorship */
export async function prepareSavingsLock(data: {
  asset: string;
  chain: string;
  amount: number;
  durationDays: number;
  name?: string;
}): Promise<{ prepareId: string; signingMessage: string; chain: string }> {
  const res = await api.post("/savings/lock/prepare", data);
  return res.data;
}

/** Phase 2: Submit user-signed create_lock tx */
export async function submitSavingsLock(data: {
  prepareId: string;
  signature: string;
  publicKey: string;
}): Promise<{ lock: SavingsLock }> {
  const res = await api.post("/savings/lock/submit", data);
  return res.data;
}

export async function getSavingsLocks(params?: {
  page?: number;
  limit?: number;
  status?: string;
}): Promise<SavingsListResponse> {
  const res = await api.get("/savings/locks", { params });
  return res.data;
}

export async function getSavingsLock(id: string): Promise<{ lock: SavingsLock }> {
  const res = await api.get(`/savings/locks/${id}`);
  return res.data;
}

/** Phase 1: Build on-chain withdraw tx with Shinami sponsorship */
export async function prepareSavingsWithdraw(
  id: string
): Promise<{ prepareId: string; signingMessage: string; chain: string }> {
  const res = await api.post(`/savings/locks/${id}/withdraw/prepare`);
  return res.data;
}

/** Phase 2: Submit user-signed withdraw tx */
export async function submitSavingsWithdraw(
  id: string,
  data: { prepareId: string; signature: string; publicKey: string }
): Promise<{ message: string; txHash: string }> {
  const res = await api.post(`/savings/locks/${id}/withdraw/submit`, data);
  return res.data;
}

/** Phase 1: Build on-chain add_to_lock tx with Shinami sponsorship */
export async function prepareSavingsAddToLock(
  id: string,
  data: { amount: number }
): Promise<{ prepareId: string; signingMessage: string; chain: string }> {
  const res = await api.post(`/savings/locks/${id}/add/prepare`, data);
  return res.data;
}

/** Phase 2: Submit user-signed add_to_lock tx */
export async function submitSavingsAddToLock(
  id: string,
  data: { prepareId: string; signature: string; publicKey: string }
): Promise<{ lock: SavingsLock }> {
  const res = await api.post(`/savings/locks/${id}/add/submit`, data);
  return res.data;
}
