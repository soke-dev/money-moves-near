import "dotenv/config";
import { prisma } from "../lib/prisma";
import { redeemVoucher, generateCode, voucherReserved, normaliseCode } from "../lib/voucher";
import { voucherTreasuryBalance, isVoucherTreasuryConfigured } from "../lib/voucher-treasury";

/**
 * Exercise the claim engine without paying anybody.
 *
 * Every refusal path is reachable with a voucher worth nothing to anyone: the
 * rules, the caps, the double claim. The only thing this cannot prove is the
 * transfer itself, which needs a funded float - so it stops at the point where
 * money would move and says so.
 *
 *   npx tsx src/scripts/voucher-test.ts <username|email>
 */
let pass = 0;
let fail = 0;
function ok(what: string, cond: boolean, detail = "") {
  (cond ? pass++ : fail++);
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${what}${detail ? `  — ${detail}` : ""}`);
}

async function main() {
  const who = process.argv[2];
  if (!who) { console.log("Usage: voucher-test.ts <username|email>"); return; }

  const user = await prisma.user.findFirst({
    where: { OR: [{ username: who.replace(/^@/, "") }, { email: who }] },
    select: { id: true, username: true, kycStatus: true, createdAt: true },
  });
  if (!user) { console.log("No such user."); return; }

  console.log(`\nuser      @${user.username}  kyc=${user.kycStatus}`);
  console.log(`treasury  configured=${isVoucherTreasuryConfigured()}  balance=${await voucherTreasuryBalance()} USDC\n`);

  const made: string[] = [];
  const mk = async (data: any) => {
    const code = normaliseCode(generateCode());
    await prisma.voucher.create({ data: { code, rewardAmount: 0.01, ...data } });
    made.push(code);
    return code;
  };

  try {
    console.log("refusals");

    ok("unknown code refused", !(await redeemVoucher(user.id, "NOPE-NOPE-NOPE")).ok);

    const draft = await mk({ status: "DRAFT", totalClaims: 5 });
    const d = await redeemVoucher(user.id, draft);
    ok("draft looks identical to unknown", !d.ok && d.reason === "That code does not work.",
       !d.ok ? d.reason : "");

    const paused = await mk({ status: "PAUSED", totalClaims: 5 });
    ok("paused refused", !(await redeemVoucher(user.id, paused)).ok);

    const ended = await mk({ status: "ENDED", totalClaims: 5 });
    ok("ended refused", !(await redeemVoucher(user.id, ended)).ok);

    const expired = await mk({ status: "ACTIVE", totalClaims: 5, endsAt: new Date(Date.now() - 864e5) });
    ok("past its end date refused", !(await redeemVoucher(user.id, expired)).ok);

    const future = await mk({ status: "ACTIVE", totalClaims: 5, startsAt: new Date(Date.now() + 864e5) });
    ok("not started yet refused", !(await redeemVoucher(user.id, future)).ok);

    const full = await mk({ status: "ACTIVE", totalClaims: 1 });
    const fullV = await prisma.voucher.findUnique({ where: { code: full }, select: { id: true } });
    await prisma.voucherClaim.create({
      data: { voucherId: fullV!.id, userId: user.id, amount: 0.01, status: "SENT" },
    });
    const f = await redeemVoucher(user.id, full);
    ok("already claimed refused", !f.ok && /already claimed/i.test(f.reason), !f.ok ? f.reason : "");

    console.log("\nrules");

    const needsAge = await mk({
      status: "ACTIVE", totalClaims: 5,
      requirements: [{ kind: "accountAgeDays", days: 36500 }],
    });
    const a = await redeemVoucher(user.id, needsAge);
    ok("impossible age rule refuses", !a.ok);
    ok("refusal carries the rules", !a.ok && Array.isArray(a.rules) && a.rules.length === 1,
       !a.ok && a.rules ? a.rules[0].label : "no rules");
    ok("rule is marked unmet", !a.ok && !!a.rules && a.rules[0].met === false);

    const needsTx = await mk({
      status: "ACTIVE", totalClaims: 5,
      requirements: [{ kind: "minTransactions", count: 999999 }],
    });
    const t = await redeemVoucher(user.id, needsTx);
    ok("transaction-count rule refuses", !t.ok && !!t.rules);

    const passable = await mk({
      status: "ACTIVE", totalClaims: 5,
      requirements: [{ kind: "accountAgeDays", days: 0 }],
    });

    console.log("\nreserve");
    const before = await voucherReserved();
    ok("reserve counts live vouchers", before.reserved > 0, `${before.reserved.toFixed(4)} USDC held`);

    console.log("\nthe payout");
    const balance = await voucherTreasuryBalance();
    if (balance <= 0) {
      console.log("  SKIP  float is empty — fund the wallet to test a real transfer");
      const r = await redeemVoucher(user.id, passable);
      ok("a qualifying claim reaches the send", !r.ok && /could not send|confirm/i.test(r.reason),
         !r.ok ? r.reason : "it actually paid");
      const stuck = await prisma.voucherClaim.count({
        where: { userId: user.id, status: "FAILED", voucher: { code: passable } },
      });
      ok("a failed send is recorded, not silent", stuck === 1, `${stuck} failed row`);
      const retry = await redeemVoucher(user.id, passable);
      ok("a failed claim does not block a retry", !retry.ok && !/already claimed/i.test(retry.reason),
         !retry.ok ? retry.reason : "");
    } else {
      const r = await redeemVoucher(user.id, passable);
      ok("a qualifying claim pays", r.ok, r.ok ? r.txHash : r.reason);
      if (r.ok) {
        const again = await redeemVoucher(user.id, passable);
        ok("the same person cannot claim twice", !again.ok && /already claimed/i.test(again.reason));
      }
    }
  } finally {
    // Everything this made, removed. Claims go with them by cascade.
    const del = await prisma.voucher.deleteMany({ where: { code: { in: made } } });
    console.log(`\ncleaned up ${del.count} test voucher(s)`);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
}

main().catch((e) => console.error(e)).finally(() => prisma.$disconnect());
