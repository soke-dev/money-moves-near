import { prisma } from "./prisma";
import { sendVoucherReward, isVoucherTreasuryConfigured } from "./voucher-treasury";
import { sendFromEscrow, isVoucherEscrowConfigured } from "./voucher-escrow";

/**
 * Claiming a voucher.
 *
 * The whole difficulty is that a claim is two things that cannot be one: a
 * decision in the database, and a transfer on a chain that takes seconds and
 * can fail. Doing them together means holding a row lock across a network call
 * to Movement; doing them apart means a window where somebody can claim twice.
 *
 * So the decision is taken alone, inside a transaction, and it WRITES THE CLAIM
 * BEFORE THE MONEY MOVES. The row is what stops the second tap - it exists,
 * PENDING, while the transfer is in flight. Only a hash turns it into SENT.
 *
 * A claim that failed keeps its row. It is the only record the attempt
 * happened, and the limits deliberately ignore it, so somebody whose reward
 * never arrived can try again without an admin.
 */

export type Requirement =
  | { kind: "verified" }
  | { kind: "accountAgeDays"; days: number }
  | { kind: "minTransactions"; count: number }
  | { kind: "joinedBefore"; date: string };

/** One rule, and whether this person passes it. */
export type RuleCheck = {
  label: string;
  note: string;
  met: boolean;
};

export type RedeemRefusal = {
  ok: false;
  /** Why, in one line, for somebody who has just typed a code. */
  reason: string;
  /**
   * Set only when the code is real and open and the person simply does not
   * qualify. The app draws the rules; anything else would be telling somebody
   * what a code they do not have requires.
   */
  rules?: RuleCheck[];
};

export type RedeemSuccess = {
  ok: true;
  amount: number;
  code: string;
  /**
   * Whether the code may be shown back to the person who claimed it.
   *
   * False for a UNIQUE voucher. Those are handed out as a printed QR and are
   * un-shareable only while nothing returns the code in readable form - and
   * the app, the push, the email and the claim history are all readable form.
   * Echoing it turns a hundred single-use QRs into one code on a group chat.
   */
  showCode: boolean;
  txHash: string;
  claimedAt: Date;
  /**
   * How this one compared, on a lucky voucher.
   *
   * Null on a fixed one, where everybody gets the same and there is nothing to
   * compare. Sent because the amount alone does not say whether 1.30 was a
   * good draw - the whole point of a lucky voucher is where you landed, and
   * the app cannot work that out from one number.
   */
  luck: { rank: number; of: number; best: boolean; top: number } | null;
};

const refuse = (reason: string, rules?: RuleCheck[]): RedeemRefusal => ({
  ok: false,
  reason,
  ...(rules ? { rules } : {}),
});

