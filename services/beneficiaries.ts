import { api } from "./api";

// ─── Types ──────────────────────────────────────────────────
export interface Beneficiary {
  id: string;
  accountName: string;
  accountNumber: string;
  bankName: string;
  bankCode: string | null;
  favourite: boolean;
  createdAt: string;
}

export interface BeneficiaryListResponse {
  beneficiaries: Beneficiary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface ResolveAccountResponse {
  accountName: string | null;
  resolved: boolean;
  bankCode?: string;
}

// ─── Endpoints ──────────────────────────────────────────────
export async function getBeneficiaries(params?: {
  favourite?: boolean;
  search?: string;
  limit?: number;
  page?: number;
}): Promise<BeneficiaryListResponse> {
  const res = await api.get("/beneficiaries", { params });
  return res.data;
}

export async function saveBeneficiary(data: {
  accountName: string;
  accountNumber: string;
  bankName: string;
  bankCode?: string;
  favourite?: boolean;
}): Promise<{ beneficiary: Beneficiary }> {
  const res = await api.post("/beneficiaries", data);
  return res.data;
}

export async function toggleFavourite(id: string): Promise<{ beneficiary: Beneficiary }> {
  const res = await api.patch(`/beneficiaries/${id}/favourite`);
  return res.data;
}

export async function deleteBeneficiary(id: string): Promise<{ message: string }> {
  const res = await api.delete(`/beneficiaries/${id}`);
  return res.data;
}

export async function resolveAccount(data: {
  accountNumber: string;
  bankName: string;
  bankCode?: string;
}): Promise<ResolveAccountResponse> {
  const res = await api.post("/beneficiaries/resolve", data);
  return res.data;
}
