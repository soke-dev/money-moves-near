/**
 * TON, for Money Moves Business: where customers pay USDT on TON.
 *
 * As in the app, the TON wallet rides an Ed25519 key we already hold - the
 * float's Solana key - as a W5 (v5R1) wallet, the one version that can send
 * through the gasless relay later. Customers pay it (or TREASURY_TON_ADDRESS
 * when set) with a comment naming their payment. Receiving needs nothing
 * opened first: the sender's transfer creates our USDT wallet if it's new.
 *
 * TON has no log filter to sweep, so what arrived is read from TonAPI's
 * account events - an indexer that puts a jetton transfer's several
 * transactions back together as one "paid" event. USDT only: Circle doesn't
 * issue USDC on TON.
 */
import { Address } from "@ton/core";
import { WalletContractV5R1 } from "@ton/ton";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { env } from "../config/env";

/** Tether USD on TON. */
const USDT_MASTER = Address.parse("0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe");
const TONAPI = () => (env.TONAPI_BASE_URL ?? "https://tonapi.io").replace(/\/$/, "");

async function tonApi<T = any>(path: string): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (env.TONAPI_KEY) headers.Authorization = `Bearer ${env.TONAPI_KEY}`;
  const r = await fetch(`${TONAPI()}${path}`, { headers, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`TonAPI ${r.status}`);
  return (await r.json()) as T;
}

/** The float's W5 wallet on TON, from its Solana key. */
function floatTonAddress(): string | null {
  if (!env.FLOAT_SOLANA_PRIVATE_KEY) return null;
  try {
    const kp = Keypair.fromSecretKey(bs58.decode(env.FLOAT_SOLANA_PRIVATE_KEY));
    const wallet = WalletContractV5R1.create({ workchain: 0, publicKey: Buffer.from(kp.publicKey.toBytes()) });
    // Non-bounceable: what a wallet address is shown as, and safe to send to before it's deployed.
    return wallet.address.toString({ bounceable: false, urlSafe: true });
  } catch {
    return null;
  }
}

/** Where customers pay on TON. */
export function tonReceiveAddress(): string | null {
  return env.TREASURY_TON_ADDRESS ?? floatTonAddress();
}

export function isTonAddress(v: string): boolean {
  try {
    Address.parse(v.trim());
    return true;
  } catch {
    return false;
  }
}

const same = (a: string, b: string) => {
  try {
    return Address.parse(a).equals(Address.parse(b));
  } catch {
    return false;
  }
};

let readable: { ok: boolean; at: number } = { ok: false, at: 0 };
/** Why TON can't take payments right now, or null when it can. */
export function tonWhy(): string | null {
  if (!tonReceiveAddress()) return "Needs FLOAT_SOLANA_PRIVATE_KEY or TREASURY_TON_ADDRESS set.";
  if (!readable.ok) return readable.at ? "TON couldn't be read just now." : "Checking TON.";
  return null;
}

/** Whether the indexer answers for our wallet - the worker asks every few minutes. */
export async function refreshTon(): Promise<void> {
  const address = tonReceiveAddress();
  if (!address) return;
  try {
    await tonApi(`/v2/accounts/${Address.parse(address).toRawString()}`);
    readable = { ok: true, at: Date.now() };
  } catch (e) {
    // A brand-new wallet the indexer hasn't seen still reads as an account; anything else is the indexer.
    readable = { ok: /TonAPI 404/.test(String((e as Error).message)), at: Date.now() };
  }
}

export interface TonPayment {
  session: string;
  micros: bigint;
  from: string | null;
  memo: string | null;
  tx: string;
  at: Date;
}

/** USDT that reached our wallet recently, newest first, finished transfers only. */
export async function tonArrivals(): Promise<TonPayment[]> {
  const address = tonReceiveAddress();
  if (!address) return [];
  const raw = Address.parse(address).toRawString();
  const res = await tonApi<{ events?: any[] }>(`/v2/accounts/${raw}/events?limit=50`);
  const out: TonPayment[] = [];
  for (const event of res.events ?? []) {
    if (event?.in_progress) continue;
    (event?.actions ?? []).forEach((action: any, i: number) => {
      if (action?.type !== "JettonTransfer" || action?.status !== "ok") return;
      const t = action.JettonTransfer;
      if (!t?.jetton?.address || !same(t.jetton.address, USDT_MASTER.toRawString())) return;
      if (!t?.recipient?.address || !same(t.recipient.address, raw)) return;
      const decimals = Number(t.jetton.decimals ?? 6);
      const amount = BigInt(t.amount ?? "0");
      const micros = decimals >= 6 ? amount / 10n ** BigInt(decimals - 6) : amount * 10n ** BigInt(6 - decimals);
      if (micros <= 0n) return;
      out.push({
        session: `${event.event_id}:${i}`,
        micros,
        from: t.sender?.address ? Address.parse(t.sender.address).toString({ bounceable: false, urlSafe: true }) : null,
        memo: typeof t.comment === "string" && t.comment.trim() ? t.comment.trim() : null,
        tx: String(event.event_id),
        at: new Date(Number(event.timestamp ?? 0) * 1000),
      });
    });
  }
  return out;
}