/** Stored and compared upper-cased, so LAUNCH50 and launch50 are one voucher. */
export function normaliseCode(code: string): string {
  return String(code ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Whether this person passes each rule, with the sentence to show them.
 *
 * Every rule is reported, met or not - the refusal screen shows what they have
 * already got right, so it reads as a step remaining rather than a rejection.
 */
async function checkRules(
  userId: string,
  requirements: Requirement[],
): Promise<RuleCheck[]> {
  if (!requirements.length) return [];

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { createdAt: true, kycStatus: true },
  });
  if (!user) return [{ label: "Account", note: "We could not read your account.", met: false }];

  const ageDays = Math.floor((Date.now() - user.createdAt.getTime()) / 864e5);

  const out: RuleCheck[] = [];
  for (const r of requirements) {
    switch (r.kind) {
      case "verified": {
        const verified = user.kycStatus === "VERIFIED";
        out.push({
          label: "Identity verified",
          note: verified ? "Done." : "Takes a couple of minutes. A NIN slip and a selfie.",
          met: verified,
        });
        break;
      }

      case "accountAgeDays": {
        out.push({
          label: `Account older than ${r.days} days`,
          note:
            ageDays >= r.days
              ? `You joined ${ageDays} days ago.`
              : `You joined ${ageDays} days ago. ${r.days - ageDays} to go.`,
          met: ageDays >= r.days,
        });
        break;
      }

      case "minTransactions": {
        const n = await prisma.transaction.count({
          where: { userId, status: "COMPLETED" },
        });
        out.push({
          label: `At least ${r.count} completed transaction${r.count === 1 ? "" : "s"}`,
          note: n >= r.count ? `You have ${n}.` : `You have ${n}.`,
          met: n >= r.count,
        });
        break;
      }

      case "joinedBefore": {
        const cutoff = new Date(r.date);
        const met = Number.isFinite(cutoff.getTime()) && user.createdAt < cutoff;
        out.push({
          label: `Joined before ${cutoff.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`,
          note: met ? "Done." : "This one is for earlier accounts.",
          met,
        });
        break;
      }

      /**
       * A rule nobody here understands is a rule nobody has passed.
       *
       * Without this the switch simply fell through, adding nothing to the
       * list - so `rules.some(r => !r.met)` was false and a voucher carrying
       * one mistyped requirement was claimable by anybody. A restriction that
       * silently becomes no restriction is the worst way for this to fail, and
       * it would look exactly like a voucher working.
       */
      default: {
        const unknown = (r as { kind?: unknown })?.kind;
        console.error(`[VOUCHER] unknown requirement ${JSON.stringify(unknown)} - refusing`);
        out.push({
          label: "This voucher has a condition we cannot check",
          note: "Contact support and quote this voucher.",
          met: false,
        });
        break;
      }
    }
  }
  return out;
}

/**
 * Requirements as stored, or an error.
 *
 * Validated where they are WRITTEN as well as where they are read: fail-closed
 * evaluation protects the money, but it turns an admin's typo into a voucher
 * nobody can claim and no message that says why. Checking here means the
 * mistake is caught by the person making it.
 */
export function parseRequirements(input: unknown): Requirement[] {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new Error("Requirements must be a list.");

  return input.map((raw) => {
    const r = raw as Record<string, unknown>;
    switch (r?.kind) {
      case "verified":
        return { kind: "verified" as const };

      case "accountAgeDays": {
        const days = Number(r.days);
        if (!Number.isFinite(days) || days < 0 || days > 36500) {
          throw new Error("Account age must be a number of days between 0 and 36500.");
        }
        return { kind: "accountAgeDays" as const, days: Math.floor(days) };
      }

      case "minTransactions": {
        const count = Number(r.count);
        if (!Number.isFinite(count) || count < 1 || count > 100000) {
          throw new Error("Transaction count must be between 1 and 100000.");
        }
        return { kind: "minTransactions" as const, count: Math.floor(count) };
      }

      case "joinedBefore": {
        const when = new Date(String(r.date ?? ""));
        if (!Number.isFinite(when.getTime())) throw new Error("That joining date is not a date.");
        return { kind: "joinedBefore" as const, date: when.toISOString() };
      }

      default:
        throw new Error(`${JSON.stringify(r?.kind)} is not a requirement we know.`);
    }
  });
}

/**
 * One message for a code that is not live, whatever the reason.
 *
 * Said identically for a code that has never existed and for one sitting in
 * DRAFT, which is what stops the API confirming that a voucher exists before
 * anybody is meant to know it does. Wording them apart - however slightly -
 * turns this endpoint into a way to enumerate unreleased vouchers.
 */
const INVALID_CODE = "Invalid voucher code. Please check it and try again.";

/**
 * One message for a voucher that will not pay again.
 *
 * Said the same whether the end date passed or somebody ended it by hand.
 * They are the same fact to whoever is holding the code - there is nothing
 * left to do - and telling them apart would report an admin's action to the
 * public.
 */
const EXPIRED = "This one closed and is no longer accepting claims.";

