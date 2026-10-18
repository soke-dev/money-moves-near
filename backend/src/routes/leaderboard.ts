import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, requireActiveSession } from "../middleware/auth";
import { fetchRates } from "./rates";
import { publicName } from "../lib/anon";
import { referralCounts } from "../lib/referrals";

const router = Router();

/**
 * Avatars for a handful of users, fetched after the ranking is decided.
 *
 * Avatars live in the database as base64 data URIs, so a 2MB photo is roughly
 * 2.7MB of text in a Text column. Selecting that column while ranking meant
 * loading every user's image into memory to decide who placed in the top
 * seven, and shipping one per row. Ranking first and fetching the few that
 * are actually returned keeps the feature and drops the payload from N
 * images to at most a handful.
 */
async function avatarsFor(ids: string[]): Promise<Record<string, string | null>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return {};

  const rows = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, avatarUrl: true, avatarData: true },
  });

  const map: Record<string, string | null> = {};
  for (const u of rows) map[u.id] = u.avatarData ?? u.avatarUrl ?? null;
  return map;
}

// Fallback stablecoin rate if the CoinGecko cache is cold

// ═══════════════════════════════════════════════════════════
// GET /leaderboard/points — top 7 by loyalty points + user rank
// ═══════════════════════════════════════════════════════════
router.get("/points", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    // Get all users with completed BUY/SELL/AIRTIME/TV transactions
    // Names only. Every user in the table is scanned to rank them, so the
    // image column must not come along for the ride.
    const allUsers = await prisma.user.findMany({
      select: { id: true, username: true, firstName: true, anonMode: true },
    });

    // Get volume per user from qualifying transactions
    const txns = await prisma.transaction.findMany({
      where: {
        type: { in: ["BUY", "SELL", "AIRTIME", "TV", "LOCK"] },
        status: "COMPLETED",
      },
      select: { userId: true, type: true, asset: true, amount: true, metadata: true },
    });

    // Live rates for LOCK conversion (CoinGecko, 2-min cached)
    const rates = await fetchRates();
    /**
     * A lock is worth what the asset locked is worth.
     *
     * This read `tx.asset === "USDT" ? usdtNgn : usdcNgn`, so everything that
     * was not USDT was valued at the dollar - a MOVE lock counted at about a
     * hundred times its worth, and a cNGN lock would count at over a thousand.
     * Only the two dollar tokens were ever right.
     *
     * No fallback rate either. An asset nobody can price contributes nothing
     * to the total rather than being counted as if it were a dollar, which is
     * the same rule the sell quote follows.
     */
    const lockNgn = (asset: string): number => {
      const key = asset === "USDCx" ? "USDC" : asset;
      return Number((rates as any)?.[key]?.ngn) || 0;
    };

    // Aggregate volume per user — each tx type stores its naira value under a different key
    const volumeMap: Record<string, number> = {};
    for (const tx of txns) {
      const meta = tx.metadata as any;
      let amt = 0;
      if (tx.type === "LOCK") {
        amt = Number(tx.amount) * lockNgn(tx.asset);
      } else if (tx.type === "BUY") {
        amt = meta?.amountNaira ? Number(meta.amountNaira) : 0;
      } else if (tx.type === "SELL") {
        amt = meta?.ngnGross ? Number(meta.ngnGross) : 0;
      } else {
        // AIRTIME, TV
        amt = meta?.nairaAmount ? Number(meta.nairaAmount) : 0;
      }
      if (amt > 0) {
        volumeMap[tx.userId] = (volumeMap[tx.userId] || 0) + amt;
      }
    }

    // Build entries with points
    const entries = allUsers
      .map((u) => {
        const vol = volumeMap[u.id] || 0;
        const pub = publicName(u);
        return {
          userId: u.id,
          name: pub.name,
          anon: pub.anon,
          /**
           * Their own handle, for their own row.
           *
           * The toggle hides the name from other people, not from the person
           * who set it - somebody who could not find themselves on the board
           * would reasonably conclude it had stopped counting them.
           */
          selfName: u.username || u.firstName || "You",
          points: Math.floor(vol / 100),
          volume: vol,
        };
      })
      .filter((e) => e.points > 0)
      .sort((a, b) => b.points - a.points);

    // Top twenty: seven filled barely more than the podium and the four
    // rows under it, so the board ended before anyone could find themselves.
    const ranked = entries.slice(0, 20);

    // Current user rank
    const myIdx = entries.findIndex((e) => e.userId === userId);
    const myEntry = myIdx >= 0 ? entries[myIdx] : null;
    const myRank = myIdx >= 0 ? myIdx + 1 : null;

    // Only the rows actually leaving this handler.
    const avatars = await avatarsFor([...ranked.map((e) => e.userId), ...(myEntry ? [myEntry.userId] : [])]);

    const top7 = ranked.map((e, i) => ({
      rank: i + 1,
      name: e.name,
      // The app blurs the name and offers the reason. It cannot infer that
      // from the string, because "Anon" is also a name somebody could have.
      anon: e.anon,
      avatar: avatars[e.userId] ?? null,
      points: e.points,
      volume: e.volume,
    }));

    // The person directly above, so the app can show a climb rather than a
    // number. Sent from here because a user outside the top 20 cannot work it
    // out from `top` - and they are the ones who most need something to aim at.
    const above = myIdx > 0 ? entries[myIdx - 1] : null;

    res.json({
      top: top7,
      me: {
        rank: myRank,
        name: myEntry?.selfName || "You",
        avatar: myEntry ? avatars[myEntry.userId] ?? null : null,
        points: myEntry?.points || 0,
        volume: myEntry?.volume || 0,
      },
      next: above
        ? {
            rank: myIdx, // their position is one above mine, and myIdx is 0-based
            name: above.name,
            anon: above.anon,
            points: above.points,
          }
        : null,
    });
  } catch (err) {
    console.error("Leaderboard points error:", err);
    res.status(500).json({ error: "Failed to load leaderboard" });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /leaderboard/referrals — top 7 by referral count + user rank
// ═══════════════════════════════════════════════════════════
router.get("/referrals", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    /**
     * Counted friends only - PIN set, account not deleted.
     *
     * This counted every row with a referredBy, so a sign-up abandoned at the
     * email screen moved somebody up the board exactly as far as a friend who
     * uses the app. The rule lives in lib/referrals so this board and the
     * dashboard cannot disagree about the same person.
     */
    const counts = await referralCounts();
    const referrerIds = counts.map((c) => c.userId);

    const referrers = await prisma.user.findMany({
      where: { id: { in: referrerIds } },
      select: { id: true, username: true, firstName: true, anonMode: true },
    });

    const nameMap: Record<string, { name: string; anon: boolean; selfName: string }> = {};
    for (const u of referrers) {
      const pub = publicName(u);
      nameMap[u.id] = {
        ...pub,
        selfName: u.username || u.firstName || "You",
      };
    }
    const entries = counts.map((c) => {
      const n = nameMap[c.userId];
      return {
        userId: c.userId,
        name: n?.name || "Anonymous",
        anon: n?.anon ?? false,
        selfName: n?.selfName || "You",
        count: c.count,
      };
    });

    // Top twenty: seven filled barely more than the podium and the four
    // rows under it, so the board ended before anyone could find themselves.
    const ranked = entries.slice(0, 20);

    // Current user rank
    const myIdx = entries.findIndex((e) => e.userId === userId);
    const myEntry = myIdx >= 0 ? entries[myIdx] : null;
    const myRank = myIdx >= 0 ? myIdx + 1 : null;

    // Only the rows actually leaving this handler.
    const avatarMap = await avatarsFor([
      ...ranked.map((e) => e.userId),
      ...(myEntry ? [myEntry.userId] : []),
    ]);

    const top7 = ranked.map((e, i) => ({
      rank: i + 1,
      name: e.name,
      anon: e.anon,
      avatar: avatarMap[e.userId] ?? null,
      count: e.count,
    }));

    res.json({
      top: top7,
      me: {
        rank: myRank,
        name: myEntry?.selfName || "You",
        avatar: myEntry ? avatarMap[myEntry.userId] ?? null : null,
        count: myEntry?.count || 0,
      },
    });
  } catch (err) {
    console.error("Leaderboard referrals error:", err);
    res.status(500).json({ error: "Failed to load leaderboard" });
  }
});

