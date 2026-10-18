import { prisma } from "./prisma";
import { assetLabel } from "./asset";
import { getLiveNgnRate } from "./ngn-rate";

/**
 * The numbers behind an account statement.
 *
 * A statement is not the transaction list with a border on it. The list shows
 * what happened; a statement has to stand on its own months later, in front of
 * somebody who was not there - which means every figure needs a provenance,
 * and the ones we cannot vouch for have to say so.
 *
 * That is the whole difficulty here. Naira-denominated events - a sell, a
 * funding, a bill - recorded what they were actually worth at the time, so
 * those figures are exact for ever. A crypto movement recorded only the token
 * amount. Nothing in this system ever wrote down the rate on the day, so the
 * only naira figure available for a transfer made three weeks ago is today's,
 * and today's is not what it was worth.
 *
 * Rather than quietly mixing the two, every row carries `estimated`, and the
 * document marks those rows and says what the mark means.
 */

export type StatementType =
  | "DEPOSIT"
  | "WITHDRAW"
  | "BUY"
  | "SELL"
  | "TRANSFER"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "AIRTIME"
  | "TV"
  | "SWEEP"
  | "LOCK"
  | "UNLOCK";

export type StatementRow = {
  at: Date;
  /** "Converted deposit", "Sent to @beryl" - what happened, in a few words. */
  what: string;
  /** The chain, the counterparty, the bank - where it happened. */
  where: string;
  reference: string;
  /** Signed, in the token that moved: "+0.595687 USDC", "−₦500.00". */
  amount: string;
  ngn: number | null;
  usd: number | null;
  /** True when the NAIRA came from today's rate rather than the day's. */
  estimated: boolean;
  direction: "in" | "out" | "none";
  pending: boolean;
};

export type StatementCategory = {
  label: string;
  count: number;
  ngn: number;
  usd: number;
  direction: "in" | "out";
};

export type Statement = {
  user: { name: string; username: string | null; email: string };
  from: Date;
  to: Date;
  issuedAt: Date;
  number: string;
  types: StatementType[] | null;
  rows: StatementRow[];
  totals: { inNgn: number; outNgn: number; inUsd: number; outUsd: number };
  categories: StatementCategory[];
  /** True when any row's naira came from today's rate; the document footnotes it. */
  anyEstimated: boolean;
};

const MONEY_IN: StatementType[] = ["DEPOSIT", "BUY", "TRANSFER_IN"];
const MONEY_OUT: StatementType[] = [
  "SELL",
  "TRANSFER",
  "TRANSFER_OUT",
  "WITHDRAW",
  "AIRTIME",
  "TV",
];

/**
 * The categories, named as the rest of the app names them.
 *
 * A receipt for a BUY is badged "Fund" and a SELL "Bank transfer"; calling them
 * Buy and Sell on the statement would give one transaction two names depending
 * on where somebody read it.
 */
const CATEGORIES: { label: string; types: StatementType[]; direction: "in" | "out" }[] = [
  { label: "Received", types: ["DEPOSIT", "TRANSFER_IN"], direction: "in" },
  { label: "Funded", types: ["BUY"], direction: "in" },
  { label: "Crypto sent", types: ["TRANSFER", "TRANSFER_OUT"], direction: "out" },
  { label: "Bank transfer", types: ["SELL"], direction: "out" },
  { label: "Withdrawals", types: ["WITHDRAW"], direction: "out" },
  { label: "Bills", types: ["AIRTIME", "TV"], direction: "out" },
];

const CHAIN_NAME: Record<string, string> = {
  MOVE: "Movement",
  BASE: "Base",
  BEP20: "BNB Smart Chain",
  ARC: "Arc",
  SOL: "Solana",
  ARB: "Arbitrum",
  TON: "TON",
  STELLAR: "Stellar",
  MONAD: "Monad",
};

/** Their chain ids, for the source leg of a converted deposit. */
const ROUTED_CHAIN: Record<number, string> = {
  1: "Ethereum",
  56: "BNB Smart Chain",
  137: "Polygon",
  4663: "Robinhood Chain",
  10001: "Bitcoin",
  10103: "Solana",
  42161: "Arbitrum",
  728126428: "Tron",
};

/** Dollar-pegged, so the token amount is the dollar amount. No rate needed. */
const IS_DOLLAR = new Set(["USDC", "USDT", "USDCx", "USDCe"]);

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/**
 * The naira this transaction was actually worth, if anyone wrote it down.
 *
 * Only naira-denominated events did. Everything else returns null and gets
 * valued at today's rate by the caller, marked.
 */
