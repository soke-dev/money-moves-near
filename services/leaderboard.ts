import { api } from "./api";

export interface PointsLeaderEntry {
  rank: number;
  name: string;
  /** Hidden by its owner: draw it redacted, with the reason on tap. */
  anon?: boolean;
  avatar: string | null;
  points: number;
  volume: number;
}

export interface ReferralsLeaderEntry {
  rank: number;
  name: string;
  anon?: boolean;
  avatar: string | null;
  count: number;
}

export interface PointsLeaderboard {
  top: PointsLeaderEntry[];
  me: { rank: number | null; name: string; avatar: string | null; points: number; volume: number };
  /** Whoever sits one place above. Null when nobody does. */
  next?: { rank: number; name: string; points: number } | null;
}

export interface ReferralsLeaderboard {
  top: ReferralsLeaderEntry[];
  me: { rank: number | null; name: string; avatar: string | null; count: number };
}

export async function getPointsLeaderboard(): Promise<PointsLeaderboard> {
  const res = await api.get("/leaderboard/points");
  return res.data;
}

export async function getReferralsLeaderboard(): Promise<ReferralsLeaderboard> {
  const res = await api.get("/leaderboard/referrals");
  return res.data;
}

// ─── Trading Events (monthly) ───────────────────────────────
export interface EventLeaderEntry {
  rank: number;
  name: string;
  anon?: boolean;
  avatar: string | null;
  value: number;
}

export interface EventLeaderboard {
  page: number;
  pageSize: number;
  totalUsers: number;
  hasMore: boolean;
  top: EventLeaderEntry[];
  me: { rank: number | null; name: string; avatar: string | null; value: number };
}

export async function getEventVolumeLeaderboard(page = 1): Promise<EventLeaderboard> {
  const res = await api.get("/leaderboard/events/volume", { params: { page } });
  return res.data;
}

export async function getEventTradesLeaderboard(page = 1): Promise<EventLeaderboard> {
  const res = await api.get("/leaderboard/events/trades", { params: { page } });
  return res.data;
}