// ═══════════════════════════════════════════════════════════
// Trading Events — monthly leaderboards over BUY (fund) + SELL
// ═══════════════════════════════════════════════════════════
const EVENTS_PAGE_SIZE = 7;

// ₦110K Trading Competition window — Sun 24 May 2026 00:00 → Sun 7 Jun 2026 00:00 Lagos time
// (Lagos is UTC+1, no DST, so subtract 1h to express in UTC; end is exclusive)
const COMPETITION_START = new Date(Date.UTC(2026, 4, 23, 23, 0, 0, 0));
const COMPETITION_END = new Date(Date.UTC(2026, 5, 6, 23, 0, 0, 0));

function txNaira(tx: { type: string; metadata: any }): number {
  const meta = tx.metadata as any;
  if (tx.type === "BUY") return meta?.amountNaira ? Number(meta.amountNaira) : 0;
  if (tx.type === "SELL") return meta?.ngnGross ? Number(meta.ngnGross) : 0;
  return 0;
}

async function buildEventEntries(metric: "volume" | "trades") {
  const txns = await prisma.transaction.findMany({
    where: {
      type: { in: ["BUY", "SELL"] },
      status: "COMPLETED",
      createdAt: { gte: COMPETITION_START, lt: COMPETITION_END },
    },
    select: { userId: true, type: true, metadata: true },
  });

  // Most Active only counts trades worth at least this much
  const TRADES_MIN_NAIRA = 2000;

  const valueMap: Record<string, number> = {};
  for (const tx of txns) {
    const amt = txNaira(tx);
    if (metric === "volume") {
      if (amt > 0) valueMap[tx.userId] = (valueMap[tx.userId] || 0) + amt;
    } else {
      if (amt >= TRADES_MIN_NAIRA) valueMap[tx.userId] = (valueMap[tx.userId] || 0) + 1;
    }
  }

  const userIds = Object.keys(valueMap).filter((id) => valueMap[id] > 0);
  if (userIds.length === 0)
    return [] as Array<{
      userId: string;
      name: string;
      anon: boolean;
      selfName: string;
      avatar: string | null;
      value: number;
    }>;

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true, firstName: true, anonMode: true, avatarUrl: true, avatarData: true },
  });
  // Bounded by userIds, which the caller has already cut to the rows it
  // returns - so the image column is affordable here.
  const userMap: Record<string, { name: string; anon: boolean; selfName: string; avatar: string | null }> = {};
  for (const u of users) {
    userMap[u.id] = {
      ...publicName(u),
      selfName: u.username || u.firstName || "You",
      avatar: u.avatarData ?? u.avatarUrl ?? null,
    };
  }

  return userIds
    .map((id) => ({
      userId: id,
      name: userMap[id]?.name || "Anonymous",
      anon: userMap[id]?.anon ?? false,
      selfName: userMap[id]?.selfName || "You",
      avatar: userMap[id]?.avatar || null,
      value: valueMap[id],
    }))
    .sort((a, b) => b.value - a.value);
}

