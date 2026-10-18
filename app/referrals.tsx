import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { getReferralStats } from "@/services/user";
import { getPointsLeaderboard } from "@/services/leaderboard";

/** A point for every naira hundred moved. */
const METER_BARS = 16;

/**
 * Pebbled grain, the way a leather card has it.
 *
 * Generated once at module load from a fixed seed rather than Math.random, so
 * the pattern is the same every render - grain that reshuffles when state
 * changes reads as a glitch, not a material.
 */
const GRAIN = (() => {
  let seed = 20260912;
  const next = () => {
    // Park-Miller: small, deterministic, good enough for scattering dots.
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: 150 }, () => ({
    cx: next() * 100,
    cy: next() * 100,
    r: 0.25 + next() * 0.55,
    o: 0.03 + next() * 0.07,
  }));
})();

/**
 * Loyalty.
 *
 * What you have earned, where that puts you, and what earns the next one.
 *
 * Referrals have their own screen now that sign-up takes a code again - this
 * one links to it rather than carrying the code, the counter and an Invite
 * button itself, because points are what this page is about.
 */
export default function LoyaltyScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useApp();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ loyaltyPoints: 0, totalVolume: 0, referralCount: 0 });
  const [rank, setRank] = useState<number | null>(null);
  const [next, setNext] = useState<{ rank: number; name: string; points: number } | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getReferralStats()
        .then((data) => setStats(data.stats))
        .catch(() => {}),
      // Where the points actually put you. A number with nothing to measure it
      // against is just a number.
      getPointsLeaderboard()
        .then((data) => {
          setRank(data.me?.rank ?? null);
          setNext(data.next ?? null);
        })
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const naira = (v: number) =>
    "₦" + Math.round(v).toLocaleString("en-NG");

  /**
   * How far up the board you are, not how close the next single point is.
   *
   * A point costs a fixed amount of volume, so "67 naira to your next point"
   * was always true, always small, and never told anyone anything. What people
   * actually want to know is how far off the person above them is.
   */
  const myPoints = stats.loyaltyPoints;
  const target = next?.points ?? 0;
  const climb = next ? Math.min(myPoints / Math.max(target, 1), 1) : rank === 1 ? 1 : 0;
  // One more than the gap: matching them is not passing them.
  const toPass = next ? Math.max(target - myPoints + 1, 1) : 0;

  const climbNote = next
    ? `${toPass.toLocaleString()} points to pass ${next.name} for #${next.rank}`
    : rank === 1
    ? "Nobody above you. Hold it."
    : "Move money to get on the board.";

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.foreground }]}>Loyalty</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomPad + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* First, while it can still be done: this is the page people open
            looking for where to type a friend's code, and the box itself
            lives on the referral dashboard. Gone after the first week, or
            once they have added one. */}
        {user?.referralClaim?.open && (
          <TouchableOpacity
            style={[s.claimPrompt, { backgroundColor: colors.primary + "14", borderColor: colors.primary + "40" }]}
            onPress={() => router.push("/referral-dashboard" as any)}
            activeOpacity={0.8}
          >
            <View style={[s.rowIcon, { backgroundColor: colors.primary + "22" }]}>
              <Feather name="gift" size={17} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.rowTitle, { color: colors.foreground }]}>Were you invited?</Text>
              <Text style={[s.rowSub, { color: colors.mutedForeground }]}>
                Add your friend's code ·{" "}
                {user.referralClaim.daysLeft === 1 ? "last day" : `${user.referralClaim.daysLeft} days left`}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.primary} />
          </TouchableOpacity>
        )}

        {/* A membership card, not a statistics panel: whose points these are,
            then the points. The pattern is the brand mark blown up and clipped
            by the card, the way the bills tiles carry theirs. */}
        <View style={[s.hero, { backgroundColor: colors.card }]}>
          {/* Light falling across a hide: brighter at the top corner, darker
              at the bottom, rather than a flat fill. */}
          <LinearGradient
            colors={["#ffffff14", "transparent", "#00000044"]}
            locations={[0, 0.45, 1]}
            start={{ x: 0.9, y: 0 }}
            end={{ x: 0.2, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />

          {/* The grain itself, in viewBox units so it stretches with the card. */}
          <Svg
            style={StyleSheet.absoluteFill}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            pointerEvents="none"
          >
            {GRAIN.map((g, i) => (
              <Circle key={i} cx={g.cx} cy={g.cy} r={g.r} fill="#ffffff" opacity={g.o} />
            ))}
          </Svg>

          {/* Stitching, inset from the edge the way it is sewn on a wallet. */}
          <View style={[s.stitch, { borderColor: "#ffffff1c" }]} pointerEvents="none" />

          <Image
            source={require("@/assets/images/brand.png")}
            style={[s.pattern, { tintColor: colors.primary }]}
            resizeMode="contain"
          />

          <View style={s.who}>
            <View style={[s.avatar, { backgroundColor: colors.muted }]}>
              {user?.avatarUrl ? (
                <Image source={{ uri: user.avatarUrl }} style={s.avatarImg} resizeMode="cover" />
              ) : (
                <Text style={[s.avatarInitial, { color: colors.primary }]}>
                  {(user?.username || user?.firstName || "M").charAt(0).toUpperCase()}
                </Text>
              )}
            </View>
            <Text style={[s.handle, { color: colors.foreground }]} numberOfLines={1}>
              @{user?.username || "you"}
            </Text>
            {rank !== null && (
              <View style={[s.rankPill, { backgroundColor: colors.primary + "22" }]}>
                <Text style={[s.rankText, { color: colors.primary }]}>#{rank}</Text>
              </View>
            )}
          </View>

          <Text style={[s.heroLabel, { color: colors.mutedForeground }]}>YOUR POINTS</Text>

          {loading ? (
            <ActivityIndicator color={colors.primary} style={s.heroLoading} />
          ) : (
            <Text style={[s.points, { color: colors.foreground }]}>
              {stats.loyaltyPoints.toLocaleString()}
            </Text>
          )}

          {/* Read as a meter on an instrument rather than a web progress bar:
              discrete bars in a recessed housing, lit from the left, the last
              lit bar brightest. Twenty-four of them, so a single point of
              movement is visible without the thing looking like a chart. */}
          <View
            style={[
              s.meter,
              { borderColor: colors.border, backgroundColor: colors.background + "88" },
            ]}
          >
            {Array.from({ length: METER_BARS }).map((_, i) => {
              const lit = i < Math.round(climb * METER_BARS);
              const tip = i === Math.round(climb * METER_BARS) - 1;
              return (
                <View
                  key={i}
                  style={[
                    s.meterBar,
                    {
                      backgroundColor: lit ? colors.primary : colors.mutedForeground,
                      // Lit bars deepen toward the tip; unlit ones are barely there.
                      opacity: lit ? (tip ? 1 : 0.45 + 0.4 * (i / METER_BARS)) : 0.16,
                    },
                  ]}
                />
              );
            })}
          </View>
          <Text style={[s.trackNote, { color: colors.mutedForeground }]}>{climbNote}</Text>

          <View style={[s.volumeRow, { borderTopColor: colors.border }]}>
            <Text style={[s.heroStatLabel, { color: colors.mutedForeground }]}>Volume moved</Text>
            <Text style={[s.heroStatValue, { color: colors.foreground }]}>
              {naira(stats.totalVolume)}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[s.row, { backgroundColor: colors.card }]}
          onPress={() => router.push("/leaderboard")}
          activeOpacity={0.75}
        >
          <View style={[s.rowIcon, { backgroundColor: colors.muted }]}>
            <Image
              source={require("@/assets/images/brand.png")}
              style={[s.rowMark, { tintColor: colors.mutedForeground }]}
              resizeMode="contain"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.rowTitle, { color: colors.foreground }]}>Leaderboard</Text>
            <Text style={[s.rowSub, { color: colors.mutedForeground }]}>
              {rank !== null ? `You are ranked #${rank}` : "See where you stand"}
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>

        {/* Beside the leaderboard, because that is the only thing a referral
            earns: a place on the referral board. */}
        <TouchableOpacity
          style={[s.row, { backgroundColor: colors.card }]}
          onPress={() => router.push("/referral-dashboard" as any)}
          activeOpacity={0.75}
        >
          <View style={[s.rowIcon, { backgroundColor: colors.muted }]}>
            <Feather name="user-plus" size={17} color={colors.mutedForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.rowTitle, { color: colors.foreground }]}>Invite friends</Text>
            <Text style={[s.rowSub, { color: colors.mutedForeground }]}>
              {stats.referralCount > 0
                ? `${stats.referralCount} ${stats.referralCount === 1 ? "friend has" : "friends have"} joined`
                : "Share your code"}
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>

        {/* Under the leaderboard: the points are what this screen is about,
            and a voucher is something you do when you happen to hold a code
            rather than a reason to have opened it. */}
        <TouchableOpacity
          style={[s.row, { backgroundColor: colors.card }]}
          onPress={() => router.push("/voucher")}
          activeOpacity={0.75}
        >
          <View style={[s.rowIcon, { backgroundColor: colors.primary + "1A" }]}>
            <Image
              source={require("@/assets/images/gift-card.png")}
              style={[s.rowMark, { tintColor: colors.primary }]}
              resizeMode="contain"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.rowTitle, { color: colors.foreground }]}>Voucher</Text>
            <Text style={[s.rowSub, { color: colors.mutedForeground }]}>
              Type a code or scan a QR
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>

        {/* Said plainly, because the old page promised "exclusive rewards"
            without any existing. */}
        <View style={s.note}>
          <Feather name="info" size={13} color={colors.mutedForeground} />
          <Text style={[s.noteText, { color: colors.mutedForeground }]}>
            Points build as you move money and set your place on the leaderboard. What they unlock
            is coming.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },

  hero: {
    marginHorizontal: 16,
    marginTop: 6,
    borderRadius: 22,
    padding: 20,
    overflow: "hidden",
    // A lip of light along the top edge, so the card has a thickness.
    borderWidth: 1,
    borderColor: "#ffffff12",
  },
  stitch: {
    position: "absolute",
    top: 9,
    left: 9,
    right: 9,
    bottom: 9,
    borderRadius: 15,
    borderWidth: 1,
    borderStyle: "dashed",
    pointerEvents: "none",
  },
  // Oversized and clipped by the card, so it reads as texture rather than an
  // icon that happens to be large.
  pattern: { position: "absolute", right: -54, top: -46, width: 210, height: 210, opacity: 0.07, pointerEvents: "none" },

  who: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 20 },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarImg: { width: "100%", height: "100%" },
  avatarInitial: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_700Bold" },
  handle: { flex: 1, fontSize: 15, lineHeight: 20, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },
  rankPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  rankText: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_700Bold" },

  heroLabel: { fontSize: 10.5, lineHeight: 14, fontFamily: "Inter_700Bold", letterSpacing: 1.1 },
  points: { fontSize: 46, lineHeight: 54, fontFamily: "Inter_800ExtraBold", letterSpacing: -1.6, marginTop: 4 },
  heroLoading: { alignSelf: "flex-start", marginTop: 20, marginBottom: 18 },

  // Sized like a gauge on an instrument, not a loading bar: short, and
  // stopping well before the edge of the card so the eye reads it as a
  // measure rather than a container waiting to fill.
  meter: {
    width: "62%",
    height: 14,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 16,
    paddingHorizontal: 3,
    paddingVertical: 3,
    flexDirection: "row",
    alignItems: "stretch",
    gap: 2,
    overflow: "hidden",
  },
  meterBar: { flex: 1, borderRadius: 1 },
  trackNote: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 8 },

  volumeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 18,
    paddingTop: 16,
  },
  heroStatLabel: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular" },
  heroStatValue: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_700Bold" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  rowIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  // A row in the same shape as the others, lit so it reads as the one thing
  // to do rather than one more place to go. Sits above the card, so it takes
  // the gap below rather than above.
  claimPrompt: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    marginHorizontal: 16,
    marginBottom: 14,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  rowMark: { width: 18, height: 18 },
  rowTitle: { fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  rowSub: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular", marginTop: 1 },

  note: { flexDirection: "row", gap: 8, marginHorizontal: 22, marginTop: 18 },
  noteText: { flex: 1, fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
});