function recordedNgn(type: string, meta: any): number | null {
  switch (type) {
    case "SELL":
      return n(meta?.ngnNet) ?? n(meta?.ngnGross);
    case "BUY":
      return n(meta?.amountNaira);
    case "AIRTIME":
    case "TV":
      return n(meta?.totalNaira) ?? n(meta?.nairaAmount) ?? n(meta?.amountNaira);
    default:
      return null;
  }
}

function describe(tx: any): { what: string; where: string } {
  const meta = tx.metadata ?? {};
  const label = assetLabel(tx.asset);
  const chain = CHAIN_NAME[tx.chain] ?? tx.chain ?? "";

  if (meta.source === "routed_deposit") {
    const from = ROUTED_CHAIN[Number(meta.chainId)] ?? "another chain";
    return {
      what: "Converted deposit",
      where: `${meta.sentSymbol ?? "Crypto"} on ${from} → ${label} on Movement`,
    };
  }

  switch (tx.type) {
    case "DEPOSIT":
      return {
        what: "Deposit",
        where: meta.source === "external_deposit"
          ? `${label} on ${chain} · external wallet`
          : `${label} on ${chain}`,
      };
    case "BUY":
      return { what: "Funded wallet", where: `${label} on ${chain}` };
    case "SELL":
      return {
        what: "Bank transfer",
        where: [meta.bankName, meta.accountName, meta.accountNumber ? `***${String(meta.accountNumber).slice(-4)}` : null]
          .filter(Boolean)
          .join(" · ") || "Paid to bank",
      };
    case "WITHDRAW":
      return { what: `Withdrew ${label}`, where: `${chain} · ${short(meta.address)}` };
    case "TRANSFER_OUT":
    case "TRANSFER":
      return {
        what: meta.recipientUsername ? `Sent to @${meta.recipientUsername}` : `Sent ${label}`,
        where: `${label} on ${chain}`,
      };
    case "TRANSFER_IN":
      return {
        what: meta.senderUsername ? `From @${meta.senderUsername}` : `Received ${label}`,
        where: `${label} on ${chain}`,
      };
    case "AIRTIME":
    case "TV":
      return {
        what: meta.billType === "electricity" ? "Electricity"
          : meta.billType === "data" ? "Data"
          : meta.billType === "tv" || meta.billType === "cable" ? "TV"
          : meta.billType === "betting" ? "Betting"
          : "Airtime",
        where: [meta.disco || meta.network, meta.phone].filter(Boolean).join(" · ") || "Bill",
      };
    case "SWEEP":
      // "Swap" is what the feature is called everywhere a user meets it.
      return { what: "Swap", where: `Into ${label} on Movement` };
    case "LOCK":
      return { what: `Locked ${label}`, where: "Savings" };
    case "UNLOCK":
      return { what: `Unlocked ${label}`, where: "Savings" };
    default:
      return { what: tx.type, where: chain };
  }
}

const short = (a: unknown): string => {
  const s = String(a ?? "");
  return s.length > 12 ? `${s.slice(0, 5)}…${s.slice(-4)}` : s;
};

const fmt = (v: number, dp = 2) =>
  v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

/**
 * Every rate the rows need, fetched once.
 *
 * A statement can hold hundreds of rows across half a dozen assets; asking per
 * row would be hundreds of calls to price one month.
 */
async function rateTable(assets: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(
    [...new Set(assets)].map(async (a) => {
      // USDCx and USDCe are USDC on Movement; the feed only knows USDC.
      const key = a === "USDCx" || a === "USDCe" ? "USDC" : a;
      out[a] = await getLiveNgnRate(key).catch(() => 0);
    }),
  );
  return out;
}