function parsePage(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), 100);
}

async function handleEventLeaderboard(
  req: Request,
  res: Response,
  metric: "volume" | "trades",
) {
  try {
    const userId = req.user!.userId;
    const page = parsePage(req.query.page);

    const entries = await buildEventEntries(metric);
    const totalUsers = entries.length;
    const start = (page - 1) * EVENTS_PAGE_SIZE;
    const end = start + EVENTS_PAGE_SIZE;
    const slice = entries.slice(start, end);

    const top = slice.map((e, i) => ({
      rank: start + i + 1,
      name: e.name,
      anon: e.anon,
      avatar: e.avatar,
      value: e.value,
    }));

    const myIdx = entries.findIndex((e) => e.userId === userId);
    const myEntry = myIdx >= 0 ? entries[myIdx] : null;

    res.json({
      page,
      pageSize: EVENTS_PAGE_SIZE,
      totalUsers,
      hasMore: end < totalUsers,
      top,
      me: {
        rank: myIdx >= 0 ? myIdx + 1 : null,
        name: myEntry?.selfName || "You",
        avatar: myEntry?.avatar || null,
        value: myEntry?.value || 0,
      },
    });
  } catch (err) {
    console.error(`Leaderboard events/${metric} error:`, err);
    res.status(500).json({ error: "Failed to load leaderboard" });
  }
}

router.get("/events/volume", requireAuth, requireActiveSession, (req, res) =>
  handleEventLeaderboard(req, res, "volume"),
);

router.get("/events/trades", requireAuth, requireActiveSession, (req, res) =>
  handleEventLeaderboard(req, res, "trades"),
);

export default router;
