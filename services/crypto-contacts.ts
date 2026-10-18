/**
 * Saved wallet addresses.
 *
 * Recent and Favourites are the same rows read two ways: the list comes back
 * most-recently-used first, and `favourite` marks the ones deliberately kept.
 * A completed withdrawal stamps the address server-side, so Recent fills
 * itself without the user choosing to save anything.
 */
import { api } from "./api";

export interface CryptoContact {
  id: string;
  address: string;
  chain: string;
  label: string | null;
  favourite: boolean;
  lastUsedAt: string;
}

export async function listCryptoContacts(opts?: {
  favourite?: boolean;
  chain?: string;
  limit?: number;
}): Promise<CryptoContact[]> {
  const res = await api.get("/crypto-contacts", {
    params: {
      ...(opts?.favourite !== undefined ? { favourite: String(opts.favourite) } : {}),
      ...(opts?.chain ? { chain: opts.chain } : {}),
      ...(opts?.limit ? { limit: opts.limit } : {}),
    },
  });
  return res.data?.contacts ?? [];
}

/** Save an address, or update the one already stored for that chain. */
export async function saveCryptoContact(data: {
  address: string;
  chain: string;
  label?: string;
  favourite?: boolean;
}): Promise<CryptoContact> {
  const res = await api.post("/crypto-contacts", data);
  return res.data?.contact;
}

export async function updateCryptoContact(
  id: string,
  data: { label?: string; favourite?: boolean },
): Promise<CryptoContact> {
  const res = await api.patch(`/crypto-contacts/${id}`, data);
  return res.data?.contact;
}

export async function deleteCryptoContact(id: string): Promise<void> {
  await api.delete(`/crypto-contacts/${id}`);
}
