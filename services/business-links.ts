import { api } from "./api";

/** A business on Money Moves Business asking to be paid into this account - or linked to it already. */
export interface BusinessLink {
  id: string;
  businessName: string;
  /** The business's logo, when it has one. */
  businessLogo?: string | null;
  merchantId: string;
  status: "PENDING" | "APPROVED";
  createdAt: string;
  decidedAt: string | null;
}

export async function getBusinessLinks(): Promise<BusinessLink[]> {
  const { data } = await api.get("/business-links");
  return data.links;
}

export async function approveBusinessLink(id: string): Promise<void> {
  await api.post(`/business-links/${id}/approve`);
}

export async function declineBusinessLink(id: string): Promise<void> {
  await api.post(`/business-links/${id}/decline`);
}

export async function unlinkBusiness(id: string): Promise<void> {
  await api.post(`/business-links/${id}/unlink`);
}
