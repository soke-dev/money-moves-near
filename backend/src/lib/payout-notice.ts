/**
 * What to say when a naira payout lands, or does not.
 *
 * Two paths settle a sell - the Flutterwave webhook, and the poll that covers
 * for a webhook that never arrives - and they had drifted into describing the
 * same event differently. One said "Payout sent / on its way to your bank",
 * the other "Sell completed / sent to <name>". Whichever won the race decided
 * what the person read. Both call this now, so they cannot disagree again.
 *
 * "Your bank" was wrong as often as it was right. A sell pays out to whatever
 * account was entered, which is frequently somebody else's, so the wording
 * claimed something about the destination that nothing had established. This
 * names the account and says nothing about whose it is - which happens to read
 * correctly either way.
 */

/** Bank resolution answers in capitals. "OKORO COLLINS" in a notification
 *  reads as an error rather than as a name. */
function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * Where the money went, as short as it can be said.
 *
 * The resolved account name first, because that is what the person typed the
 * account number to confirm. Failing that the bank and the last four digits,
 * which is enough to recognise it. Failing both, nothing - and the caller
 * leaves the destination out of the sentence rather than inventing one.
 */
export function payoutDestination(meta: unknown): string | null {
  const m = (meta ?? {}) as Record<string, unknown>;

  const name = String(m.accountName ?? "").trim();
  if (name) return name === name.toUpperCase() ? titleCase(name) : name;

  const bank = String(m.bankName ?? "").trim();
  const acct = String(m.accountNumber ?? "").trim();
  if (bank && acct.length >= 4) return `${bank} ••${acct.slice(-4)}`;

  return bank || null;
}

export function payoutNotice(
  meta: unknown,
  outcome: "sent" | "failed",
): { title: string; body: string } {
  const m = (meta ?? {}) as Record<string, unknown>;
  const amount = `₦${Number(m.ngnNet ?? 0).toLocaleString()}`;
  const to = payoutDestination(m);

  if (outcome === "sent") {
    return {
      title: "Transfer sent",
      body: to ? `${amount} is on its way to ${to}.` : `${amount} is on its way.`,
    };
  }

  return {
    title: "Transfer failed",
    body: to
      ? `${amount} to ${to} did not go through. Contact support.`
      : `${amount} did not go through. Contact support.`,
  };
}