/**
 * Take the claim, then pay it.
 *
 * Everything that decides happens inside the transaction. Everything slow
 * happens after it, against a claim that already exists.
 */
export async function redeemVoucher(
  userId: string,
  rawCode: string,
  /**
   * True when the code came off a camera.
   *
   * Taken from the client because only the client knows, and trusting it is
   * safe in the direction that matters: the lie worth telling would be
   * "typed", to get the code shown back - and somebody who scanned it already
   * has it. The honest answer is the one that withholds.
   */
  viaScan = false,
): Promise<RedeemSuccess | RedeemRefusal> {
  const code = normaliseCode(rawCode);
  if (!code) return refuse("Type a code first.");

  // Where it is going, before anything is written down. A claim recorded for
  // somebody with no wallet is a payout with nowhere to go.
  const wallet = await prisma.wallet.findFirst({
    where: { userId, chain: "MOVE", address: { not: null } },
    select: { address: true },
  });
  if (!wallet?.address) {
    return refuse("Your wallet is not ready yet. Try again in a moment.");
  }

  /**
   * Everything that does not need the lock happens before it.
   *
   * An interactive transaction holds a connection from the pool, so a query
   * made on the global client from inside one waits for a connection the
   * transaction is itself holding. With a small pool that is a deadlock, and
   * the rule checks - which read the user and count their transactions - were
   * exactly that. They also do not need serialising: a rule is about the
   * person, not the voucher's remaining capacity, so evaluating it a moment
   * early changes nothing.
   *
   * What is left inside the lock is the part that genuinely races: counting
   * the places taken, and taking one.
   */
  const found = await prisma.voucher.findUnique({
    where: { code },
    select: {
      id: true, kind: true, status: true, rewardAmount: true, totalClaims: true,
      perUserClaims: true, requirements: true, startsAt: true, endsAt: true, mode: true,
      createdByUserId: true,
    },
  });

  /**
   * Whose money pays this one.
   *
   * A voucher somebody made is funded from their balance and sits in escrow;
   * ours comes out of the promo treasury. Decided here, from one field, so no
   * later step has to guess - and checked here too, because an unconfigured
   * wallet must read as "not available" rather than failing at the moment
   * somebody is told they have won something.
   */
  const fromEscrow = !!found?.createdByUserId;

  // The same answer for a code that does not exist and one still in draft.
  // Telling somebody a code is real but not started yet invites them to keep
  // trying it, and tells anybody guessing that they guessed right.
  if (!found || found.status === "DRAFT") return refuse(INVALID_CODE);
  if (fromEscrow ? !isVoucherEscrowConfigured() : !isVoucherTreasuryConfigured()) {
    return refuse("Vouchers are not available right now.");
  }
  if (found.status === "PAUSED") return refuse("That voucher is paused. Try again later.");
  if (found.status === "ENDED") return refuse(EXPIRED);

  const now = new Date();
  if (found.startsAt && now < found.startsAt) return refuse("That voucher has not started yet.");
  if (found.endsAt && now > found.endsAt) return refuse(EXPIRED);

  const requirements = Array.isArray(found.requirements)
    ? (found.requirements as unknown as Requirement[])
    : [];
  const rules = await checkRules(userId, requirements);
  if (rules.some((r) => !r.met)) {
    return refuse("You do not qualify for this one yet.", rules);
  }

  let claimId: string;
  let amount: number;

  try {
    const decision = await prisma.$transaction(async (tx) => {
      /**
       * The lock, and the reason this is a raw query.
       *
       * Two people claiming the last place on a voucher both read "199 of 200"
       * and both insert. FOR UPDATE makes the second wait for the first to
       * commit, so it reads 200 and is refused. Prisma has no way to express
       * this, and without it the cap is a suggestion.
       *
       * The status is re-read under the lock too: it may have been paused in
       * the moment since it was checked above.
       */
      const rows = await tx.$queryRaw<
        {
          id: string;
          status: string;
          reward_amount: string;
          total_claims: number | null;
          per_user_claims: number;
          starts_at: Date | null;
          ends_at: Date | null;
          mode: "FIXED" | "LUCKY";
        }[]
      >`SELECT id, status, reward_amount, total_claims, per_user_claims,
               starts_at, ends_at, mode
          FROM vouchers WHERE code = ${code} FOR UPDATE`;

      const v = rows[0];
      if (!v || v.status !== "ACTIVE") return refuse(INVALID_CODE);

      /**
       * The window, re-read under the lock.
       *
       * It was checked before the lock alongside the status, which left a
       * claim that arrived as a voucher expired able to slip through on the
       * strength of a read taken moments earlier. Everything the decision
       * rests on is re-read here, or it is not a decision the lock protects.
       */
      const inside = new Date();
      if (v.starts_at && inside < v.starts_at) return refuse("That voucher has not started yet.");
      if (v.ends_at && inside > v.ends_at) return refuse(EXPIRED);

      // PENDING and SENT hold a place; FAILED does not, so a payout that never
      // arrived can be attempted again.
      const held: { in: ("PENDING" | "SENT")[] } = { in: ["PENDING", "SENT"] };

      const mine = await tx.voucherClaim.count({
        where: { voucherId: v.id, userId, status: held },
      });
      if (mine >= v.per_user_claims) {
        return refuse(
          v.per_user_claims === 1
            ? "You have already claimed this one."
            : "You have claimed this as many times as it allows.",
        );
      }

      if (v.total_claims !== null) {
        const taken = await tx.voucherClaim.count({
          where: { voucherId: v.id, status: held },
        });
        if (taken >= v.total_claims) return refuse("That voucher is all gone.");
      }

      /**
       * A voucher with slices pays what the next slice says, not reward_amount.
       *
       * The slices were cut and shuffled when the voucher was made, so taking
       * them in order is already random - there is nothing to draw here, only
       * a row to hand over. That matters: drawing at claim time would put a
       * random number inside a lock two people are queued on, and the one
       * thing this must never do is give the same slice twice.
       *
       * Safe under the voucher's own FOR UPDATE, which every claim on this
       * code is already serialised behind, and belt-and-braces besides: the
       * slice's claim_id is unique, so a second write to a taken slice is
       * refused by the database rather than by our arithmetic.
       *
       * ── Why this is not just LUCKY ──────────────────────────────────
       *
       * Every user voucher is cut into slices, Same each as much as Lucky dip;
       * only our own fixed promos have none. This used to test the mode, so a
       * Same each voucher paid out of reward_amount and left every slice
       * untouched - and the refund, which works out what is owed by summing
       * the slices nobody took, then sent the WHOLE pot back to the creator
       * after the claimers had already been paid. Escrow holds other people's
       * money, so that shortfall came out of somebody else's voucher.
       *
       * The slices are the ledger. Anything that has them takes from them.
       */
      let value = Number(v.reward_amount);
      let sliceId: string | null = null;

      if (v.mode === "LUCKY" || fromEscrow) {
        const slice = await tx.voucherSlice.findFirst({
          where: { voucherId: v.id, claimId: null },
          orderBy: { position: "asc" },
          select: { id: true, amount: true },
        });
        // Running out of slices IS running out of voucher, whatever the cap
        // says - the pot has been handed out.
        if (!slice) return refuse("That voucher is all gone.");
        sliceId = slice.id;
        value = Number(slice.amount);
      }

      const claim = await tx.voucherClaim.create({
        data: { voucherId: v.id, userId, amount: value, status: "PENDING", viaScan },
        select: { id: true },
      });

      if (sliceId) {
        await tx.voucherSlice.update({ where: { id: sliceId }, data: { claimId: claim.id } });
      }

      return { ok: true as const, claimId: claim.id, amount: value };
    });

    if (!("claimId" in decision)) return decision;
    claimId = decision.claimId;
    amount = decision.amount;
  } catch (e: any) {
    console.error("[VOUCHER] claim failed:", e?.message);
    return refuse("Could not claim that. Try again shortly.");
  }

  /**
   * Outside the transaction, deliberately.
   *
   * A transfer takes seconds; a lock held across it would serialise every
   * claimer of a popular voucher behind the chain. The place is already
   * reserved by the PENDING row, so nothing is lost by taking the time here.
   */
  try {
    const txHash = fromEscrow
      ? await sendFromEscrow(wallet.address, amount, "claim")
      : await sendVoucherReward(wallet.address, amount);
    const done = await prisma.voucherClaim.update({
      where: { id: claimId },
      data: { status: "SENT", txHash },
      select: { createdAt: true },
    });

    /**
     * And into the history, as a voucher rather than as money appearing.
     *
     * Without this the only record on the person's own list is what the
     * chain-watcher makes of it: USDC arriving on Movement from nowhere,
     * written down as an external deposit. That is true and useless - it
     * cannot say where it came from, and it invites the question we have the
     * answer to.
     *
     * metadata.txHash is what stops it being recorded twice: the watcher
     * dedupes on exactly that key, so once this row exists the arrival is
     * already explained.
     */
    await prisma.transaction
      .create({
        data: {
          userId,
          type: "DEPOSIT",
          asset: "USDCx",
          chain: "MOVE",
          amount,
          fee: 0,
          status: "COMPLETED",
          reference: `VOUCHER-${claimId}`,
          metadata: {
            source: "voucher",
            txHash,
            claimId,
            // Only where it may be shown. A QR-only code must not be readable
            // off a receipt screen either.
            ...(found.kind === "PUBLIC" && !viaScan ? { voucherCode: code } : {}),
          },
        },
      })
      .catch((e: any) =>
        // The reward landed; a missing history row is a reporting problem, not
        // a reason to tell somebody their claim failed.
        console.error(`[VOUCHER] history row failed for claim ${claimId}:`, e?.message),
      );
    /**
     * Where this slice landed among the ones already gone.
     *
     * Ranked against claims MADE, not against the whole spread: telling
     * somebody they came 14th of 20 before fourteen people have claimed would
     * be reading out the answer to a draw still in progress. Best-effort - a
     * failure here must never turn a paid reward into an error.
     */
    let luck: RedeemSuccess["luck"] = null;
    if (found.mode === "LUCKY") {
      try {
        const sofar = await prisma.voucherClaim.findMany({
          where: { voucherId: found.id, status: { in: ["PENDING", "SENT"] } },
          select: { amount: true },
        });
        const amounts = sofar.map((c) => Number(c.amount)).sort((a, b) => b - a);
        const top = amounts[0] ?? amount;
        luck = {
          rank: amounts.indexOf(amount) + 1,
          of: amounts.length,
          best: amount >= top,
          top,
        };
      } catch {
        luck = null;
      }
    }

    return {
      ok: true,
      amount,
      code,
      // A public code is a receipt to whoever typed it and a leak to whoever
      // scanned it. Both conditions, every time it is decided.
      showCode: found.kind === "PUBLIC" && !viaScan,
      txHash,
      claimedAt: done.createdAt,
      luck,
    };
  } catch (e: any) {
    /**
     * A send that broadcast but could not be confirmed carries its hash. That
     * claim is NOT failed - the money is very likely on its way - so it stays
     * PENDING with the hash attached for somebody to resolve, and keeps
     * holding its place so it cannot be claimed a second time.
     */
    const hash: string | undefined = e?.txHash;
    await prisma.voucherClaim
      .update({
        where: { id: claimId },
        data: hash
          ? { txHash: hash, error: `Unconfirmed: ${e?.message ?? "timeout"}` }
          : { status: "FAILED", error: String(e?.message ?? "send failed").slice(0, 300) },
      })
      .catch(() => {});

    /**
     * A slice a failed claim was holding goes back in the pot.
     *
     * A FAILED claim already releases the PLACE - the cap counts only PENDING
     * and SENT - so without this the place comes back and the slice does not:
     * the person retries and takes a different one, and the slice they were
     * first given is stranded for ever. A twenty-slice voucher with one failed
     * payout could then only ever pay nineteen, and the pot would never
     * reconcile against what went out.
     *
     * Not done for an unconfirmed send. That one carries a hash, the money has
     * very likely left, and handing its slice to somebody else is how the pot
     * gets paid out twice.
     */
    if (!hash) {
      await prisma.voucherSlice
        .updateMany({ where: { claimId }, data: { claimId: null } })
        .catch(() => {});
    }

    console.error(`[VOUCHER] payout failed for claim ${claimId}:`, e?.message);
    return refuse(
      hash
        ? "Sent, but we could not confirm it yet. Check your balance shortly."
        : "We could not send that reward. Nothing was taken - try again shortly.",
    );
  }
}

