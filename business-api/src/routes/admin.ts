/**
 * The admin console's Business side: every business, what it has taken and
 * where that went - and the levers: verify, deactivate and reactivate a business, put
 * its details right, set its fee, approve a bank account by hand, and sort out
 * a settlement that didn't land.
 *
 * Who's an admin is the Money Moves app's call (lib/admin). The actions that
 * cost the most if abused also take the action password. Everything an admin
 * changes goes in the audit log under their email, and every settlement keeps
 * its own timeline.
 */
import { Router, type Request } from "express";
import { z } from "zod";
import type { BankAccount, BusinessStatus, CryptoArrival, Mode, Payment, PaymentLink, Prisma, Refund, RefundEvent, SettleChain, Settlement, SettlementEvent, SettlementStatus, User } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { body, HttpError } from "../lib/http";
import { audit } from "../lib/audit";
import { limited } from "../lib/limits";
import { needActionPassword, requireAdmin } from "../lib/admin";
import { newSettlementRef } from "../lib/money";
import { railsFor } from "../rails";
import { logSettlement, recordPayout, sendSettlement } from "../services/payments";
import { REFUND_WITHIN_MS, markRefundSent } from "../services/refunds";
import { requestShape } from "./requests";
import adminSupportRoutes from "./admin-support";
import { keepOneDefault, nameOnRecord, recheckBanks } from "../lib/banks";
import { DEFAULT_CHAIN, NETWORKS, PLATFORM_DEFAULTS, chainPaused, effectiveChain, nairaDefaults, payoutsOn, platform, platformSchema, platformWithMeta, savePlatform } from "../lib/platform";
import { COIN_NETWORKS, liveReady, notLiveWhy } from "../lib/accept";
import { appPayReady } from "../lib/app-pay";
import { appLinksReady } from "../lib/app-links";
import { floatAddress, floatBalances, floatTxStatus, type FloatChain } from "../lib/float";
import { tonReceiveAddress } from "../lib/ton";
import { sendsFrom, sweepState, validReturnAddress, whyWords } from "../services/crypto-out";
import { weigh } from "../services/crypto-in";
import { depositKeysReady } from "../lib/deposit-keys";
import { stellarReceiveAddress, stellarState } from "../lib/stellar";
import { LockedDocument, checkEveryDocument, open as openDocument, vaultState } from "../lib/vault";
import { diditReady, getDecision } from "../lib/didit";
import { approvedEmail, decisionEmail, sendEmail } from "../lib/email";
import { DOCS, answersSchema, applyDecision, gaps, needsBack, ownersOf, payoutPlaces } from "../services/application";
import { invoiceShape } from "./invoices";
import { outletShape, outletStats } from "./outlets";
import { approveChange, changeShape, currentDetails, declineChange } from "../services/detail-changes";
import { REASON_WORDS, filesOf, isOpen, messageShape, recordBankClaim, teamDecide, teamMessage } from "../services/disputes";

const router = Router();
router.use(limited(900), requireAdmin);

// The help chat: every conversation, answered live.
router.use("/support", adminSupportRoutes);

/** A payout still "sending" or "sent" after this long needs a person to look. */
const STUCK_MS = 10 * 60_000;
const STATUSES: BusinessStatus[] = ["UNVERIFIED", "IN_REVIEW", "VERIFIED", "SUSPENDED"];

const naira = (kobo: number | null | undefined) => (kobo == null ? null : kobo / 100);
const nameOf = (u: Pick<User, "firstName" | "lastName"> | null | undefined) => [u?.firstName, u?.lastName].filter(Boolean).join(" ") || null;
const modeOf = (q: unknown): Mode | null => (String(q).toLowerCase() === "test" ? "TEST" : String(q).toLowerCase() === "all" ? null : "LIVE");