export async function buildStatement(
  userId: string,
  from: Date,
  to: Date,
  types: StatementType[] | null,
): Promise<Statement> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, username: true, email: true },
  });
  if (!user) throw new Error("No such user.");

  const txs = await prisma.transaction.findMany({
    where: {
      userId,
      createdAt: { gte: from, lte: to },
      // A prepared sale nobody signed is not an event. Failed ones are - the
      // money moved and came back, and leaving them out makes a statement that
      // disagrees with the app's own list.
      status: { in: ["COMPLETED", "PROCESSING", "PENDING", "FAILED"] },
      ...(types && types.length ? { type: { in: types as any } } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      type: true, asset: true, chain: true, amount: true, status: true,
      reference: true, metadata: true, createdAt: true,
    },
  });

  const rates = await rateTable(txs.map((t) => t.asset));
  const usdcNgn = rates["USDC"] || (await getLiveNgnRate("USDC").catch(() => 0));

  const rows: StatementRow[] = txs.map((tx) => {
    const meta: any = tx.metadata ?? {};
    const amount = Number(tx.amount);
    const label = assetLabel(tx.asset);
    const { what, where } = describe(tx);
    const pending = tx.status === "PROCESSING" || tx.status === "PENDING";

    const direction: "in" | "out" | "none" =
      MONEY_IN.includes(tx.type as StatementType) ? "in"
      : MONEY_OUT.includes(tx.type as StatementType) ? "out"
      : "none";

    const exact = recordedNgn(tx.type, meta);
    const rate = rates[tx.asset] ?? 0;

    let ngn: number | null = exact;
    let usd: number | null = null;
    let estimated = false;

    if (exact !== null) {
      /**
       * The naira is what it really was, so it carries no mark.
       *
       * The dollar it represented on the day is not recorded anywhere, so that
       * half is today's - but the dollar column is derived for every row in
       * the document, which the note says once rather than marking all of
       * them. Marking the naira here would put an asterisk beside the one
       * figure on the page we can actually vouch for.
       */
      usd = usdcNgn > 0 ? exact / usdcNgn : null;
    } else {
      ngn = rate > 0 ? amount * rate : null;
      usd = IS_DOLLAR.has(tx.asset)
        ? amount
        : usdcNgn > 0 && ngn !== null ? ngn / usdcNgn : null;
      // No rate was kept for the day this happened, so this naira is today's.
      estimated = ngn !== null;
    }

    if (pending) { ngn = null; usd = null; estimated = false; }

    /**
     * What moved, in the token that moved - always.
     *
     * A sell and a bill were printing their naira here, which is the figure
     * already in the naira column: the row read "−₦500.00 ... 500.00" and
     * said one thing twice while never saying what left the wallet. The token
     * amount here and the naira beside it are two different facts.
     *
     * A converted deposit that has not landed shows what was SENT, since the
     * USDC figure does not exist yet.
     */
    const sign = direction === "out" ? "−" : direction === "in" ? "+" : "";
    const amountText =
      meta.source === "routed_deposit" && pending && meta.sentAmount
        ? `${meta.sentAmount} ${meta.sentSymbol ?? ""}`.trim()
        : `${sign}${fmt(amount, amount < 1 ? 6 : 2)} ${label}`;

    return {
      at: tx.createdAt,
      what, where,
      reference: tx.reference ?? "",
      amount: amountText,
      ngn, usd, estimated, direction,
      pending,
    };
  });

  const totals = rows.reduce(
    (t, r) => {
      if (r.direction === "in") { t.inNgn += r.ngn ?? 0; t.inUsd += r.usd ?? 0; }
      if (r.direction === "out") { t.outNgn += r.ngn ?? 0; t.outUsd += r.usd ?? 0; }
      return t;
    },
    { inNgn: 0, outNgn: 0, inUsd: 0, outUsd: 0 },
  );

  const byType = new Map<string, StatementRow[]>();
  txs.forEach((tx, i) => {
    const list = byType.get(tx.type) ?? [];
    list.push(rows[i]);
    byType.set(tx.type, list);
  });

  const categories: StatementCategory[] = CATEGORIES.map((c) => {
    const rs = c.types.flatMap((t) => byType.get(t) ?? []);
    return {
      label: c.label,
      count: rs.length,
      ngn: rs.reduce((s, r) => s + (r.ngn ?? 0), 0),
      usd: rs.reduce((s, r) => s + (r.usd ?? 0), 0),
      direction: c.direction,
    };
  })
    .filter((c) => c.count > 0)
    .sort((a, b) => b.ngn - a.ngn);

  return {
    user: {
      name:
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        user.username ||
        user.email,
      username: user.username,
      email: user.email,
    },
    from, to,
    issuedAt: new Date(),
    // Readable, sortable, and unique enough to quote at support: the month,
    // then a short hash of the account and the window.
    number: statementNumber(userId, from, to),
    types,
    rows,
    totals,
    categories,
    anyEstimated: rows.some((r) => r.estimated),
  };
}

function statementNumber(userId: string, from: Date, to: Date): string {
  const ym = `${String(from.getFullYear()).slice(2)}${String(from.getMonth() + 1).padStart(2, "0")}`;
  let h = 0;
  for (const ch of `${userId}:${from.toISOString()}:${to.toISOString()}`) {
    h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return `MM-${ym}-${String(h % 10000).padStart(4, "0")}`;
}
