/**
 * The Money Moves app's side of linking an account: we ask, the account's
 * owner approves (or not) in the app, and we read the answer. A narrow
 * internal API on the app's backend, signed with a secret both services hold
 * (BUSINESS_LINK_SECRET) - nothing else crosses between them.
 */
import { env } from "../config/env";
import { HttpError } from "./http";

export type AppLinkStatus = "PENDING" | "APPROVED" | "DECLINED" | "REVOKED";
export type AppLink = { id: string; status: AppLinkStatus; accountId: string | null; username: string | null };

export const appLinksReady = () => !!env.BUSINESS_LINK_SECRET;

const off = () => new HttpError(503, "Linking a Money Moves account isn't switched on yet. Try again a little later.", "linking_off");

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; data: T | null }> {
  if (!appLinksReady()) throw off();
  let res: Response;
  try {
    res = await fetch(`${env.APP_API_URL}/api/internal/business-links${path}`, {
      method,
      headers: { "content-type": "application/json", "x-business-link-secret": env.BUSINESS_LINK_SECRET! },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(502, "We couldn't reach Money Moves just now. Try again in a moment.", "app_unreachable");
  }
  const data = (await res.json().catch(() => null)) as (T & { code?: string }) | null;
  // A 404 that isn't the app's own "no such user" means its side isn't there yet (or not this version of it).
  if (res.status === 404 && path === "" && data?.code !== "no_user") throw off();
  return { status: res.status, data };
}

/** Asks the account's owner, by username. They get a notification in the app to approve it. */
/**
 * A settlement into a linked Money Moves account, final on chain: the app
 * files it as a settlement from this business rather than a deposit from
 * nowhere. Best effort - the money is there either way.
 */
export async function tellSettlement(
  linkId: string,
  p: { txHash: string; chain: string; asset: string; amount: string; businessName: string; reference: string; nairaAmount: number },
): Promise<void> {
  await call("POST", `/${encodeURIComponent(linkId)}/settlement`, p);
}

export async function requestLink(p: { businessId: string; businessName: string; businessLogo?: string; merchantId: string; username: string; requestedBy: string }): Promise<AppLink> {
  const r = await call<{ link?: AppLink; code?: string; error?: string }>("POST", "", p);
  if (r.status === 404 || r.data?.code === "no_user") throw new HttpError(404, "There's no Money Moves account with that username. Check it in the app. It's on the profile.", "no_user");
  if (r.status === 429) throw new HttpError(429, "That account has had a lot of requests. Try again later.", "too_many");
  if (!r.data?.link) throw new HttpError(502, "Money Moves didn't take the request just now. Try again in a moment.", "app_error");
  return r.data.link;
}

/** Where a request stands, as the app sees it. */
export async function readLink(id: string): Promise<AppLink | null> {
  const r = await call<{ link?: AppLink }>("GET", `/${encodeURIComponent(id)}`);
  return r.data?.link ?? null;
}

/** Where several stand, in one call - the worker checks its waiting ones together. */
export async function readLinks(ids: string[]): Promise<AppLink[]> {
  if (!ids.length) return [];
  const r = await call<{ links?: AppLink[] }>("POST", "/status", { ids });
  return r.data?.links ?? [];
}

/**
 * Where to pay a linked account: its USDC address on the settle chain, from
 * the app. Null when the link isn't approved any more or the account has no
 * address there. Throws when the app can't be asked right now.
 */
export async function linkAddress(id: string, chain: "MOVEMENT" | "SOLANA" | "ARC" | "MONAD" | "STELLAR"): Promise<string | null> {
  const r = await call<{ address?: string; code?: string }>("GET", `/${encodeURIComponent(id)}/address?chain=${chain}`);
  if (r.status === 404 && (r.data?.code === "not_linked" || r.data?.code === "no_address")) return null;
  if (r.status !== 200 || !r.data?.address) throw new HttpError(502, "Money Moves didn't answer just now.", "app_error");
  return r.data.address;
}

/** Ended by the business: the app stops showing it, and the owner is told. */
export async function revokeLink(id: string): Promise<void> {
  await call("POST", `/${encodeURIComponent(id)}/revoke`);
}