function paging(q: Request["query"]) {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(q.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
}
const pagination = (page: number, limit: number, total: number) => ({ page, pages: Math.max(1, Math.ceil(total / limit)), total });

/** Everything an admin changes is written down, with who did it. */
const record = (req: Request, action: string, businessId: string | null, detail: Record<string, unknown> = {}) =>
  audit(req, `admin_${action}`, { businessId: businessId ?? undefined, detail: { ...detail, admin: req.admin!.email } as Prisma.InputJsonValue });

// ─── Shapes ───────────────────────────────────────────────────────────────

type Money = { mode: Mode; _count: { _all: number }; _sum: { receivedKobo: number | null }; _max: { paidAt: Date | null } };

function totals(rows: Money[]) {
  const pick = (mode: Mode) => {
    const m = rows.find((x) => x.mode === mode);
    return { payments: m?._count._all ?? 0, volumeNgn: (m?._sum.receivedKobo ?? 0) / 100, lastPaidAt: m?._max.paidAt ?? null };
  };
  return { live: pick("LIVE"), test: pick("TEST") };
}

type BusinessWithBits = Prisma.BusinessGetPayload<{ include: { _count: { select: { members: true; links: true } }; bankAccounts: true } }>;

function businessRow(b: BusinessWithBits, owner: User | null | undefined, money: Money[]) {
  const banks = b.bankAccounts.filter((x) => !x.removedAt);
  return {
    id: b.id,
    name: b.name,
    kind: b.kind,
    merchantId: b.merchantId,
    status: b.status,
    country: b.country,
    statusReason: b.statusReason,
    statusChangedAt: b.statusChangedAt,
    createdAt: b.createdAt,
    owner: owner ? { email: owner.email, name: nameOf(owner) } : null,
    members: b._count.members,
    links: b._count.links,
    banks: { total: banks.length, checked: banks.filter((x) => x.nameMatches).length, waiting: banks.filter((x) => !x.nameMatches && !x.reviewedAt).length },
    ...totals(money),
  };
}

const bankView = (b: BankAccount) => ({
  id: b.id,
  bankName: b.bankName,
  bankCode: b.bankCode,
  accountNumber: b.accountNumber,
  accountName: b.accountName,
  nameMatches: b.nameMatches,
  isDefault: b.isDefault,
  reviewedBy: b.reviewedBy,
  reviewedAt: b.reviewedAt,
  createdAt: b.createdAt,
  removedAt: b.removedAt,
});

const isStuck = (s: Settlement) => (s.status === "SENDING" || s.status === "SENT") && Date.now() - s.updatedAt.getTime() > STUCK_MS;

/** The Money Moves usernames behind these settlements, by link - for "who it went to" under "Money Moves". */
async function usernamesFor(list: Pick<Settlement, "destination" | "providerRef">[]): Promise<Map<string, string>> {
  const ids = [...new Set(list.filter((s) => s.destination === "MONEY_MOVES" && s.providerRef).map((s) => s.providerRef!))];
  if (!ids.length) return new Map();
  const links = await prisma.moneyMovesLink.findMany({ where: { appLinkId: { in: ids } }, select: { appLinkId: true, username: true } });
  return new Map(links.map((l) => [l.appLinkId, l.username]));
}

const settlementView = (s: Settlement & { business?: { name: string } | null; payment?: { ref: string } | null; events?: SettlementEvent[] }, usernames?: Map<string, string>) => ({
  id: s.id,
  ref: s.ref,
  mode: s.mode,
  status: s.status,
  stuck: isStuck(s),
  destination: s.destination,
  amountNgn: naira(s.amountKobo),
  feeNgn: naira(s.feeKobo),
  bankAccountId: s.bankAccountId,
  bankName: s.bankName,
  accountNumber: s.accountNumber,
  accountName: s.accountName,
  /** Who it went to, in words: the account name for a bank, @username for Money Moves, the business for its own wallet. */
  toName:
    s.destination === "BANK"
      ? s.accountName
      : s.destination === "MONEY_MOVES"
        ? s.providerRef && usernames?.get(s.providerRef)
          ? `@${usernames.get(s.providerRef)!.replace(/^@/, "")}`
          : null
        : (s.business?.name ?? null),
  failureReason: s.failureReason,
  chain: s.chain,
  toAddress: s.toAddress,
  amountUsdc: s.amountMicros != null ? Number(s.amountMicros) / 1e6 : null,
  txHash: s.txHash,
  sentAt: s.sentAt,
  settledAt: s.settledAt,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  business: s.business ? { id: s.businessId, name: s.business.name } : undefined,
  payment: s.payment ? { id: s.paymentId, ref: s.payment.ref } : undefined,
  events: s.events?.map((e) => ({ id: e.id, kind: e.kind, detail: e.detail, by: e.by, at: e.createdAt })),
});

const paymentView = (
  p: Payment & {
    business?: { name: string } | null;
    link?: Pick<PaymentLink, "name" | "slug"> | null;
    invoice?: { id: string; number: string } | null;
    outlet?: { id: string; name: string; slug: string } | null;
    settlement?: Settlement | null;
  },
) => ({
  id: p.id,
  ref: p.ref,
  mode: p.mode,
  status: p.status,
  method: p.method,
  currency: p.currency,
  amountNgn: naira(p.amountKobo),
  amountUsd: p.amountCents / 100,
  ngnPerUsd: p.ngnPerUsd,
  receivedNgn: naira(p.receivedKobo),
  feeNgn: naira(p.feeKobo),
  customer: { email: p.customerEmail, name: p.customerName, phone: p.customerPhone },
  // A crypto payer has no name - only where it came from.
  payer: p.payerName || p.payerBank || p.payerAccount ? { name: p.payerName, bank: p.payerBank, account: p.payerAccount, session: p.payerSession } : null,
  account: p.accountNumber ? { bank: p.accountBank, number: p.accountNumber, name: p.accountName } : null,
  deposit: p.depositAddress ? { coin: p.coin, network: p.network, address: p.depositAddress } : null,
  expiresAt: p.expiresAt,
  paidAt: p.paidAt,
  createdAt: p.createdAt,
  business: p.business ? { id: p.businessId, name: p.business.name } : undefined,
  link: p.link ?? null,
  invoice: p.invoice ?? null,
  outlet: p.outlet ?? null,
  settlement: p.settlement ? { id: p.settlement.id, ref: p.settlement.ref, status: p.settlement.status, stuck: isStuck(p.settlement) } : null,
});

// ─── Overview: is anything stuck ──────────────────────────────────────────

router.get("/overview", async (req, res) => {
  // Live unless asked: the home page leads with real money, and test is a tab away.
  const mode: Mode = String(req.query.mode ?? "").toLowerCase() === "test" ? "TEST" : "LIVE";
  const now = Date.now();
  const since = new Date(now - 86_400_000);
  const week = new Date(now - 7 * 86_400_000);
  const stuckBefore = new Date(now - STUCK_MS);
  const [byStatus, newThisWeek, failed, held, stuck, testFailed, waitingBanks, paidToday, settledToday, recent, applications, review, refundsToSend, chatsWaiting, detailChanges, cryptoReturns, disputesOpen] = await Promise.all([
    prisma.business.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.business.count({ where: { createdAt: { gte: week } } }),
    prisma.settlement.count({ where: { mode: "LIVE", status: "FAILED" } }),
    prisma.settlement.count({ where: { mode: "LIVE", status: "HELD" } }),
    prisma.settlement.count({ where: { mode: "LIVE", status: { in: ["SENDING", "SENT"] }, updatedAt: { lt: stuckBefore } } }),
    prisma.settlement.count({ where: { mode: "TEST", status: { in: ["FAILED", "HELD"] } } }),
    prisma.bankAccount.count({ where: { removedAt: null, nameMatches: false, reviewedAt: null } }),
    prisma.payment.groupBy({ by: ["mode"], where: { status: "PAID", paidAt: { gte: since } }, _count: { _all: true }, _sum: { receivedKobo: true } }),
    prisma.settlement.aggregate({ where: { mode, status: "SETTLED", settledAt: { gte: since } }, _count: { _all: true }, _sum: { amountKobo: true } }),
    prisma.payment.findMany({ where: { mode, status: { in: ["PAID", "UNDERPAID"] } }, orderBy: { paidAt: "desc" }, take: 8, include: { business: { select: { name: true } }, settlement: true } }),
    prisma.application.count({ where: { status: { in: ["SUBMITTED", "IN_REVIEW"] } } }),
    prisma.settlement.count({ where: { mode: "LIVE", status: "REVIEW" } }),
    prisma.refund.count({ where: { mode: "LIVE", status: "SENDING" } }),
    // Help chats with something from the business nobody on the team has read yet.
    prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM support_threads WHERE status = 'OPEN' AND (team_read_at IS NULL OR last_at > team_read_at)`.then((r) => r[0]?.n ?? 0),
    prisma.detailChange.count({ where: { status: "PENDING" } }),
    // Crypto to send back that only the team can: no address to use, or a send that failed.
    prisma.cryptoArrival.count({ where: { returnStatus: { in: ["MANUAL", "FAILED"] } } }),
    // Live disputes still open: customers waiting on a business, bank claims waiting on the bank's word.
    prisma.dispute.count({ where: { mode: "LIVE", status: { in: ["NEEDS_REPLY", "UNDER_REVIEW"] } } }),
  ]);
  const count = (s: BusinessStatus) => byStatus.find((x) => x.status === s)?._count._all ?? 0;
  const day = (mode: Mode) => {
    const m = paidToday.find((x) => x.mode === mode);
    return { payments: m?._count._all ?? 0, volumeNgn: (m?._sum.receivedKobo ?? 0) / 100 };
  };
  res.json({
    businesses: { total: byStatus.reduce((a, x) => a + x._count._all, 0), unverified: count("UNVERIFIED"), inReview: count("IN_REVIEW"), verified: count("VERIFIED"), suspended: count("SUSPENDED"), newThisWeek },
    attention: { failed, held, stuck, review, refundsToSend, chatsWaiting, detailChanges, cryptoReturns, disputesOpen, inReview: count("IN_REVIEW"), applications, waitingBanks, testFailed, documentsLocked: vaultState().state === "locked" },
    mode: mode.toLowerCase(),
    today: { live: day("LIVE"), test: day("TEST"), settled: { count: settledToday._count._all, amountNgn: (settledToday._sum.amountKobo ?? 0) / 100 } },
    recent: recent.map(paymentView),
  });
});

// ─── Businesses ───────────────────────────────────────────────────────────

router.get("/businesses", async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const q = String(req.query.q ?? "").trim();
  const status = String(req.query.status ?? "").toUpperCase() as BusinessStatus;
  const where: Prisma.BusinessWhereInput = {
    ...(STATUSES.includes(status) ? { status } : {}),
    // "Banks to check": an account the automatic check couldn't match, that nobody has looked at yet.
    ...(req.query.needs === "banks" ? { bankAccounts: { some: { removedAt: null, nameMatches: false, reviewedAt: null } } } : {}),
    // "Details to check": a name, phone or support contact the business asked to change.
    ...(req.query.needs === "changes" ? { detailChanges: { some: { status: "PENDING" } } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { merchantId: q.toUpperCase() },
            { members: { some: { user: { email: { contains: q.toLowerCase() } } } } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.business.count({ where }),
    prisma.business.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: { _count: { select: { members: true, links: true } }, bankAccounts: true, members: { where: { role: "OWNER" }, include: { user: true }, take: 1 } },
    }),
  ]);
  const ids = rows.map((r) => r.id);
  const money = ids.length
    ? await prisma.payment.groupBy({ by: ["businessId", "mode"], where: { businessId: { in: ids }, status: "PAID" }, _count: { _all: true }, _sum: { receivedKobo: true }, _max: { paidAt: true } })
    : [];
  res.json({
    businesses: rows.map((b) => businessRow(b, b.members[0]?.user, money.filter((m) => m.businessId === b.id))),
    pagination: pagination(page, limit, total),
  });
});

const DAY_MS = 86_400_000;

/** The last 30 days, Lagos time (UTC+1 all year), oldest first - the chart's x-axis. */
function lastDays(n = 30) {
  const today = Date.now() + 3_600_000;
  return Array.from({ length: n }, (_, i) => new Date(today - (n - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

/** Who an audit entry is: the admin written with it, the business user, or the system. */
const byOf = (a: { userId: string | null; detail: Prisma.JsonValue }, people: { id: string; email: string }[]) => {
  const d = (a.detail ?? {}) as Record<string, unknown>;
  return typeof d.admin === "string" ? `${d.admin} (admin)` : (people.find((p) => p.id === a.userId)?.email ?? "system");
};
const STATUS_ACTIONS = new Set(["admin_status_changed", "application_submitted", "admin_application_review", "admin_application_approve", "admin_application_reject", "admin_application_changes"]);

/**
 * One business, everything ops needs on one page: who it is, what it's taken
 * and where that went, what's stuck, its application, its people, its links,
 * and everything that's happened to it.
 */
router.get("/businesses/:id", async (req, res) => {
  const id = String(req.params.id);
  const b = await prisma.business.findUnique({
    where: { id },
    include: {
      _count: { select: { members: true, links: true } },
      bankAccounts: { orderBy: { createdAt: "asc" } },
      members: {
        include: { user: { include: { sessions: { where: { revokedAt: null }, orderBy: { lastSeenAt: "desc" }, take: 1, select: { lastSeenAt: true } } } } },
        orderBy: { createdAt: "asc" },
      },
      application: true,
    },
  });
  if (!b) throw new HttpError(404, "No business with that id.", "not_found");
  const stuckBefore = new Date(Date.now() - STUCK_MS);
  const [byStatus, bySettlement, stuck, links, linkMoney, payments, settlements, log, daily, docs, identity, p, invoices, outlets] = await Promise.all([
    prisma.payment.groupBy({ by: ["mode", "status"], where: { businessId: id }, _count: { _all: true }, _sum: { receivedKobo: true, feeKobo: true }, _max: { paidAt: true } }),
    prisma.settlement.groupBy({ by: ["mode", "status"], where: { businessId: id }, _count: { _all: true }, _sum: { amountKobo: true } }),
    prisma.settlement.groupBy({ by: ["mode"], where: { businessId: id, status: { in: ["SENDING", "SENT"] }, updatedAt: { lt: stuckBefore } }, _count: { _all: true } }),
    prisma.paymentLink.findMany({ where: { businessId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.payment.groupBy({ by: ["linkId"], where: { businessId: id, status: "PAID", linkId: { not: null } }, _count: { _all: true }, _sum: { receivedKobo: true }, _max: { paidAt: true } }),
    prisma.payment.findMany({ where: { businessId: id, status: { not: "EXPIRED" } }, orderBy: { createdAt: "desc" }, take: 6, include: { link: { select: { name: true, slug: true } }, invoice: { select: { id: true, number: true } }, outlet: { select: { id: true, name: true, slug: true } }, settlement: true } }),
    prisma.settlement.findMany({ where: { businessId: id }, orderBy: { createdAt: "desc" }, take: 6, include: { payment: { select: { ref: true } } } }),
    prisma.auditLog.findMany({ where: { businessId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
    // Paid per day, Lagos time. Stored times are UTC without a zone, hence the double AT TIME ZONE.
    prisma.$queryRaw<{ day: string; mode: string; n: bigint; kobo: bigint | null }[]>`
      SELECT to_char((paid_at AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD') AS day, mode::text AS mode, count(*) AS n, sum(received_kobo) AS kobo
      FROM payments
      WHERE business_id = ${id} AND status = 'PAID' AND paid_at >= (now() AT TIME ZONE 'UTC') - interval '31 days'
      GROUP BY 1, 2`,
    prisma.document.findMany({ where: { businessId: id, replacedAt: null }, select: { kind: true, verdict: true } }),
    prisma.identityCheck.findFirst({ where: { businessId: id }, orderBy: { createdAt: "desc" } }),
    platform(),
    prisma.invoice.findMany({ where: { businessId: id }, orderBy: { createdAt: "desc" }, take: 100, include: { payments: { where: { status: "PAID" }, take: 1 } } }),
    prisma.outlet.findMany({ where: { businessId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const perOutlet = await outletStats(outlets.map((o) => o.id));
  // The log names a business user by id; an admin by the email written with the entry.
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set(log.map((a) => a.userId).filter((x): x is string => !!x))] } }, select: { id: true, email: true } });
  const owner = b.members.find((m) => m.role === "OWNER")?.user;
  const days = lastDays();

  const summary = (mode: Mode) => {
    const pay = (status: string) => byStatus.find((x) => x.mode === mode && x.status === status);
    const out = (statuses: string[]) => {
      const rows = bySettlement.filter((x) => x.mode === mode && statuses.includes(x.status));
      return { count: rows.reduce((a, x) => a + x._count._all, 0), amountNgn: rows.reduce((a, x) => a + (x._sum.amountKobo ?? 0), 0) / 100 };
    };
    const paid = pay("PAID");
    const short = pay("UNDERPAID");
    return {
      paid: { count: paid?._count._all ?? 0, volumeNgn: (paid?._sum.receivedKobo ?? 0) / 100, feesNgn: (paid?._sum.feeKobo ?? 0) / 100, lastPaidAt: paid?._max.paidAt ?? null },
      short: { count: short?._count._all ?? 0, volumeNgn: (short?._sum.receivedKobo ?? 0) / 100 },
      open: pay("OPEN")?._count._all ?? 0,
      expired: pay("EXPIRED")?._count._all ?? 0,
      settled: out(["SETTLED"]),
      moving: out(["QUEUED", "SENDING", "SENT"]),
      review: out(["REVIEW"]),
      held: out(["HELD"]),
      failed: out(["FAILED"]),
      stuck: stuck.find((x) => x.mode === mode)?._count._all ?? 0,
      daily: days.map((day) => {
        const r = daily.find((x) => x.day === day && x.mode === mode);
        return { day, count: r ? Number(r.n) : 0, volumeNgn: r ? Number(r.kobo ?? 0) / 100 : 0 };
      }),
    };
  };

  const statusEntry = log.find((a) => STATUS_ACTIONS.has(a.action));
  const fees = nairaDefaults(p);
  const answers = b.application ? answersSchema.parse(b.application.answers ?? {}) : null;
  const pendingChange = await prisma.detailChange.findFirst({ where: { businessId: id, status: "PENDING" }, orderBy: { createdAt: "desc" } });
  // Who it signed up through, and how many signed up through it.
  const [referrer, referredCount] = await Promise.all([
    b.referredById ? prisma.business.findUnique({ where: { id: b.referredById }, select: { id: true, name: true } }) : null,
    prisma.business.count({ where: { referredById: id } }),
  ]);
  res.json({
    detailChange: pendingChange ? { ...changeShape(pendingChange), current: await currentDetails(id) } : null,
    business: {
      ...businessRow(b, owner, byStatus.filter((x) => x.status === "PAID") as unknown as Money[]),
      settleChain: effectiveChain(b.settleChain, p),
      adminNote: b.adminNote,
      referral: { code: b.referralCode, referredBy: referrer, referred: referredCount },
      updatedAt: b.updatedAt,
      statusChangedBy: statusEntry ? byOf(statusEntry, people) : null,
      nameOnRecord: await nameOnRecord(id),
      fee: { rateBps: b.feeRateBps, capNgn: naira(b.feeCapKobo), defaultRateBps: fees.rateBps, defaultCapNgn: fees.capKobo / 100 },
    },
    money: { live: summary("LIVE"), test: summary("TEST") },
    application: b.application && {
      status: b.application.status,
      structure: answers?.structure ?? null,
      legalName: answers?.legalName ?? null,
      submittedAt: b.application.submittedAt,
      reviewedAt: b.application.reviewedAt,
      reviewedBy: b.application.reviewedBy,
      decisionNote: b.application.decisionNote,
      documents: {
        required: answers?.structure ? DOCS[answers.structure]!.length : 0,
        uploaded: docs.length,
        accepted: docs.filter((d) => d.verdict === "ACCEPTED").length,
        rejected: docs.filter((d) => d.verdict === "REJECTED").length,
      },
      identity: identity && { status: identity.status, name: [identity.firstName, identity.lastName].filter(Boolean).join(" ") || null, checkedAt: identity.checkedAt },
    },
    members: b.members.map((m) => ({
      id: m.id,
      role: m.role,
      email: m.user.email,
      name: nameOf(m.user),
      addedAt: m.createdAt,
      emailVerified: !!m.user.emailVerified,
      signsInWith: [m.user.passwordHash ? "Password" : null, m.user.googleSub ? "Google" : null].filter((x): x is string => !!x),
      twoStep: m.user.twoStep,
      lastActiveAt: m.user.sessions[0]?.lastSeenAt ?? null,
    })),
    bankAccounts: b.bankAccounts.map(bankView),
    links: links.map((l) => {
      const m = linkMoney.find((x) => x.linkId === l.id);
      return {
        id: l.id,
        slug: l.slug,
        name: l.name,
        description: l.description,
        mode: l.mode,
        active: l.active,
        deleted: !!l.deletedAt,
        currency: l.currency,
        amount: l.amountMinor != null ? l.amountMinor / 100 : null,
        min: l.minMinor != null ? l.minMinor / 100 : null,
        methods: l.methods,
        destination: l.destination,
        askPhone: l.askPhone,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt,
        paid: { count: m?._count._all ?? 0, volumeNgn: (m?._sum.receivedKobo ?? 0) / 100, lastPaidAt: m?._max.paidAt ?? null },
      };
    }),
    payments: payments.map(paymentView),
    settlements: await usernamesFor(settlements).then((names) => settlements.map((s) => settlementView(s, names))),
    invoices: invoices.map(invoiceShape),
    outlets: outlets.map((o) => outletShape(o, perOutlet.get(o.id))),
    activity: log.map((a) => ({ id: a.id, action: a.action, detail: a.detail, at: a.createdAt, by: byOf(a, people), ip: a.ip })),
  });
});

const editInput = z.object({
  name: z.string().trim().min(2, "Enter the business name.").max(120).optional(),
  kind: z.enum(["REGISTERED", "INDIVIDUAL"]).optional(),
  country: z.string().trim().toUpperCase().length(2, "Use the two-letter country code.").optional(),
  adminNote: z.string().trim().max(2000).nullish(),
  /** Basis points: 50 is 0.5%. Null puts the default back. */
  feeRateBps: z.number().int().min(0).max(1000, "Keep the rate at 10% or under.").nullish(),
  feeCapNgn: z.number().min(0).max(100_000, "Keep the cap at ₦100,000 or under.").nullish(),
  password: z.string().max(200).optional(),
});

router.patch("/businesses/:id", async (req, res) => {
  const id = String(req.params.id);
  const b = body(editInput, req);
  const before = await prisma.business.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "No business with that id.", "not_found");
  // A name decides whose bank accounts can be paid, and a fee is money: both take the password. A note doesn't.
  const sensitive = b.name !== undefined || b.kind !== undefined || b.feeRateBps !== undefined || b.feeCapNgn !== undefined;
  if (sensitive) await needActionPassword(req, b.password, "edit_business");
  const data: Prisma.BusinessUpdateInput = {};
  if (b.name !== undefined) data.name = b.name;
  if (b.kind !== undefined) data.kind = b.kind;
  if (b.country !== undefined) data.country = b.country;
  if (b.adminNote !== undefined) data.adminNote = b.adminNote || null;
  if (b.feeRateBps !== undefined) data.feeRateBps = b.feeRateBps;
  if (b.feeCapNgn !== undefined) data.feeCapKobo = b.feeCapNgn == null ? null : Math.round(b.feeCapNgn * 100);
  await prisma.business.update({ where: { id }, data });
  if (b.name !== undefined || b.kind !== undefined) await recheckBanks(id);
  const changed = Object.keys(data);
  await record(req, "business_edited", id, { fields: changed, ...(b.name !== undefined ? { from: before.name, to: b.name } : {}) });
  res.json({ ok: true, changed });
});

const statusInput = z.object({
  status: z.enum(["UNVERIFIED", "IN_REVIEW", "VERIFIED", "SUSPENDED"]),
  reason: z.string().trim().max(500).optional(),
  password: z.string().max(200).optional(),
});

/**
 * Verify, deactivate, reactivate. Deactivated (SUSPENDED): every checkout
 * stops, the business can look but change nothing and move no money, and its
 * live payouts wait in review for the team to release. Nothing is deleted - a
 * business is never deleted.
 */
router.post("/businesses/:id/status", async (req, res) => {
  const id = String(req.params.id);
  const b = body(statusInput, req);
  const biz = await prisma.business.findUnique({ where: { id } });
  if (!biz) throw new HttpError(404, "No business with that id.", "not_found");
  if (biz.status === b.status) throw new HttpError(400, `It's already ${b.status.toLowerCase().replace("_", " ")}.`, "no_change");
  if (b.status === "SUSPENDED" && (b.reason ?? "").length < 3) throw new HttpError(400, "Say why it's being deactivated. It's kept with the business.", "reason_required");
  if (b.status === "VERIFIED" || b.status === "SUSPENDED" || biz.status === "SUSPENDED") await needActionPassword(req, b.password, `status_${b.status.toLowerCase()}`);
  await prisma.business.update({ where: { id }, data: { status: b.status, statusReason: b.reason || null, statusChangedAt: new Date() } });
  await record(req, "status_changed", id, { from: biz.status, to: b.status, reason: b.reason || null });
  // Verified from here rather than through the application: they hear it all the same.
  if (b.status === "VERIFIED") {
    const m = approvedEmail(biz.name);
    for (const to of await ownersOf(id)) void sendEmail(to, m.subject, m.text, { html: m.html }).catch(() => {});
  }
  res.json({ ok: true, status: b.status });
});

/** A business's asked-for change to its name, phone or support contacts: approved, it goes live. */
router.post("/detail-changes/:id/approve", async (req, res) => {
  const b = body(z.object({ password: z.string().max(200).optional() }), req);
  await needActionPassword(req, b.password, "approve_details");
  const c = await approveChange(String(req.params.id), req.admin!.email);
  await record(req, "details_change_approved", c.businessId, { changes: c.changes });
  res.json({ ok: true });
});

router.post("/detail-changes/:id/decline", async (req, res) => {
  const b = body(z.object({ reason: z.string().trim().min(3, "Say why. The business sees it.").max(500) }), req);
  const c = await declineChange(String(req.params.id), req.admin!.email, b.reason);
  await record(req, "details_change_declined", c.businessId, { changes: c.changes, reason: b.reason });
  res.json({ ok: true });
});

/** Approving an account the automatic check couldn't match takes the password; turning one down doesn't. */
router.post("/bank-accounts/:id/review", async (req, res) => {
  const b = body(z.object({ approve: z.boolean(), password: z.string().max(200).optional() }), req);
  const acct = await prisma.bankAccount.findFirst({ where: { id: String(req.params.id), removedAt: null } });
  if (!acct) throw new HttpError(404, "That account isn't there any more.", "not_found");
  if (b.approve) await needActionPassword(req, b.password, "approve_bank");
  await prisma.bankAccount.update({ where: { id: acct.id }, data: { nameMatches: b.approve, reviewedBy: req.admin!.email, reviewedAt: new Date(), ...(b.approve ? {} : { isDefault: false }) } });
  await keepOneDefault(acct.businessId);
  await record(req, b.approve ? "bank_approved" : "bank_declined", acct.businessId, { bankAccountId: acct.id, bank: acct.bankName, last4: acct.accountNumber.slice(-4), name: acct.accountName });
  res.json({ ok: true });
});

// ─── Payments, across every business ──────────────────────────────────────

router.get("/payments", async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const q = String(req.query.q ?? "").trim();
  const mode = modeOf(req.query.mode);
  const status = String(req.query.status ?? "").toUpperCase();
  const where: Prisma.PaymentWhereInput = {
    ...(mode ? { mode } : {}),
    ...(req.query.businessId ? { businessId: String(req.query.businessId) } : {}),
    ...(req.query.linkId ? { linkId: String(req.query.linkId) } : {}),
    ...(req.query.invoiceId ? { invoiceId: String(req.query.invoiceId) } : {}),
    ...(req.query.outletId ? { outletId: String(req.query.outletId) } : {}),
    status: ["OPEN", "PAID", "UNDERPAID", "EXPIRED"].includes(status) ? (status as Payment["status"]) : { not: "EXPIRED" },
    ...(q
      ? {
          OR: [
            { ref: { contains: q.toUpperCase() } },
            { customerEmail: { contains: q.toLowerCase() } },
            { payerName: { contains: q, mode: "insensitive" } },
            { business: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit, include: { business: { select: { name: true } }, link: { select: { name: true, slug: true } }, invoice: { select: { id: true, number: true } }, outlet: { select: { id: true, name: true, slug: true } }, settlement: true } }),
  ]);
  res.json({ payments: rows.map(paymentView), pagination: pagination(page, limit, total) });
});

router.get("/payments/:id", async (req, res) => {
  const p = await prisma.payment.findUnique({
    where: { id: String(req.params.id) },
    include: { business: { select: { name: true } }, link: { select: { name: true, slug: true } }, invoice: { select: { id: true, number: true } }, outlet: { select: { id: true, name: true, slug: true } }, settlement: { include: { events: { orderBy: { createdAt: "asc" } } } } },
  });
  if (!p) throw new HttpError(404, "No payment with that id.", "not_found");
  res.json({
    payment: { ...paymentView(p), providerRef: p.providerRef, lastCheckedAt: p.lastCheckedAt, updatedAt: p.updatedAt },
    settlement: p.settlement ? settlementView(p.settlement) : null,
  });
});

// ─── Settlements: the queue ───────────────────────────────────────────────

router.get("/settlements", async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const mode = modeOf(req.query.mode);
  const view = String(req.query.view ?? "attention");
  const stuckBefore = new Date(Date.now() - STUCK_MS);
  const byView: Record<string, Prisma.SettlementWhereInput> = {
    attention: { OR: [{ status: { in: ["FAILED", "HELD"] } }, { status: { in: ["SENDING", "SENT"] }, updatedAt: { lt: stuckBefore } }] },
    review: { status: "REVIEW" },
    moving: { status: { in: ["QUEUED", "SENDING", "SENT"] } },
    settled: { status: "SETTLED" },
    all: {},
  };
  const where: Prisma.SettlementWhereInput = {
    ...(mode ? { mode } : {}),
    ...(req.query.businessId ? { businessId: String(req.query.businessId) } : {}),
    ...(byView[view] ?? byView.attention),
  };
  const [total, rows] = await Promise.all([
    prisma.settlement.count({ where }),
    prisma.settlement.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit, include: { business: { select: { name: true } }, payment: { select: { ref: true } } } }),
  ]);
  const names = await usernamesFor(rows);
  res.json({ settlements: rows.map((s) => settlementView(s, names)), pagination: pagination(page, limit, total) });
});

router.get("/settlements/:id", async (req, res) => {
  const s = await prisma.settlement.findUnique({
    where: { id: String(req.params.id) },
    include: { business: { select: { name: true } }, payment: { include: { link: { select: { name: true, slug: true } }, invoice: { select: { id: true, number: true } }, outlet: { select: { id: true, name: true, slug: true } } } }, events: { orderBy: { createdAt: "asc" } } },
  });
  if (!s) throw new HttpError(404, "No settlement with that id.", "not_found");
  // Where it could be sent instead: the business's checked, current accounts.
  const banks = await prisma.bankAccount.findMany({ where: { businessId: s.businessId, removedAt: null, nameMatches: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  // Queued on a chain switched off on Services: it waits for the chain, or for the team to pay it by hand.
  const paused = s.status === "QUEUED" && !!s.chain && chainPaused(s.chain, await platform());
  res.json({ settlement: { ...settlementView(s, await usernamesFor([s])), paused }, payment: paymentView(s.payment), bankAccounts: banks.map(bankView) });
});

const SETTLEMENT_NOT_FOUND = () => new HttpError(404, "No settlement with that id.", "not_found");

/** Ask the rail where a payout stands, and record what it says. */
router.post("/settlements/:id/check", async (req, res) => {
  const s = await prisma.settlement.findUnique({ where: { id: String(req.params.id) } });
  if (!s) throw SETTLEMENT_NOT_FOUND();
  if (s.destination !== "BANK" || !s.bankCode) throw new HttpError(400, "Nothing went to a bank for this one, so there's nothing to check with the rail.", "nothing_to_check");
  if (s.status === "QUEUED" || s.status === "HELD") throw new HttpError(400, "It hasn't been sent yet.", "not_sent");
  const answer = await railsFor(s.mode).checkPayout(s.ref, s.providerRef);
  await logSettlement(s.id, "checked", { answer: answer.state, ...("reason" in answer ? { reason: answer.reason } : {}) }, req.admin!.email);
  if (s.status === "SENDING" || s.status === "SENT") await recordPayout(s.id, answer, req.admin!.email);
  else if (s.status === "FAILED") {
    // Marked failed, but the rail says otherwise: believe the rail.
    if (answer.state === "settled") {
      await prisma.settlement.update({ where: { id: s.id }, data: { status: "SETTLED", settledAt: new Date(), failureReason: null } });
      await logSettlement(s.id, "settled", { note: "the rail says it arrived" }, req.admin!.email);
    } else if (answer.state === "pending") {
      await prisma.settlement.update({ where: { id: s.id }, data: { status: "SENT", failureReason: null } });
    } else if (answer.state === "failed") {
      await prisma.settlement.update({ where: { id: s.id }, data: { failureReason: answer.reason } });
    }
  }
  const after = await prisma.settlement.findUniqueOrThrow({ where: { id: s.id } });
  res.json({ answer, settlement: settlementView(after) });
});

/**
 * Send a failed or held settlement again. The rail is asked first, so a
 * payout that actually went through is never paid twice; then it goes out
 * under a new reference - to the account chosen, the one it was going to, or
 * the business's default.
 */
router.post("/settlements/:id/resend", async (req, res) => {
  const b = body(z.object({ password: z.string().max(200).optional(), bankAccountId: z.string().max(64).optional(), checkedFloat: z.boolean().optional() }), req);
  await needActionPassword(req, b.password, "resend_settlement");
  const s = await prisma.settlement.findUnique({ where: { id: String(req.params.id) } });
  if (!s) throw SETTLEMENT_NOT_FOUND();
  if (s.status !== "FAILED" && s.status !== "HELD") throw new HttpError(409, "Only a failed or held settlement can be sent again.", "not_resendable");
  const by = req.admin!.email;

  if (s.status === "FAILED" && s.bankCode) {
    const answer = await railsFor(s.mode).checkPayout(s.ref, s.providerRef);
    await logSettlement(s.id, "checked", { answer: answer.state, before: "resend" }, by);
    if (answer.state === "settled") {
      await prisma.settlement.update({ where: { id: s.id }, data: { status: "SETTLED", settledAt: new Date(), failureReason: null } });
      await logSettlement(s.id, "settled", { note: "the rail says the last attempt arrived. Nothing resent" }, by);
      res.json({ result: "already_settled" });
      return;
    }
    if (answer.state === "pending") throw new HttpError(409, "The rail says the last attempt is still on its way. Check again in a few minutes.", "still_pending");
  }

  // A USDC payout that failed: the chain is asked first, and one whose outcome was never clear goes again only once a person has checked the float.
  if (s.status === "FAILED" && s.chain && s.amountMicros) {
    const st = s.txHash ? await floatTxStatus(s.chain as FloatChain, s.txHash).catch(() => "unknown" as const) : "unknown";
    await logSettlement(s.id, "checked", { answer: st, before: "resend", tx: s.txHash ?? null }, by);
    if (st === "settled") {
      await prisma.settlement.update({ where: { id: s.id }, data: { status: "SETTLED", settledAt: new Date(), failureReason: null } });
      await logSettlement(s.id, "settled", { note: "the chain says the last attempt arrived. Nothing resent" }, by);
      res.json({ result: "already_settled" });
      return;
    }
    if (st === "pending") throw new HttpError(409, "The chain says the last attempt is still on its way. Check again in a few minutes.", "still_pending");
    // Refused before anything left the float (its own words), or failed on the chain: safe to send again.
    const refused = st === "failed" || /refused|low on USDC|isn't set|Nothing to send|^That isn't|^Couldn't build|failed on-chain/.test(s.failureReason ?? "");
    if (!refused && !b.checkedFloat) {
      throw new HttpError(409, "It's not clear this payout didn't go out. Check the float on-chain first: if it went, mark it delivered; if it didn't, tick that you checked and send again.", "check_float");
    }
  }

  let to: Pick<BankAccount, "bankCode" | "bankName" | "accountNumber" | "accountName"> & { id: string | null };
  // Test money never goes anywhere real - not even on paper: a test settlement goes back to the test bank.
  if (s.mode === "TEST") {
    const owner = await prisma.business.findUniqueOrThrow({ where: { id: s.businessId }, select: { name: true } });
    to = { id: null, bankCode: "TEST", bankName: "Test Bank", accountNumber: "0000000001", accountName: owner.name.toUpperCase() };
  } else if (b.bankAccountId) {
    const chosen = await prisma.bankAccount.findFirst({ where: { id: b.bankAccountId, businessId: s.businessId, removedAt: null } });
    if (!chosen) throw new HttpError(400, "That account isn't one of this business's.", "bad_bank");
    if (!chosen.nameMatches) throw new HttpError(400, "That account hasn't been checked, approve it first.", "bank_unchecked");
    to = chosen;
  } else if (s.destination === "BANK" && s.bankCode && s.accountNumber) {
    to = { id: s.bankAccountId, bankCode: s.bankCode, bankName: s.bankName ?? "", accountNumber: s.accountNumber, accountName: s.accountName ?? "" };
  } else {
    const fallback = await prisma.bankAccount.findFirst({ where: { businessId: s.businessId, removedAt: null, nameMatches: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
    if (!fallback) throw new HttpError(400, "This business has no checked bank account to send it to. Approve one first.", "no_bank");
    to = fallback;
  }

  const ref = newSettlementRef();
  const moved = await prisma.settlement.updateMany({
    where: { id: s.id, status: { in: ["FAILED", "HELD"] as SettlementStatus[] } },
    data: { ref, status: "QUEUED", destination: "BANK", bankAccountId: to.id, bankCode: to.bankCode, bankName: to.bankName, accountNumber: to.accountNumber, accountName: to.accountName, failureReason: null, providerRef: null, sentAt: null },
  });
  if (!moved.count) throw new HttpError(409, "Someone else just changed this settlement. Open it again.", "changed");
  // In test mode (and on staging) the "make it fail" switch was the problem being simulated; sending it again is the fix.
  await prisma.payment.update({ where: { id: s.paymentId }, data: { simFailSettlement: false } });
  await logSettlement(s.id, "resent", { previousRef: s.ref, ref, to: `${to.bankName} ${to.accountNumber}` }, by);
  await record(req, "settlement_resent", s.businessId, { settlementId: s.id, previousRef: s.ref, ref });
  void sendSettlement(await prisma.settlement.findUniqueOrThrow({ where: { id: s.id } }));
  res.json({ result: "queued", ref });
});

/** Delivered some other way (sent by hand from the rail's dashboard, say): marked settled, with how. */
/**
 * A payout waiting for review (over the limit, or its business deactivated),
 * checked and approved: it goes to the rail now. One that can't go through the
 * rail yet is paid by hand and marked delivered instead.
 */
router.post("/settlements/:id/approve", async (req, res) => {
  const b = body(z.object({ password: z.string().max(200).optional() }), req);
  await needActionPassword(req, b.password, "approve_settlement");
  const s = await prisma.settlement.findUnique({ where: { id: String(req.params.id) } });
  if (!s) throw SETTLEMENT_NOT_FOUND();
  if (s.status !== "REVIEW") throw new HttpError(409, "Only a payout waiting for review can be approved.", "not_in_review");
  if (s.destination !== "BANK" || !s.bankCode || !s.accountNumber) throw new HttpError(409, "This one can't go through the rail yet, pay it by hand, then mark it delivered.", "not_sendable");
  if (!(await payoutsOn())) throw new HttpError(409, "Payouts are switched off in Services. Approve it once they're back on.", "payouts_off");
  await logSettlement(s.id, "approved", { to: `${s.bankName} ${s.accountNumber}` }, req.admin!.email);
  await record(req, "settlement_approved", s.businessId, { settlementId: s.id, ref: s.ref });
  // Straight from review to the rail: a deactivated business's payout isn't held again on the way.
  await sendSettlement(s, { from: "REVIEW" });
  const after = await prisma.settlement.findUniqueOrThrow({ where: { id: s.id } });
  if (after.status === "REVIEW") throw new HttpError(409, "Someone else just changed this settlement. Open it again.", "changed");
  res.json({ result: "sending", status: after.status });
});

router.post("/settlements/:id/mark-settled", async (req, res) => {
  const b = body(z.object({ password: z.string().max(200).optional(), reference: z.string().trim().max(120).optional(), note: z.string().trim().max(500).optional() }), req);
  await needActionPassword(req, b.password, "mark_settled");
  const s = await prisma.settlement.findUnique({ where: { id: String(req.params.id) } });
  if (!s) throw SETTLEMENT_NOT_FOUND();
  // Queued on a chain switched off on Services, it waits for exactly this: the team paying it by hand.
  const pausedHere = s.status === "QUEUED" && !!s.chain && chainPaused(s.chain, await platform());
  const done = await prisma.settlement.updateMany({
    where: { id: s.id, status: { in: ["FAILED", "HELD", "REVIEW", "SENDING", "SENT", ...(pausedHere ? ["QUEUED"] : [])] as SettlementStatus[] } },
    data: { status: "SETTLED", settledAt: new Date(), failureReason: null },
  });
  if (!done.count) throw new HttpError(409, s.status === "SETTLED" ? "It's already settled." : "It's queued to send, wait for it, or check it once it's sent.", "not_markable");
  await logSettlement(s.id, "marked_settled", { reference: b.reference || null, note: b.note || null }, req.admin!.email);
  await record(req, "settlement_marked_settled", s.businessId, { settlementId: s.id, reference: b.reference || null });
  res.json({ ok: true });
});

router.post("/settlements/:id/note", async (req, res) => {
  const b = body(z.object({ note: z.string().trim().min(1, "Write the note.").max(1000) }), req);
  const s = await prisma.settlement.findUnique({ where: { id: String(req.params.id) }, select: { id: true } });
  if (!s) throw SETTLEMENT_NOT_FOUND();
  await logSettlement(s.id, "note", { note: b.note }, req.admin!.email);
  res.json({ ok: true });
});

// ─── KYC: applications to go live ─────────────────────────────────────────
//
// Real documents and Didit's real decision, reviewed by a person. Opening a
// document is written to the audit log: identity papers are read on purpose.

const APPLICATION_VIEWS: Record<string, Prisma.ApplicationWhereInput> = {
  queue: { status: { in: ["SUBMITTED", "IN_REVIEW"] } },
  changes: { status: "CHANGES_REQUESTED" },
  approved: { status: "APPROVED" },
  rejected: { status: "REJECTED" },
  drafts: { status: "DRAFT" },
  all: {},
};

router.get("/applications", async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const view = String(req.query.view ?? "queue");
  const where = APPLICATION_VIEWS[view] ?? APPLICATION_VIEWS.queue!;
  const [total, rows] = await Promise.all([
    prisma.application.count({ where }),
    prisma.application.findMany({
      where,
      // The queue is first come, first served; everything else newest first.
      orderBy: view === "queue" ? { submittedAt: "asc" } : { updatedAt: "desc" },
      skip,
      take: limit,
      include: {
        business: {
          include: {
            members: { where: { role: "OWNER" }, include: { user: true }, take: 1 },
            identityChecks: { orderBy: { createdAt: "desc" }, take: 1 },
            documents: { where: { replacedAt: null }, select: { id: true, verdict: true } },
          },
        },
      },
    }),
  ]);
  res.json({
    applications: rows.map((a) => {
      const answers = answersSchema.parse(a.answers ?? {});
      return {
        businessId: a.businessId,
        businessName: a.business.name,
        kind: a.business.kind,
        structure: answers.structure ?? null,
        legalName: answers.legalName ?? null,
        status: a.status,
        submittedAt: a.submittedAt,
        updatedAt: a.updatedAt,
        owner: a.business.members[0]?.user.email ?? null,
        identity: a.business.identityChecks[0]?.status ?? null,
        documents: a.business.documents.length,
        rejectedDocuments: a.business.documents.filter((d) => d.verdict === "REJECTED").length,
      };
    }),
    pagination: pagination(page, limit, total),
  });
});

/** What belongs in an application's own history. */
const APPLICATION_ACTIONS = new Set([
  "application_submitted",
  "admin_application_review",
  "admin_application_approve",
  "admin_application_reject",
  "admin_application_changes",
  "document_uploaded",
  "document_removed",
  "admin_document_accepted",
  "admin_document_rejected",
  "admin_document_viewed",
  "identity_started",
]);

router.get("/applications/:businessId", async (req, res) => {
  const businessId = String(req.params.businessId);
  const app = await prisma.application.findUnique({ where: { businessId } });
  if (!app) throw new HttpError(404, "This business hasn't started an application.", "not_found");
  const [business, docs, checks, banks, places, log] = await Promise.all([
    prisma.business.findUniqueOrThrow({ where: { id: businessId }, include: { members: { where: { role: "OWNER" }, include: { user: true }, take: 1 } } }),
    prisma.document.findMany({ where: { businessId, NOT: { kind: { startsWith: "request:" } } }, orderBy: { createdAt: "desc" }, select: { id: true, kind: true, filename: true, mime: true, size: true, verdict: true, verdictNote: true, reviewedBy: true, reviewedAt: true, uploadedBy: true, createdAt: true, replacedAt: true } }),
    prisma.identityCheck.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } }),
    prisma.bankAccount.findMany({ where: { businessId, removedAt: null }, orderBy: { createdAt: "asc" } }),
    payoutPlaces(businessId),
    prisma.auditLog.findMany({ where: { businessId, action: { in: [...APPLICATION_ACTIONS] } }, orderBy: { createdAt: "desc" }, take: 80 }),
  ]);
  const people = await prisma.user.findMany({
    where: { id: { in: [...new Set([...docs.map((d) => d.uploadedBy), ...checks.map((c) => c.userId), ...log.map((a) => a.userId).filter((x): x is string => !!x)])] } },
    select: { id: true, email: true },
  });
  const emailOf = (id: string) => people.find((p) => p.id === id)?.email ?? null;
  const answers = answersSchema.parse(app.answers ?? {});
  const active = docs.filter((d) => !d.replacedAt);
  res.json({
    application: { status: app.status, answers, submittedAt: app.submittedAt, reviewedAt: app.reviewedAt, reviewedBy: app.reviewedBy, decisionNote: app.decisionNote },
    business: { id: business.id, name: business.name, kind: business.kind, status: business.status, merchantId: business.merchantId, owner: business.members[0]?.user.email ?? null },
    // The filings, then each director's and owner's ID photos - named, so the team knows whose is whose.
    required: [
      ...(answers.structure ? DOCS[answers.structure]! : []),
      ...(answers.kind === "registered" ? (answers.people ?? []) : [])
        .filter((p) => p.id)
        .flatMap((p) => {
          const who = [p.first, p.last].filter(Boolean).join(" ") || "A person";
          const id = p.idType || "ID";
          return [
            { kind: `id-front:${p.id}`, label: `${who} to ${id}, front` },
            ...(needsBack(p.idType) ? [{ kind: `id-back:${p.id}`, label: `${who} to ${id}, back` }] : []),
          ];
        }),
    ],
    documents: docs.map((d) => ({ ...d, uploadedBy: emailOf(d.uploadedBy) })),
    identity: checks.map((c) => ({ id: c.id, status: c.status, providerStatus: c.providerStatus, firstName: c.firstName, lastName: c.lastName, dateOfBirth: c.dateOfBirth, documentLast4: c.documentLast4, warnings: c.warnings, sessionId: c.sessionId, startedBy: emailOf(c.userId), checkedAt: c.checkedAt, createdAt: c.createdAt })),
    identityReady: diditReady(),
    bankAccounts: banks.map(bankView),
    gaps: gaps(answers, active, checks[0] ?? null, places),
    history: log.map((a) => ({ id: a.id, action: a.action, detail: a.detail, at: a.createdAt, by: byOf(a, people) })),
  });
});

/** Whether the stored documents can be opened, and with which key. */
router.get("/documents/vault", async (_req, res) => {
  res.json({ ...vaultState(), documents: await prisma.document.count() });
});

/** Opens every stored document and checks it against the fingerprint taken when it arrived. */
router.post("/documents/check", async (req, res) => {
  const result = await checkEveryDocument();
  await record(req, "documents_checked", null, { total: result.total, readable: result.readable, unreadable: result.unreadable.length, altered: result.altered.length });
  res.json(result);
});

/** One document, decrypted, for an admin to read. Every opening is logged. */
router.get("/documents/:id", async (req, res) => {
  const doc = await prisma.document.findUnique({ where: { id: String(req.params.id) } });
  if (!doc) throw new HttpError(404, "No document with that id.", "not_found");
  let file: Buffer;
  try {
    file = openDocument(Buffer.from(doc.data));
  } catch (e) {
    if (e instanceof LockedDocument) throw new HttpError(423, e.message, "document_locked");
    throw e;
  }
  await record(req, "document_viewed", doc.businessId, { documentId: doc.id, kind: doc.kind });
  res.setHeader("Content-Type", doc.mime);
  res.setHeader("Content-Disposition", `inline; filename="${doc.filename.replace(/["\r\n]/g, "")}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(file);
});

router.post("/documents/:id/verdict", async (req, res) => {
  const b = body(z.object({ verdict: z.enum(["ACCEPTED", "REJECTED"]), note: z.string().trim().max(500).optional() }), req);
  const doc = await prisma.document.findUnique({ where: { id: String(req.params.id) }, select: { id: true, businessId: true, kind: true } });
  if (!doc) throw new HttpError(404, "No document with that id.", "not_found");
  await prisma.document.update({ where: { id: doc.id }, data: { verdict: b.verdict, verdictNote: b.note || null, reviewedBy: req.admin!.email, reviewedAt: new Date() } });
  await record(req, b.verdict === "ACCEPTED" ? "document_accepted" : "document_rejected", doc.businessId, { documentId: doc.id, kind: doc.kind, note: b.note || null });
  res.json({ ok: true });
});

router.post("/identity/:id/refresh", async (req, res) => {
  const check = await prisma.identityCheck.findUnique({ where: { id: String(req.params.id) } });
  if (!check) throw new HttpError(404, "No identity check with that id.", "not_found");
  if (!diditReady()) throw new HttpError(503, "Identity checks aren't connected on this server.", "identity_unavailable");
  await applyDecision(check, await getDecision(check.sessionId));
  res.json({ ok: true });
});

const decisionInput = z.object({
  decision: z.enum(["review", "approve", "reject", "changes"]),
  note: z.string().trim().max(2000).optional(),
  password: z.string().max(200).optional(),
});

/**
 * The decision. Approving switches live mode on; turning down and asking for
 * changes say why, in a note the business sees. Approving and turning down
 * take the action password. The owners hear about it by email.
 */
router.post("/applications/:businessId/decision", async (req, res) => {
  const businessId = String(req.params.businessId);
  const b = body(decisionInput, req);
  const app = await prisma.application.findUnique({ where: { businessId } });
  if (!app) throw new HttpError(404, "This business hasn't started an application.", "not_found");
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  const note = b.note || null;
  if ((b.decision === "reject" || b.decision === "changes") && (note ?? "").length < 3) throw new HttpError(400, "Say what's wrong. The business sees this note.", "note_required");
  if ((b.decision === "approve" || b.decision === "review") && app.status !== "SUBMITTED" && app.status !== "IN_REVIEW") throw new HttpError(409, "Only a submitted application can be reviewed or approved.", "not_submitted");
  if (b.decision === "approve" || b.decision === "reject") await needActionPassword(req, b.password, `application_${b.decision}`);
  if (b.decision === "approve") {
    // The account representative's identity has to be approved - asked again now if it's still being decided.
    let check = await prisma.identityCheck.findFirst({ where: { businessId }, orderBy: { createdAt: "desc" } });
    if (check && check.status !== "APPROVED" && check.status !== "DECLINED" && diditReady()) {
      const before = check;
      check = await getDecision(before.sessionId)
        .then((d) => applyDecision(before, d))
        .catch(() => before);
    }
    if (check?.status !== "APPROVED")
      throw new HttpError(
        409,
        !check
          ? "The account representative hasn't done an identity check. Ask for changes so they complete it."
          : check.status === "DECLINED"
            ? "Their identity check was declined. Ask for changes so they complete it again, then approve."
            : "Their identity check isn't approved yet. Wait for the result, or ask for changes so they finish it.",
        "identity_not_approved",
      );
  }
  const by = req.admin!.email;
  const now = new Date();
  const next = { review: ["IN_REVIEW", "IN_REVIEW"], approve: ["APPROVED", "VERIFIED"], reject: ["REJECTED", "UNVERIFIED"], changes: ["CHANGES_REQUESTED", "UNVERIFIED"] } as const;
  const [appStatus, businessStatus] = next[b.decision];
  await prisma.$transaction([
    prisma.application.update({ where: { businessId }, data: { status: appStatus, ...(b.decision === "review" ? {} : { reviewedAt: now, reviewedBy: by, decisionNote: note }) } }),
    prisma.business.update({ where: { id: businessId }, data: { status: businessStatus, statusChangedAt: now, statusReason: b.decision === "approve" ? "Application approved" : b.decision === "review" ? null : note } }),
  ]);
  await record(req, `application_${b.decision}`, businessId, { note });
  const m = b.decision === "approve" ? approvedEmail(business.name) : b.decision === "review" ? null : decisionEmail(b.decision, business.name, note ?? "");
  if (m) for (const to of await ownersOf(businessId)) await sendEmail(to, m.subject, m.text, { html: m.html });
  res.json({ ok: true, status: appStatus });
});

// ─── Refunds: the ones we send ────────────────────────────────────────────

type RefundRow = Refund & {
  business?: { name: string } | null;
  payment?: { id: string; ref: string; method: string; customerName: string | null; customerEmail: string | null; ngnPerUsd: number } | null;
  events?: RefundEvent[];
};

const refundView = (r: RefundRow) => ({
  id: r.id,
  ref: r.ref,
  mode: r.mode,
  status: r.status,
  funding: r.funding,
  businessId: r.businessId,
  business: r.business?.name ?? null,
  payment: r.payment ? { id: r.payment.id, ref: r.payment.ref, method: r.payment.method, customerName: r.payment.customerName, customerEmail: r.payment.customerEmail } : null,
  /** What the customer gets back: naira, or coins (a dollar each) for the app and crypto. */
  currency: r.payment?.method === "NAIRA" ? "NGN" : "USD",
  amountNgn: r.amountKobo / 100,
  amountUsd: r.amountCents / 100,
  feeBackNgn: r.feeBackKobo / 100,
  fundNgn: r.fundKobo / 100,
  fundUsd: r.fundCents / 100,
  fundAccount: r.fundAccount ? { bank: r.fundBank, number: r.fundAccount, name: r.fundName, expiresAt: r.fundExpiresAt } : null,
  to: { kind: r.toKind, name: r.toName, bank: r.toBank, account: r.toAccount, coin: r.toCoin, network: r.toNetwork },
  reason: r.reason,
  requestedAt: r.createdAt,
  fundedAt: r.fundedAt,
  dueBy: r.fundedAt ? new Date(r.fundedAt.getTime() + REFUND_WITHIN_MS) : null,
  doneAt: r.doneAt,
  sentBy: r.sentBy,
  sendNote: r.sendNote,
  events: r.events?.map((e) => ({ kind: e.kind, detail: e.detail, by: e.by, at: e.createdAt })),
});

const refundIncludes = { business: { select: { name: true } }, payment: { select: { id: true, ref: true, method: true, customerName: true, customerEmail: true, ngnPerUsd: true } } } as const;

/** "send": live refunds we have the money for - ours to pay out by hand, oldest first. */
router.get("/refunds", async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const mode = modeOf(req.query.mode);
  const view = String(req.query.view ?? "send");
  const byView: Record<string, Prisma.RefundWhereInput> = {
    send: { status: "SENDING", mode: "LIVE" },
    waiting: { status: "AWAITING_FUNDS" },
    done: { status: "REFUNDED" },
    all: {},
  };
  const where: Prisma.RefundWhereInput = {
    ...(mode ? { mode } : {}),
    ...(req.query.businessId ? { businessId: String(req.query.businessId) } : {}),
    ...(byView[view] ?? byView.send),
  };
  const [total, rows] = await Promise.all([
    prisma.refund.count({ where }),
    prisma.refund.findMany({ where, orderBy: { createdAt: view === "send" ? "asc" : "desc" }, skip, take: limit, include: refundIncludes }),
  ]);
  res.json({ refunds: rows.map(refundView), pagination: pagination(page, limit, total) });
});

router.get("/refunds/:id", async (req, res) => {
  const r = await prisma.refund.findUnique({ where: { id: String(req.params.id) }, include: { ...refundIncludes, events: { orderBy: { createdAt: "asc" } } } });
  if (!r) throw new HttpError(404, "No refund with that id.", "not_found");
  res.json({ refund: refundView(r) });
});

/** We've paid the customer back, by hand: done. The customer is emailed; the business sees it refunded. */
router.post("/refunds/:id/sent", async (req, res) => {
  const b = body(z.object({ note: z.string().trim().max(280).optional(), password: z.string().max(200).optional() }), req);
  const r = await prisma.refund.findUnique({ where: { id: String(req.params.id) } });
  if (!r) throw new HttpError(404, "No refund with that id.", "not_found");
  await needActionPassword(req, b.password, "refund_sent");
  await markRefundSent(r, req.admin!.email, b.note);
  await record(req, "refund_sent", r.businessId, { refundId: r.id, ref: r.ref });
  const full = await prisma.refund.findUniqueOrThrow({ where: { id: r.id }, include: { ...refundIncludes, events: { orderBy: { createdAt: "asc" } } } });
  res.json({ refund: refundView(full) });
});

// ─── Disputes ─────────────────────────────────────────────────────────────

const disputeIncludes = { business: { select: { id: true, name: true } }, payment: { select: { id: true, ref: true, method: true, currency: true, amountKobo: true, amountCents: true, receivedKobo: true, payerName: true, payerBank: true, payerAccount: true, customerName: true, customerEmail: true, paidAt: true } } } as const;
type DisputeRow = Prisma.DisputeGetPayload<{ include: typeof disputeIncludes & { messages: true } }> | Prisma.DisputeGetPayload<{ include: typeof disputeIncludes }>;

const disputeView = (d: DisputeRow, files?: Map<string, string>) => ({
  id: d.id,
  ref: d.ref,
  mode: d.mode,
  kind: d.kind,
  reason: d.reason,
  reasonWords: REASON_WORDS[d.reason],
  status: d.status,
  amountNgn: d.amountKobo / 100,
  replyBy: d.replyBy,
  overdue: isOpen(d) && d.status === "NEEDS_REPLY" && d.replyBy < new Date(),
  waitUntil: d.waitUntil,
  outcome: d.outcome,
  refundId: d.refundId,
  customer: { name: d.customerName, email: d.customerEmail },
  business: d.business,
  payment: { ...d.payment, amountNgn: d.payment.amountKobo / 100, amountUsd: d.payment.amountCents / 100, receivedNgn: d.payment.receivedKobo == null ? null : d.payment.receivedKobo / 100 },
  openedBy: d.openedBy,
  openedAt: d.createdAt,
  closedAt: d.closedAt,
  closedBy: d.closedBy,
  messages: "messages" in d && files ? d.messages.map((m) => ({ ...messageShape(m, files), by: m.by })) : undefined,
});

router.get("/disputes", async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const mode = modeOf(req.query.mode);
  const view = String(req.query.view ?? "open");
  const byView: Record<string, Prisma.DisputeWhereInput> = {
    open: { status: { in: ["NEEDS_REPLY", "UNDER_REVIEW"] } },
    bank: { kind: "BANK", status: { in: ["NEEDS_REPLY", "UNDER_REVIEW"] } },
    closed: { status: { in: ["WON", "REFUNDED", "LOST"] } },
    all: {},
  };
  const where: Prisma.DisputeWhereInput = {
    ...(mode ? { mode } : {}),
    ...(req.query.businessId ? { businessId: String(req.query.businessId) } : {}),
    ...(byView[view] ?? byView.open),
  };
  const [total, rows] = await Promise.all([
    prisma.dispute.count({ where }),
    prisma.dispute.findMany({ where, orderBy: { createdAt: view === "open" || view === "bank" ? "asc" : "desc" }, skip, take: limit, include: disputeIncludes }),
  ]);
  res.json({ disputes: rows.map((d) => disputeView(d)), pagination: pagination(page, limit, total) });
});

const oneDispute = async (id: string) => {
  const d = await prisma.dispute.findUnique({ where: { id }, include: { ...disputeIncludes, messages: { orderBy: { createdAt: "asc" } } } });
  if (!d) throw new HttpError(404, "No dispute with that id.", "not_found");
  return disputeView(d, await filesOf([d]));
};

router.get("/disputes/:id", async (req, res) => {
  res.json({ dispute: await oneDispute(String(req.params.id)) });
});

/** Writing in: as Money Moves, or passing on what the bank said. Can hand the turn back to the business. */
router.post("/disputes/:id/message", async (req, res) => {
  const b = body(z.object({ from: z.enum(["US", "BANK"]), body: z.string().trim().min(1, "Write the message.").max(4000), needsReply: z.boolean().optional() }), req);
  const d = await prisma.dispute.findUnique({ where: { id: String(req.params.id) } });
  if (!d) throw new HttpError(404, "No dispute with that id.", "not_found");
  await teamMessage(d, { from: b.from, body: b.body, needsReply: b.needsReply, by: req.admin!.email });
  await record(req, "dispute_message", d.businessId, { ref: d.ref, from: b.from, needsReply: !!b.needsReply });
  res.json({ dispute: await oneDispute(d.id) });
});

/** Closing it: what the bank decided, or a customer dispute decided by us. */
router.post("/disputes/:id/decision", async (req, res) => {
  const b = body(z.object({ status: z.enum(["WON", "LOST"]), outcome: z.string().trim().max(600).optional(), password: z.string().max(200).optional() }), req);
  const d = await prisma.dispute.findUnique({ where: { id: String(req.params.id) } });
  if (!d) throw new HttpError(404, "No dispute with that id.", "not_found");
  await needActionPassword(req, b.password, "dispute_decision");
  await teamDecide(d, { status: b.status, outcome: b.outcome, by: req.admin!.email });
  await record(req, "dispute_decided", d.businessId, { ref: d.ref, status: b.status });
  res.json({ dispute: await oneDispute(d.id) });
});

/** A bank claim on a naira transfer, from the rail's notice. */
router.post("/payments/:id/bank-claim", async (req, res) => {
  const b = body(
    z.object({
      reason: z.enum(["UNAUTHORISED", "UNRECOGNISED", "DUPLICATE", "NOT_RECEIVED"]),
      amountNgn: z.number().positive().optional(),
      note: z.string().trim().min(5, "Write what the bank said.").max(4000),
      password: z.string().max(200).optional(),
    }),
    req,
  );
  const p = await prisma.payment.findUnique({ where: { id: String(req.params.id) } });
  if (!p) throw new HttpError(404, "No payment with that id.", "not_found");
  await needActionPassword(req, b.password, "bank_claim");
  const d = await recordBankClaim(p, { reason: b.reason, amountKobo: b.amountNgn ? Math.round(b.amountNgn * 100) : undefined, note: b.note, by: req.admin!.email });
  await record(req, "bank_claim_recorded", p.businessId, { ref: d.ref, payment: p.ref });
  res.status(201).json({ dispute: await oneDispute(d.id) });
});

// ─── Asking a business for more ───────────────────────────────────────────

const REQUEST_KIND_WORDS = { TEXT: "a written answer", FILE: "a photo or document", BVN: "your BVN" } as const;

router.get("/businesses/:businessId/requests", async (req, res) => {
  const list = await prisma.infoRequest.findMany({ where: { businessId: String(req.params.businessId) }, orderBy: { createdAt: "desc" } });
  const docs = await prisma.document.findMany({ where: { id: { in: list.map((r) => r.documentId).filter((x): x is string => !!x) } }, select: { id: true, filename: true, mime: true, size: true } });
  res.json({
    requests: list.map((r) => ({ ...requestShape(r, docs.find((d) => d.id === r.documentId)), askedBy: r.askedBy, reviewedBy: r.reviewedBy })),
  });
});

/** Ask for something: a written answer, a photo or document, or a BVN. The business is emailed and sees it in Compliance. */
router.post("/businesses/:businessId/requests", async (req, res) => {
  const businessId = String(req.params.businessId);
  const b = body(
    z.object({
      kind: z.enum(["TEXT", "FILE", "BVN"]),
      title: z.string().trim().min(3, "Say what you need.").max(120),
      detail: z.string().trim().max(2000).optional(),
    }),
    req,
  );
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) throw new HttpError(404, "No business with that id.", "not_found");
  const r = await prisma.infoRequest.create({ data: { businessId, kind: b.kind, title: b.title, detail: b.detail || null, askedBy: req.admin!.email } });
  await record(req, "request_sent", businessId, { requestId: r.id, kind: b.kind, title: b.title });
  const to = await ownersOf(businessId);
  for (const email of to) {
    void sendEmail(
      email,
      `Our review team needs something from ${business.name}`,
      `Our review team has asked for ${REQUEST_KIND_WORDS[b.kind]}: ${b.title}.${b.detail ? `\n\n${b.detail}` : ""}\n\nOpen Compliance in your Money Moves Business dashboard to answer. It doesn't pause your account.\n\n- Money Moves Business`,
    ).catch(() => {});
  }
  res.status(201).json({ request: { ...requestShape(r), askedBy: r.askedBy, reviewedBy: null } });
});

/** Accept an answer, or turn it down with a reason - the business sees the reason and answers again. */
router.post("/requests/:id/decision", async (req, res) => {
  const b = body(z.object({ decision: z.enum(["accept", "reject"]), note: z.string().trim().max(1000).optional() }), req);
  const r = await prisma.infoRequest.findUnique({ where: { id: String(req.params.id) } });
  if (!r) throw new HttpError(404, "No request with that id.", "not_found");
  if (r.status !== "ANSWERED") throw new HttpError(409, "Only an answered request can be decided.", "not_answered");
  if (b.decision === "reject" && !b.note) throw new HttpError(400, "Say what's wrong, so they can put it right.", "note_required");
  const saved = await prisma.infoRequest.update({
    where: { id: r.id },
    data: { status: b.decision === "accept" ? "ACCEPTED" : "REJECTED", reviewedBy: req.admin!.email, reviewedAt: new Date(), reviewNote: b.decision === "reject" ? b.note! : null },
  });
  await record(req, b.decision === "accept" ? "request_accepted" : "request_rejected", r.businessId, { requestId: r.id, note: b.note ?? null });
  if (b.decision === "reject") {
    const business = await prisma.business.findUniqueOrThrow({ where: { id: r.businessId } });
    for (const email of await ownersOf(r.businessId)) {
      void sendEmail(email, `Please look again: ${r.title}`, `Our review team couldn't accept what was sent for "${r.title}" for ${business.name}:\n\n${b.note}\n\nOpen Compliance in your dashboard to send it again.\n\n- Money Moves Business`).catch(() => {});
    }
  }
  res.json({ request: { ...requestShape(saved), askedBy: saved.askedBy, reviewedBy: saved.reviewedBy } });
});

router.post("/requests/:id/cancel", async (req, res) => {
  const r = await prisma.infoRequest.findUnique({ where: { id: String(req.params.id) } });
  if (!r) throw new HttpError(404, "No request with that id.", "not_found");
  if (r.status === "ACCEPTED" || r.status === "CANCELLED") throw new HttpError(409, "There's nothing to withdraw.", "not_open");
  const saved = await prisma.infoRequest.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
  await record(req, "request_cancelled", r.businessId, { requestId: r.id });
  res.json({ request: { ...requestShape(saved), askedBy: saved.askedBy, reviewedBy: saved.reviewedBy } });
});

/** The full BVN, opened from its seal - every look is written to the business's activity. */
router.get("/requests/:id/bvn", async (req, res) => {
  const r = await prisma.infoRequest.findUnique({ where: { id: String(req.params.id) } });
  if (!r || r.kind !== "BVN" || !r.answerSealed) throw new HttpError(404, "No BVN here.", "not_found");
  let bvn: string;
  try {
    bvn = openDocument(Buffer.from(r.answerSealed)).toString();
  } catch (e) {
    if (e instanceof LockedDocument) throw new HttpError(503, "The documents key doesn't open this. Check DOCS_KEY.", "locked");
    throw e;
  }
  await record(req, "bvn_viewed", r.businessId, { requestId: r.id });
  res.json({ bvn });
});

// ─── Services: the platform's switches ────────────────────────────────────

/**
 * What is actually live, so the Services page marks only what isn't: each way
 * to pay, each network (and what it still needs), each place money settles,
 * and each chain the float can pay out on. Null is live; a sentence is why not.
 */
function whatsLive() {
  const networks = Object.fromEntries(NETWORKS.map((n) => [n, notLiveWhy(n)])) as Record<string, string | null>;
  const coin = (c: keyof typeof COIN_NETWORKS) => (COIN_NETWORKS[c].some((n) => liveReady(n)) ? null : "No network for it is live yet.");
  const floatOn = (c: FloatChain) => (floatAddress(c) ? null : `Needs FLOAT_${c === "ARC" || c === "MONAD" ? "EVM" : c === "STELLAR" ? "SOLANA" : c}_PRIVATE_KEY set.`);
  // Stellar pays out from the float's account there, which has to be open and trust USDC.
  const stellar = stellarState();
  const stellarPayouts = floatOn("STELLAR") ?? (stellar.address && stellar.address !== floatAddress("STELLAR") ? null : stellar.why ?? (stellar.trust.USDC ? null : "The Stellar float has no USDC trustline yet."));
  return {
    methods: { naira: null, app: appPayReady() ? null : "Needs BUSINESS_LINK_SECRET set.", crypto: Object.values(networks).some((w) => w === null) ? null : "No network is live yet." },
    destinations: { bank: null, moneyMoves: appLinksReady() ? null : "Needs BUSINESS_LINK_SECRET set.", wallet: null },
    coins: { USDC: coin("USDC"), USDT: coin("USDT") },
    networks,
    settleChains: { MOVEMENT: floatOn("MOVEMENT"), ARC: floatOn("ARC"), MONAD: floatOn("MONAD"), SOLANA: floatOn("SOLANA"), STELLAR: stellarPayouts },
  };
}

router.get("/platform", async (_req, res) => {
  res.json({ ...(await platformWithMeta()), defaults: PLATFORM_DEFAULTS, networks: NETWORKS, live: whatsLive() });
});

/** Every change here reaches every business within seconds, so every save takes the password. */
router.put("/platform", async (req, res) => {
  const b = body(z.object({ platform: platformSchema, password: z.string().max(200).optional() }), req);
  await needActionPassword(req, b.password, "platform");
  const before = await platform();
  const changed = await savePlatform(b.platform, req.admin!.email);
  if (changed.length) await record(req, "platform_changed", null, { changed });
  // A chain switched off: every business on it moves to Movement, now - nothing new settles on a chain that's off.
  // Movement itself stays: with it off, its settlements wait in the queue until it's back on or the team sends them.
  const off = (Object.keys(b.platform.settleChains) as SettleChain[]).filter((c) => c !== DEFAULT_CHAIN && before.settleChains[c] && !b.platform.settleChains[c]);
  if (off.length) {
    const moving = await prisma.business.findMany({ where: { settleChain: { in: off } }, select: { id: true, settleChain: true } });
    if (moving.length) await prisma.business.updateMany({ where: { id: { in: moving.map((m) => m.id) } }, data: { settleChain: DEFAULT_CHAIN } });
    // Logged as the business's own chain change, so it reads the same wherever its history is shown.
    for (const m of moving) await audit(req, "settlement_chain_changed", { businessId: m.id, detail: { settleChain: DEFAULT_CHAIN, from: m.settleChain, reason: "chain_switched_off", admin: req.admin!.email } });
  }
  res.json({ ...(await platformWithMeta()), defaults: PLATFORM_DEFAULTS, networks: NETWORKS, live: whatsLive(), changed });
});

// ─── Crypto that came in: what goes back, what matched nothing, what's still to sweep ─

const arrivalView = (x: CryptoArrival & { payment?: (Payment & { business: { name: string } }) | null }) => ({
  id: x.id,
  network: x.network,
  coin: x.coin,
  amount: Number(x.micros) / 1e6,
  used: Number(x.usedMicros) / 1e6,
  from: x.fromAddress,
  to: x.toAddress,
  memo: x.memo,
  tx: x.txHash,
  kind: x.kind,
  swept: !!x.sweptAt,
  sweepTx: x.sweepTx,
  back: x.returnMicros != null ? Number(x.returnMicros) / 1e6 : null,
  status: x.returnStatus,
  why: x.returnWhy,
  whyWords: x.returnWhy ? whyWords(x.returnWhy) : null,
  returnTo: x.returnTo,
  returnMemo: x.returnMemo,
  returnTx: x.returnTx,
  returnError: x.returnError,
  returnBy: x.returnBy,
  /** Whether it can go back by itself once it has an address: from the payment's own address, or the float. */
  canSend: !!sendsFrom(x, x.payment ?? null),
  payment: x.payment ? { id: x.payment.id, ref: x.payment.ref, status: x.payment.status, business: x.payment.business.name, businessId: x.payment.businessId, email: x.payment.customerEmail } : null,
  at: x.createdAt,
});

/** "attention": anything a person has to decide - matched nothing, waiting for an address, failed, ours to send by hand. */
router.get("/crypto", async (req, res) => {
  const view = String(req.query.view ?? "attention");
  const where: Prisma.CryptoArrivalWhereInput =
    view === "attention" ? { returnStatus: { in: ["MANUAL", "FAILED", "ASK", "CONFIRMING"] } } : view === "returns" ? { returnMicros: { not: null } } : {};
  const list = await prisma.cryptoArrival.findMany({ where, include: { payment: { include: { business: { select: { name: true } } } } }, orderBy: { createdAt: "desc" }, take: 200 });
  res.json({ arrivals: list.map(arrivalView) });
});

/** The sweeps' side: the gas sponsor on each chain, what's waiting to be swept, and whether payments get addresses of their own. */
router.get("/crypto/state", async (_req, res) => {
  // The float on each settle chain: where to top it up, and what it holds now, read live.
  const floats = await Promise.all(
    (["MOVEMENT", "SOLANA", "ARC", "MONAD", "STELLAR"] as FloatChain[]).map(async (chain) => {
      const b = await floatBalances(chain).catch(() => null);
      return { chain, address: floatAddress(chain), usdc: b ? Number(b.usdcMicros) / 1e6 : null, feeCoin: b?.feeCoin ?? null, fee: b?.fee ?? null };
    }),
  );
  res.json({
    ...(await sweepState()),
    ownAddresses: depositKeysReady(),
    stellar: stellarState(),
    floats,
    receive: { stellar: stellarReceiveAddress(), ton: tonReceiveAddress() },
    networks: Object.fromEntries(NETWORKS.map((n) => [n, notLiveWhy(n)])),
  });
});

const arrivalOr404 = async (id: string) => {
  const x = await prisma.cryptoArrival.findUnique({ where: { id }, include: { payment: { include: { business: { select: { name: true } } } } } });
  if (!x) throw new HttpError(404, "Nothing here with that id.", "not_found");
  return x;
};

/** Send it back to an address: by itself where we can, else it's marked ours to send with that address. */
router.post("/crypto/:id/send", async (req, res) => {
  const b = body(z.object({ address: z.string().trim().min(20).max(120), memo: z.string().trim().max(28).optional(), password: z.string().max(200).optional() }), req);
  await needActionPassword(req, b.password, "crypto_return");
  const x = await arrivalOr404(String(req.params.id));
  if (x.returnMicros == null) throw new HttpError(409, "Nothing on this one goes back.", "nothing_back");
  if (!["ASK", "MANUAL", "FAILED"].includes(x.returnStatus ?? "")) throw new HttpError(409, "This one is already on its way or done.", "not_open");
  if (!validReturnAddress(x.network, b.address)) throw new HttpError(400, "That isn't an address on " + x.network + ".", "bad_address");
  const next = sendsFrom(x, x.payment) ? "QUEUED" : "MANUAL";
  await prisma.cryptoArrival.update({ where: { id: x.id }, data: { returnStatus: next, returnTo: b.address, returnMemo: b.memo || null, returnBy: req.admin!.email, returnError: null } });
  await record(req, "crypto_return_sent", x.payment?.businessId ?? null, { arrivalId: x.id, to: b.address, network: x.network });
  res.json({ arrival: arrivalView(await arrivalOr404(x.id)) });
});

/** Sent by hand: done, with its transaction. */
router.post("/crypto/:id/returned", async (req, res) => {
  const b = body(z.object({ tx: z.string().trim().min(1, "Paste the transaction.").max(200), password: z.string().max(200).optional() }), req);
  await needActionPassword(req, b.password, "crypto_return");
  const x = await arrivalOr404(String(req.params.id));
  const done = await prisma.cryptoArrival.updateMany({ where: { id: x.id, returnStatus: { in: ["ASK", "MANUAL", "FAILED", "CONFIRMING"] } }, data: { returnStatus: "RETURNED", returnTx: b.tx, returnSentAt: new Date(), returnBy: req.admin!.email, returnError: null } });
  if (!done.count) throw new HttpError(409, "This one isn't waiting to be sent.", "not_open");
  await record(req, "crypto_returned_by_hand", x.payment?.businessId ?? null, { arrivalId: x.id, tx: b.tx });
  res.json({ arrival: arrivalView(await arrivalOr404(x.id)) });
});

/** Kept: nothing goes back (dust, or sorted out another way). */
router.post("/crypto/:id/keep", async (req, res) => {
  const b = body(z.object({ note: z.string().trim().min(1, "Say why.").max(300), password: z.string().max(200).optional() }), req);
  await needActionPassword(req, b.password, "crypto_return");
  const x = await arrivalOr404(String(req.params.id));
  const done = await prisma.cryptoArrival.updateMany({ where: { id: x.id, returnStatus: { in: ["ASK", "MANUAL", "FAILED"] } }, data: { returnStatus: "KEPT", returnError: b.note, returnBy: req.admin!.email } });
  if (!done.count) throw new HttpError(409, "This one isn't waiting to be decided.", "not_open");
  await record(req, "crypto_return_kept", x.payment?.businessId ?? null, { arrivalId: x.id, note: b.note });
  res.json({ arrival: arrivalView(await arrivalOr404(x.id)) });
});

/** A transfer that matched nothing, put towards the payment it was for - same network and coin. */
router.post("/crypto/:id/match", async (req, res) => {
  const b = body(z.object({ ref: z.string().trim().toUpperCase().min(4).max(40), password: z.string().max(200).optional() }), req);
  await needActionPassword(req, b.password, "crypto_match");
  const x = await arrivalOr404(String(req.params.id));
  if (x.kind !== "UNMATCHED" || x.returnStatus !== "MANUAL") throw new HttpError(409, "Only a transfer that matched nothing, and hasn't been sent back, can be matched.", "not_unmatched");
  const p = await prisma.payment.findUnique({ where: { ref: b.ref } });
  if (!p || p.method !== "CRYPTO" || p.mode !== "LIVE") throw new HttpError(404, "No live crypto payment with that reference.", "not_found");
  if (p.network !== x.network || p.coin !== x.coin) throw new HttpError(400, "That payment was for " + p.coin + " on " + p.network + ", this is " + x.coin + " on " + x.network + ".", "wrong_coin");
  await prisma.cryptoArrival.update({ where: { id: x.id }, data: { paymentId: p.id, kind: "PAYMENT", returnMicros: null, returnStatus: null, returnWhy: null, returnBy: req.admin!.email } });
  await record(req, "crypto_matched", p.businessId, { arrivalId: x.id, ref: p.ref });
  // Weighed like any arrival: it may pay the payment, open it again if it lapsed, or go back.
  await weigh(p.id);
  res.json({ arrival: arrivalView(await arrivalOr404(x.id)) });
});

export default router;
