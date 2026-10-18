/**
 * Talking to Money Moves Business: the public checkout (anyone can pay a
 * business's payment link, invoice or store QR) and the merchant API (a
 * business's own secret key, added by PayBox as a brokered header, never in
 * this code).
 */
import { PublicKey, Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";

export const BASE = (process.env.MONEY_MOVES_BASE_URL || "https://business.usemoneymoves.xyz").replace(/\/+$/, "");

export class MoneyMovesError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

/** One bounded request to Money Moves. Errors come back as a sentence from Money Moves itself. */
export async function call<T>(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 4_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch {
    throw new MoneyMovesError("Money Moves didn't answer in time. Try again in a moment.", 0, "unreachable");
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const err = json?.error;
    const message = typeof err === "string" ? err : typeof err === "object" && err && typeof (err as { message?: unknown }).message === "string" ? (err as { message: string }).message : `Money Moves answered ${res.status}.`;
    const code = typeof json?.code === "string" ? json.code : typeof err === "object" && err ? String((err as { code?: unknown }).code ?? "") : undefined;
    throw new MoneyMovesError(message, res.status, code || undefined);
  }
  return json as T;
}

// ─── Which checkout a link is ─────────────────────────────────────────────

export type Target = { kind: "link" | "invoice" | "outlet"; id: string; api: string };

/**
 * A Money Moves checkout from what a person pastes: a full address
 * (pay.usemoneymoves.xyz/shop, business.usemoneymoves.xyz/pay/i/abc, …) or
 * just the link's name.
 */
export function targetOf(raw: string): Target {
  const text = raw.trim();
  let parts: string[];
  try {
    // A full address, one without its https:// ("pay.usemoneymoves.xyz/shop"), or just the name.
    const full = /^https?:\/\//i.test(text) ? text : /^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(text) ? `https://${text}` : `https://x.invalid/${text}`;
    parts = new URL(full).pathname.split("/").filter(Boolean);
  } catch {
    throw new MoneyMovesError("That isn't a Money Moves link.", 400, "bad_link");
  }
  if (parts[0] === "pay") parts = parts.slice(1);
  const safe = (s: string | undefined) => (s && /^[A-Za-z0-9_-]{2,64}$/.test(s) ? s : null);
  if (parts[0] === "i" && safe(parts[1])) return { kind: "invoice", id: parts[1]!, api: `/pay/i/${parts[1]}` };
  if (parts[0] === "o" && safe(parts[1])) return { kind: "outlet", id: parts[1]!.toLowerCase(), api: `/pay/o/${parts[1]!.toLowerCase()}` };
  if (safe(parts[0]) && !["r", "p", "i", "o"].includes(parts[0]!)) return { kind: "link", id: parts[0]!.toLowerCase(), api: `/pay/${parts[0]!.toLowerCase()}` };
  throw new MoneyMovesError("That isn't a Money Moves payment link, invoice or store address.", 400, "bad_link");
}

/** What the checkout page reads: the same for a link, an invoice and a store. */
export type PublicCheckout = {
  link: {
    name: string;
    description: string | null;
    mode: "TEST" | "LIVE";
    active: boolean;
    currency: "NGN" | "USD";
    amount: number | null;
    min: number | null;
    methods: string[];
    accept?: Record<string, string[]>;
    askPhone?: boolean;
    feePayer?: "BUSINESS" | "CUSTOMER" | null;
  };
  business: { name: string; verified: boolean };
  rate: number | null;
  limits: { minNgn: number; maxNgn: number };
  maintenance?: boolean;
};

export type PublicPayment = {
  token: string;
  ref: string;
  mode: "TEST" | "LIVE";
  method: string;
  status: "OPEN" | "PAID" | "UNDERPAID" | "EXPIRED";
  currency: "NGN" | "USD";
  amountNgn: number;
  amountUsd: number;
  ngnPerUsd: number;
  deposit: { coin: string | null; network: string | null; address: string; amount: string | null; memo: string | null; own: boolean; received: string | null; left: string | null } | null;
  customerFeeNgn: number | null;
  tx: string | null;
  expiresAt: string;
  receivedNgn: number | null;
  paidAt: string | null;
};

export const receiptUrl = (token: string) => `${BASE}/pay/r/${token}`;

/** Whether this checkout takes USDC on Solana right now. */
export const takesSolanaUsdc = (c: PublicCheckout) => c.link.methods.includes("CRYPTO") && !!c.link.accept?.USDC?.includes("Solana");

// ─── A USDC transfer on Solana, unsigned ──────────────────────────────────

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const USDC_DECIMALS = 6;

const tokenAccountOf = (owner: PublicKey) => PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), USDC_MINT.toBuffer()], ATA_PROGRAM)[0];

export function solanaAddress(raw: string, what: string): PublicKey {
  try {
    const key = new PublicKey(raw.trim());
    if (key.toBase58() !== raw.trim()) throw new Error();
    return key;
  } catch {
    throw new MoneyMovesError(`${what} isn't a Solana address.`, 400, "bad_address");
  }
}

/**
 * USDC from the sender's wallet to the payment's own address: open the
 * address's USDC account if it isn't open yet (Money Moves opens it ahead, so
 * usually this costs nothing), then a checked transfer of the exact amount.
 * The blockhash is a placeholder; PayBox puts a fresh one in before signing.
 */
export function usdcTransfer(sender: PublicKey, to: PublicKey, atomic: bigint): string {
  const from = tokenAccountOf(sender);
  const into = tokenAccountOf(to);
  const open = new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: sender, isSigner: true, isWritable: true },
      { pubkey: into, isSigner: false, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: false },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    // CreateIdempotent: nothing happens when it's already open.
    data: Buffer.from([1]),
  });
  const amount = Buffer.alloc(8);
  amount.writeBigUInt64LE(atomic);
  const transfer = new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    keys: [
      { pubkey: from, isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: into, isSigner: false, isWritable: true },
      { pubkey: sender, isSigner: true, isWritable: false },
    ],
    // TransferChecked: the mint and its decimals are checked on chain.
    data: Buffer.concat([Buffer.from([12]), amount, Buffer.from([USDC_DECIMALS])]),
  });
  const tx = new Transaction({ feePayer: sender, recentBlockhash: "11111111111111111111111111111111" }).add(open, transfer);
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}
