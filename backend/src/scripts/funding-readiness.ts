import "dotenv/config";
import { prisma } from "../lib/prisma";
import { getFlutterwaveToken } from "../lib/flutterwave";
import { env } from "../config/env";

/**
 * Would a deposit work for this person, right now? Read-only.
 *
 * Walks the same gates POST /funding does, in the same order, and says which
 * one would stop them - rather than approving an account and finding out when
 * they try. Every call is a GET.
 *
 *   npx tsx src/scripts/funding-readiness.ts <username|email>
 */

const usableNin = (v: string) => /^[1-9]\d{10}$/.test(v);

async function main() {
  const who = process.argv[2];
  if (!who) {
    console.log("Usage: funding-readiness.ts <username|email>");
    return;
  }

  const user = await prisma.user.findFirst({
    where: { OR: [{ username: who.replace(/^@/, "") }, { email: who }] },
    select: { id: true, username: true, email: true, firstName: true, lastName: true, kycStatus: true },
  });
  if (!user) {
    console.log("No such user.");
    return;
  }

  console.log(`@${user.username}  ${user.email}`);

  const ok = (label: string, good: boolean, detail: string) =>
    console.log(`  ${good ? "PASS" : "FAIL"}  ${label.padEnd(22)} ${detail}`);

  ok("kyc verified", user.kycStatus === "VERIFIED", String(user.kycStatus));
  ok(
    "name on account",
    !!(user.firstName && user.lastName),
    `${user.firstName ?? "—"} ${user.lastName ?? "—"}`
  );

  const claims = await prisma.identityClaim.findMany({
    where: { userId: user.id, kind: "national_number" },
    select: { key: true },
    orderBy: { createdAt: "desc" },
  });
  const candidates = claims.map((c) => c.key.replace(/^nin:/, "")).filter(usableNin);
  const verified = await prisma.kycVerification.findFirst({
    where: { userId: user.id, status: "VERIFIED" },
    orderBy: { createdAt: "desc" },
    select: { documentNumber: true },
  });
  const onDocument = (verified?.documentNumber ?? "").replace(/\D/g, "");
  const nin = candidates.find((c) => c === onDocument) ?? candidates[0] ?? null;
  ok("nin the bank accepts", !!nin, nin ?? "none usable");

  /**
   * The customer record, which is cached by email and never rebuilt.
   *
   * If one was created while the account had no name, that is the customer the
   * bank sees for ever after - and the names on it are what a NIN gets checked
   * against. Worth knowing before concluding a deposit will work.
   */
  const accountKey = `customer:${user.email.toLowerCase()}`;
  const cached = await prisma.payoutRecipient.findUnique({
    where: { provider_accountKey: { provider: "flutterwave", accountKey } },
    select: { recipientId: true, createdAt: true },
  });

  if (!cached) {
    console.log(`  --    flutterwave customer  none cached — one is created on first deposit`);
  } else {
    const base = env.FLUTTERWAVE_BASE_URL.replace(/\/$/, "");
    const token = await getFlutterwaveToken();
    const res = await fetch(`${base}/customers/${cached.recipientId}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const body: any = await res.json().catch(() => ({}));
    const name = body?.data?.name ?? {};
    const hasName = !!(name.first || name.last);
    ok(
      "flutterwave customer",
      hasName,
      `${cached.recipientId} — name on it: ${JSON.stringify(name)}`
    );
    if (!hasName) {
      console.log(
        "        cached from before this account had a name; the bank checks the NIN against it"
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
