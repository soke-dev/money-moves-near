import "dotenv/config";
import { prisma } from "../lib/prisma";
import { redeemVoucher, generateCode, normaliseCode, parseRequirements } from "../lib/voucher";

/**
 * Try to break the claim rules on purpose.
 *
 * Every voucher here pays 0.01 so a hole that opens costs a penny rather than
 * a float. What it cannot prove is the database lock - two claims racing for
 * the last place need two connections arriving together, which is the one
 * thing a script in one process cannot stage honestly. That is exercised by
 * the FOR UPDATE itself and reasoned about, not asserted here.
 *
 *   npx tsx src/scripts/voucher-audit.ts <user>
 */
let pass = 0, fail = 0;
function ok(what: string, cond: boolean, detail = "") {
  (cond ? pass++ : fail++);
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${what}${detail ? `  — ${detail}` : ""}`);
}

async function main() {
  const who = process.argv[2];
  if (!who) { console.log("Usage: voucher-audit.ts <username|email>"); return; }
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: who.replace(/^@/, "") }, { email: who }] },
    select: { id: true, username: true },
  });
  if (!user) { console.log("No such user."); return; }
  console.log(`\nprobing as @${user.username}\n`);

  const made: string[] = [];
  /** Written straight past the API, the way a bad migration or an older build would. */
  const plant = async (data: any) => {
    const code = normaliseCode(generateCode());
    await prisma.voucher.create({ data: { code, rewardAmount: 0.01, ...data } });
    made.push(code);
    return code;
  };

  try {
    console.log("requirements that cannot be understood");

    const typo = await plant({
      status: "ACTIVE", totalClaims: 5,
      requirements: [{ kind: "kycVerified" }],
    });
    const t = await redeemVoucher(user.id, typo);
    ok("a mistyped rule refuses rather than opening the voucher", !t.ok,
       t.ok ? "IT PAID" : t.reason);

    const junk = await plant({
      status: "ACTIVE", totalClaims: 5,
      requirements: [{ nonsense: true }],
    });
    ok("a rule with no kind at all refuses", !(await redeemVoucher(user.id, junk)).ok);

    const mixed = await plant({
      status: "ACTIVE", totalClaims: 5,
      requirements: [{ kind: "accountAgeDays", days: 0 }, { kind: "fromTheFuture" }],
    });
    ok("one bad rule among good ones still refuses", !(await redeemVoucher(user.id, mixed)).ok);

    console.log("\nthe front door rejects them too");
    for (const [label, input] of [
      ["unknown kind", [{ kind: "kycVerified" }]],
      ["no kind", [{ nonsense: true }]],
      ["negative age", [{ kind: "accountAgeDays", days: -5 }]],
      ["age that is not a number", [{ kind: "accountAgeDays", days: "soon" }]],
      ["zero transactions", [{ kind: "minTransactions", count: 0 }]],
      ["a date that is not one", [{ kind: "joinedBefore", date: "whenever" }]],
      ["not even a list", { kind: "verified" }],
    ] as [string, unknown][]) {
      let threw = false;
      try { parseRequirements(input); } catch { threw = true; }
      ok(`rejected at creation: ${label}`, threw);
    }
    let fine = true;
    try {
      const out = parseRequirements([{ kind: "accountAgeDays", days: "30" }]);
      fine = out.length === 1 && (out[0] as any).days === 30;
    } catch { fine = false; }
    ok("a good rule still passes, and is coerced", fine);

    console.log("\ncaps and windows");

    const perUser = await plant({ status: "ACTIVE", totalClaims: 10, perUserClaims: 1 });
    const pv = await prisma.voucher.findUnique({ where: { code: perUser }, select: { id: true } });
    await prisma.voucherClaim.create({
      data: { voucherId: pv!.id, userId: user.id, amount: 0.01, status: "PENDING" },
    });
    const again = await redeemVoucher(user.id, perUser);
    ok("a claim still PENDING holds the place", !again.ok && /already claimed/i.test(again.reason),
       !again.ok ? again.reason : "IT PAID");

    const gone = await plant({ status: "ACTIVE", totalClaims: 2 });
    const gv = await prisma.voucher.findUnique({ where: { code: gone }, select: { id: true } });
    const others = await prisma.user.findMany({
      where: { id: { not: user.id } }, take: 2, select: { id: true },
    });
    for (const o of others) {
      await prisma.voucherClaim.create({
        data: { voucherId: gv!.id, userId: o.id, amount: 0.01, status: "SENT" },
      });
    }
    if (others.length === 2) {
      const full = await redeemVoucher(user.id, gone);
      ok("the total cap holds against other people's claims", !full.ok && /all gone/i.test(full.reason),
         !full.ok ? full.reason : "IT PAID");
    } else {
      console.log("  SKIP  total cap — needs two other accounts");
    }

    const expired = await plant({
      status: "ACTIVE", totalClaims: 5, endsAt: new Date(Date.now() - 1000),
    });
    ok("a voucher one second past its end refuses", !(await redeemVoucher(user.id, expired)).ok);

    /** Failed claims must not hold a place, or a bad send locks somebody out. */
    const retry = await plant({ status: "ACTIVE", totalClaims: 5, perUserClaims: 1 });
    const rv = await prisma.voucher.findUnique({ where: { code: retry }, select: { id: true } });
    await prisma.voucherClaim.create({
      data: { voucherId: rv!.id, userId: user.id, amount: 0.01, status: "FAILED" },
    });
    const after = await redeemVoucher(user.id, retry);
    ok("a FAILED claim does not lock somebody out", !/already claimed/i.test(after.ok ? "" : after.reason),
       after.ok ? "paid" : after.reason);

    console.log("\ncodes");
    const draft = await plant({ status: "DRAFT", totalClaims: 5 });
    const d = await redeemVoucher(user.id, draft);
    const u = await redeemVoucher(user.id, "MMV-ZZZZ-ZZZZ");
    ok("a draft is indistinguishable from a code that does not exist",
       !d.ok && !u.ok && d.reason === u.reason, !d.ok ? d.reason : "");

    const cased = await plant({ status: "ACTIVE", totalClaims: 5, perUserClaims: 2 });
    const lower = await redeemVoucher(user.id, cased.toLowerCase());
    ok("case and spacing do not make a second voucher",
       // Matched on "invalid", not the whole sentence: the point of the check
       // is that a lower-cased code still FINDS its voucher, and pinning the
       // exact copy means a reworded message silently passes this for ever.
       lower.ok || !/invalid/i.test(lower.reason), lower.ok ? "matched" : lower.reason);
    console.log("\nlucky vouchers");
    {
      /**
       * Four slices, all different, one person allowed all four.
       *
       * The cheapest arrangement that can prove the thing worth proving: that
       * four claims take four DIFFERENT slices. A slice handed out twice is
       * the failure that costs real money, and it is invisible from the
       * outside - everybody gets paid, the pot just runs short at the end.
       */
      const code = normaliseCode(generateCode());
      await prisma.voucher.create({
        data: {
          code,
          mode: "LUCKY",
          potAmount: 0.1,
          rewardAmount: 0.025,
          totalClaims: 4,
          perUserClaims: 4,
          status: "ACTIVE",
          slices: {
            create: [
              { position: 0, amount: 0.01 },
              { position: 1, amount: 0.02 },
              { position: 2, amount: 0.03 },
              { position: 3, amount: 0.04 },
            ],
          },
        },
      });
      made.push(code);

      const got: number[] = [];
      for (let i = 0; i < 4; i++) {
        const r = await redeemVoucher(user.id, code);
        if (r.ok) got.push(r.amount);
      }

      ok("four claims take four slices", got.length === 4, got.join(", "));
      ok("no slice is handed out twice", new Set(got).size === got.length, got.join(", "));
      ok("they add up to the pot", Math.abs(got.reduce((a, b) => a + b, 0) - 0.1) < 1e-9,
         got.reduce((a, b) => a + b, 0).toFixed(4));

      const fifth = await redeemVoucher(user.id, code);
      ok("a fifth claim finds nothing left", !fifth.ok, fifth.ok ? "IT PAID" : fifth.reason);

      const linked = await prisma.voucherSlice.count({ where: { voucher: { code }, claimId: { not: null } } });
      ok("every slice is tied to the claim that took it", linked === 4, `${linked} of 4`);

      const last = await redeemVoucher(user.id, code);
      ok("and keeps finding nothing", !last.ok);
    }

  } finally {
    const del = await prisma.voucher.deleteMany({ where: { code: { in: made } } });
    console.log(`\ncleaned up ${del.count} probe voucher(s)`);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
}

main().catch((e) => console.error(e)).finally(() => prisma.$disconnect());
