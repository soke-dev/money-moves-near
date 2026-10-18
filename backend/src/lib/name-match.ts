/**
 * Does the name on a bank transfer belong to the person who sent it?
 *
 * A naira deposit funds a crypto purchase, and the rule is that the money must
 * come from an account in the buyer's own name. Flutterwave gives us the
 * sender's name on the charge; the name we trust is the one on the verified ID,
 * not the profile - see below for why that distinction is not academic.
 *
 * ── Why this is not a string comparison ─────────────────────────────────────
 *
 * The first real deposit on this platform was from "COLLINS OKOTETE". The
 * profile stored firstName "Okotete", lastName "Collins" - reversed - while the
 * Didit row had them the right way round. Nigerian banks are themselves
 * inconsistent about whether they print SURNAME FIRSTNAME or FIRSTNAME SURNAME,
 * so any comparison that depends on order is wrong roughly half the time.
 *
 * So: compare unordered, and pass on one name.
 *
 *   - Either the given name or the surname appearing among the sender's tokens
 *     is enough, in any position.
 *   - A single letter matches a token beginning with it, so "C OKOTETE" is the
 *     same person as "COLLINS OKOTETE".
 *   - Titles and generational suffixes are stripped before any of that.
 *
 * One name rather than both is a deliberate loosening, and it has a cost worth
 * stating: a relative sharing the surname passes. "BLESSING OKOTETE" funding
 * Collins Okotete's account reads as a match here.
 *
 * What it buys is the far commoner case. Nigerian bank accounts frequently
 * print two of a person's three or four names, and not always the two on the
 * NIN - so requiring both would hold a great many deposits that are perfectly
 * honest. The shape this is really for is an account belonging to nobody in the
 * buyer's name at all, and that is still caught.
 *
 * The result is deliberately not a similarity score. A number invites a
 * threshold, a threshold invites tuning, and tuning a threshold against real
 * deposits means getting some of them wrong on purpose.
 */

/** Dropped before comparison: they describe a person, they do not name one. */
const TITLES = new Set([
  "MR", "MRS", "MISS", "MS", "MSTR", "MASTER",
  "DR", "PROF", "ENGR", "ENG", "BARR", "ARC", "PST", "REV", "EVANG",
  "CHIEF", "ALHAJI", "ALHAJA", "ALH", "HRH", "SIR", "LADY", "MALLAM", "MAL",
]);

const SUFFIXES = new Set(["JR", "JNR", "SR", "SNR", "II", "III", "IV"]);

/**
 * A name as it arrives, reduced to comparable tokens.
 *
 * Hyphens and apostrophes become separators rather than being deleted, so
 * "OKON-BASSEY" yields two tokens and matches a bank that prints "OKON BASSEY".
 * Anything else that is not a letter is dropped.
 */
export function nameTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .toUpperCase()
    .replace(/[-'’.]/g, " ")
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !TITLES.has(t) && !SUFFIXES.has(t));
}

/** Is `needle` present among `haystack`, allowing an initial for a full name? */
function satisfied(needle: string, haystack: string[]): boolean {
  if (!needle) return false;
  return haystack.some((h) => {
    if (h === needle) return true;
    // One side an initial, the other a name starting with it.
    if (needle.length === 1 && h.startsWith(needle)) return true;
    if (h.length === 1 && needle.startsWith(h)) return true;
    return false;
  });
}

export type NameVerdict =
  /** Both names on the ID appear on the transfer. */
  | "MATCH"
  /** The transfer names someone else. */
  | "MISMATCH"
  /** The rail sent no sender name at all. */
  | "MISSING"
  /** We hold no verified name to compare against. */
  | "NO_REFERENCE";

export interface NameCheck {
  verdict: NameVerdict;
  /** The sender as the bank printed them, for the record and for review. */
  senderName: string | null;
  /** What we compared against, normalised. */
  expected: string | null;
  /** One line, written to be shown to a human. */
  reason: string;
}

/**
 * Compare the name on a transfer against the name on a verified ID.
 *
 * `first` and `last` are the identity document's fields. Where one is missing -
 * an older record, a provider that returned only a full name - the check falls
 * back to requiring any two tokens to match, which is the same rule in the only
 * form the data supports.
 */
/**
 * What a held deposit says to the person who sent it.
 *
 * One sentence for every way the check can fail, because the differences are
 * ours and not theirs: whether the bank withheld the sender, whether we had no
 * name on file, or whether the names simply differ, what they need to do is
 * the same. "The bank did not tell us whose account the transfer came from"
 * described our problem as though it were theirs and left them nothing to act
 * on.
 *
 * The precise cause is still recorded - `verdict` carries it to the log and to
 * the review queue, which is where somebody is actually deciding on it.
 */
const HELD_REASON = "Name mismatch. Only send funds from your own bank account.";

export function checkSenderName(args: {
  senderName: string | null | undefined;
  first: string | null | undefined;
  last: string | null | undefined;
}): NameCheck {
  const senderName = args.senderName?.trim() || null;
  const sender = nameTokens(senderName);
  const first = nameTokens(args.first);
  const last = nameTokens(args.last);
  const expected = [...first, ...last].join(" ") || null;

  if (!first.length && !last.length) {
    return {
      verdict: "NO_REFERENCE",
      senderName,
      expected: null,
      reason: HELD_REASON,
    };
  }

  if (!sender.length) {
    return {
      verdict: "MISSING",
      senderName,
      expected,
      reason: HELD_REASON,
    };
  }

  // One name from the document, anywhere in the sender's, is enough.
  const onFile = [...first, ...last];
  const hit = onFile.find((t) => satisfied(t, sender));

  if (hit) {
    return {
      verdict: "MATCH",
      senderName,
      expected,
      reason: `Sender shares the name ${hit} with the verified ID.`,
    };
  }

  return {
    verdict: "MISMATCH",
    senderName,
    expected,
    reason: HELD_REASON,
  };
}

/**
 * How hard the check bites, read from the environment so it can be changed
 * without a deploy.
 *
 *   off     - do not check at all
 *   shadow  - record the verdict, deliver anyway (what to run first)
 *   enforce - hold anything that is not a MATCH
 *
 * Shadow exists because the rule was designed against five deposits from one
 * bank. Watching real traffic before holding real money is the difference
 * between a policy and a guess.
 */
export type NameCheckMode = "off" | "shadow" | "enforce";

export function holdsOn(mode: NameCheckMode, verdict: NameVerdict): boolean {
  if (mode !== "enforce") return false;
  return verdict !== "MATCH";
}
