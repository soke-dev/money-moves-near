/**
 * Does the name on a bank account belong to this business?
 *
 * Banks spell names their own way: capitals, initials, "LTD" or "LIMITED",
 * product tags in brackets, words in any order, long names cut short. So this
 * compares the words that carry the name and ignores the ones every company
 * has. It's deliberately strict - an account that doesn't clearly match goes
 * to a person to check, never through on a guess.
 */
const COMMON = new Set([
  "LTD", "LIMITED", "PLC", "NIG", "NIGERIA", "CO", "COMPANY", "ENTERPRISE", "ENTERPRISES", "VENTURES", "GLOBAL",
  "INTL", "INTERNATIONAL", "THE", "AND", "OF", "SERVICES", "SOLUTIONS", "RC", "BN", "MR", "MRS", "MS", "DR",
]);

const words = (s: string) =>
  s
    .toUpperCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !COMMON.has(w));

export function namesMatch(accountName: string, expected: string | null | undefined): boolean {
  if (!expected) return false;
  const have = new Set(words(accountName));
  const want = words(expected);
  if (want.length === 0) return false;
  const hits = want.filter((w) => have.has(w)).length;
  // A one-word name has to be there and be most of the account name; a longer one needs at least two of its words and most of them.
  return want.length === 1 ? hits === 1 && have.size <= 2 : hits >= 2 && hits / want.length >= 0.6;
}