/**
 * What the active vouchers could still cost.
 *
 * Every unclaimed place on every live voucher, priced at its reward. This is
 * the figure the console shows as Reserved, and the one that stops two
 * vouchers promising the same balance.
 *
 * An uncapped voucher cannot be counted - it could cost anything - so it is
 * reported separately rather than silently treated as zero.
 */
export async function voucherReserved(): Promise<{ reserved: number; uncapped: number }> {
  const live = await prisma.voucher.findMany({
    /**
     * Ours only.
     *
     * A user voucher's money is in the escrow wallet, not this float, so
     * counting it here would reserve our promo budget against somebody else's
     * USDC - and make the free figure smaller than it really is every time a
     * person sends a voucher.
     */
    where: { status: "ACTIVE", createdByUserId: null },
    select: { id: true, rewardAmount: true, totalClaims: true, mode: true },
  });
  if (!live.length) return { reserved: 0, uncapped: 0 };

  const taken = await prisma.voucherClaim.groupBy({
    by: ["voucherId"],
    where: { voucherId: { in: live.map((v) => v.id) }, status: { in: ["PENDING", "SENT"] } },
    _count: { _all: true },
  });
  const byId = new Map(taken.map((t) => [t.voucherId, t._count._all]));

  /**
   * A lucky voucher's reserve is not an estimate.
   *
   * Its slices were cut when it was made, so what it still owes is the sum of
   * the ones nobody has taken - an exact figure, unlike a fixed voucher where
   * we multiply a reward by a cap and an uncapped one where we cannot say at
   * all. Summed in the database rather than pulled back row by row, because a
   * five-hundred-winner voucher is five hundred rows to add up.
   */
  const luckyIds = live.filter((v) => v.mode === "LUCKY").map((v) => v.id);
  const owedByVoucher = new Map<string, number>();
  if (luckyIds.length) {
    const sums = await prisma.voucherSlice.groupBy({
      by: ["voucherId"],
      where: { voucherId: { in: luckyIds }, claimId: null },
      _sum: { amount: true },
    });
    for (const row of sums) owedByVoucher.set(row.voucherId, Number(row._sum.amount ?? 0));
  }

  let reserved = 0;
  let uncapped = 0;
  for (const v of live) {
    if (v.mode === "LUCKY") {
      reserved += owedByVoucher.get(v.id) ?? 0;
      continue;
    }
    if (v.totalClaims === null) { uncapped++; continue; }
    const left = Math.max(v.totalClaims - (byId.get(v.id) ?? 0), 0);
    reserved += left * Number(v.rewardAmount);
  }
  return { reserved, uncapped };
}

/** A code nobody will guess: no vowels, no 0/O/1/I, grouped to be read aloud. */
export function generateCode(): string {
  const alphabet = "23456789ACDEFGHJKLMNPQRTUVWXYZ";
  const pick = () =>
    Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `MMV-${pick()}-${pick()}`;
}
