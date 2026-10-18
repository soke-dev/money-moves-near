import { api } from "./api";

/**
 * Claiming a voucher.
 *
 * The reward is sent on chain by the server; nothing here signs anything. The
 * code is the whole of what the app supplies, which is why the interesting
 * part of this file is the refusal: a "no" that does not say which rule failed
 * is a dead end, and a dead end is a support ticket.
 */

/** One requirement, and whether this person passes it. */
export interface VoucherRule {
  label: string;
  note: string;
  met: boolean;
}

export interface VoucherClaimed {
  claimed: true;
  /**
   * Null for a QR-only voucher.
   *
   * Those are un-shareable only while nothing shows the code in readable
   * form, so the server withholds it rather than trusting the app not to
   * draw it.
   */
  code: string | null;
  amount: number;
  txHash: string;
  claimedAt: string;
  /**
   * Where this one landed, on a lucky voucher. Null on a fixed one.
   *
   * The amount alone cannot say whether 1.30 was a good draw, and that is the
   * only question somebody has after a lucky claim.
   */
  luck?: { rank: number; of: number; best: boolean; top: number } | null;
}

export interface VoucherRefused {
  claimed: false;
  reason: string;
  /**
   * Present only when the code is real and open and they simply do not
   * qualify - so the screen can show the step remaining rather than a wall.
   */
  rules: VoucherRule[] | null;
}

export interface PastClaim {
  /** Null for a QR-only voucher; see VoucherClaimed. */
  code: string | null;
  amount: number;
  status: "PENDING" | "SENT";
  txHash: string | null;
  claimedAt: string;
}

/** The shape a voucher QR carries, so the scanner can tell it from the rest. */
export const VOUCHER_PREFIX = "MMV-";

/**
 * What a voucher QR carries, ahead of the code itself.
 *
 * The QR used to hold the bare code, which works only for the codes we
 * generate: those start MMV- and nothing else does. An admin may set any code
 * matching [A-Z0-9-]{4,64}, and one of those - SOKEVOUCHER - is a perfectly
 * good username. Scan & pay guessed username and said "no such user"; the
 * voucher screen's own scanner matched nothing and silently did nothing at all.
 *
 * No pattern resolves that, because the two really are the same string. The
 * code has to arrive saying what it is.
 */
export const VOUCHER_QR_PREFIX = "mmv:";

export function isVoucherCode(text: string): boolean {
  const t = String(text ?? "").trim();
  if (t.toLowerCase().startsWith(VOUCHER_QR_PREFIX)) {
    return /^[A-Z0-9-]{4,64}$/i.test(t.slice(VOUCHER_QR_PREFIX.length).trim());
  }
  // Still read, so QRs printed before this keep working - every one of them
  // carries a generated code, which is unambiguous on its own.
  return /^MMV-[A-Z0-9-]{2,}$/i.test(t);
}

/** The code alone, however it arrived. Never send the prefix to the server. */
export function voucherCodeFrom(text: string): string {
  const t = String(text ?? "").trim();
  const bare = t.toLowerCase().startsWith(VOUCHER_QR_PREFIX)
    ? t.slice(VOUCHER_QR_PREFIX.length)
    : t;
  return bare.trim().toUpperCase();
}

/**
 * Never throws for a refusal.
 *
 * A code that does not qualify is an ordinary answer, not an error, and
 * treating it as one would put a generic message on the screen instead of the
 * rule that failed.
 */
export async function claimVoucher(
  code: string,
  viaScan = false,
): Promise<VoucherClaimed | VoucherRefused> {
  try {
    const res = await api.post("/vouchers/redeem", {
      code: code.trim().toUpperCase(),
      // Told to the server so the decision to withhold outlives this screen:
      // the claim history and the receipt both have to know months later.
      viaScan,
    });
    return { claimed: true, ...res.data };
  } catch (e: any) {
    const data = e?.response?.data;
    return {
      claimed: false,
      reason: data?.error || "Could not claim that. Try again shortly.",
      rules: Array.isArray(data?.rules) ? data.rules : null,
    };
  }
}

export async function getMyVouchers(): Promise<PastClaim[]> {
  const res = await api.get("/vouchers/mine");
  return res.data?.claims ?? [];
}

/* ── Vouchers you send ──────────────────────────────────────────── */

export interface SentVoucher {
  id: string;
  code: string;
  lucky: boolean;
  status: string;
  pot: number;
  claimed: number;
  of: number;
  takenAmount: number;
  leftAmount: number;
  endsAt: string | null;
  createdAt: string;
  refund: { state: "NONE" | "DUE" | "SENT" | "FAILED"; amount: number; txHash: string | null };
  who: { username: string | null; amount: number; at: string }[];
}

export interface PreparedVoucher {
  prepareId: string;
  code: string;
  pot: number;
  expiresAt: string;
  /** Biggest first, so the screen can lead with what is worth winning. */
  amounts: number[];
  signingMessage: string;
  /** What the server agreed to, echoed back so the review screen can say it. */
  verifiedOnly: boolean;
  perUserClaims: number;
  limits: {
    maxPot: number;
    maxWinners: number;
    minSlice: number;
    days: number;
    maxPerUser: number;
  };
}

/**
 * Work out the split and get back a transfer to sign. Nothing moves yet.
 *
 * Calling it again replaces the plan - which is what Reshuffle is. The amounts
 * are only fixed once the funding has been submitted and confirmed.
 */
export async function prepareVoucher(args: {
  pot: number;
  winners: number;
  lucky: boolean;
  spread?: "even" | "mixed" | "wild";
  code?: string;
  /** Only identity-verified accounts may claim. */
  verifiedOnly?: boolean;
  /** Slices one person may take. The server caps it. */
  perUserClaims?: number;
}): Promise<PreparedVoucher> {
  const { data } = await api.post("/vouchers/mine/prepare", args);
  return data;
}

/**
 * Hand over the signed transfer. The voucher exists only once the money lands.
 *
 * Deliberately not optimistic: a voucher created before its funding confirmed
 * would let people claim USDC nobody had actually put in.
 */
export async function submitVoucher(args: {
  prepareId: string;
  signature: string;
  publicKey: string;
}): Promise<{ voucher: { id: string; code: string; endsAt: string }; fundingTxHash: string }> {
  const { data } = await api.post("/vouchers/mine/submit", args);
  return data;
}

export async function getSentVouchers(): Promise<SentVoucher[]> {
  const { data } = await api.get("/vouchers/mine/sent");
  return data?.vouchers ?? [];
}

/**
 * Stop one early. Takes no amount and no address.
 *
 * The refund goes to the creator's wallet on file either way; this only brings
 * forward what expiry would do anyway, so there is nothing here to aim
 * somewhere else.
 */
export async function endVoucher(id: string): Promise<void> {
  await api.post(`/vouchers/mine/${encodeURIComponent(id)}/end`);
}
