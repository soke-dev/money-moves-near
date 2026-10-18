import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  LayoutAnimation,
  UIManager,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { getDailyUsage } from "@/services/transactions";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const fmt = (v: number) => "₦" + v.toLocaleString("en-NG");

type CatKey = "transfers" | "funding" | "bills" | "betting";
type LevelKey = "basic" | "verified";

interface Row {
  label: string;
  value: string;
  locked?: boolean;
}

interface Tier {
  /** The headline pair for this category at this level. 0 means not available. */
  daily: number;
  perTx: number;
  rows: Row[];
}

interface Category {
  key: CatKey;
  label: string;
  /** What "per transfer" should be called here. */
  perLabel: string;
  /** Transaction types that count against this category's daily figure. */
  usageKeys: string[];
  basic: Tier;
  verified: Tier;
}

/**
 * Every limit, by what you are doing and which level you are on.
 *
 * The numbers mirror what the flows enforce - DAILY_LIMIT and PER_TX_LIMIT in
 * airtime.tsx and electricity.tsx, and the transfer caps keyed off user
 * verification - so this page cannot drift from what actually blocks a
 * transaction.
 */
const CATEGORIES: Category[] = [
  {
    key: "transfers",
    label: "Transfers",
    perLabel: "Per transfer",
    usageKeys: ["SELL"],
    basic: {
      daily: 20000,
      perTx: 10000,
      rows: [
        { label: "Bank transfer · daily", value: fmt(20000) },
        { label: "Bank transfer · per transfer", value: fmt(10000) },
        { label: "Crypto transfer", value: "Unlimited" },
        { label: "Username transfer", value: "Unlimited" },
      ],
    },
    verified: {
      daily: 2000000,
      perTx: 500000,
      rows: [
        { label: "Bank transfer · daily", value: fmt(2000000) },
        { label: "Bank transfer · per transfer", value: fmt(500000) },
        { label: "Crypto transfer", value: "Unlimited" },
        { label: "Username transfer", value: "Unlimited" },
      ],
    },
  },
  {
    key: "funding",
    label: "Funding",
    perLabel: "Per transaction",
    usageKeys: ["BUY"],
    basic: {
      daily: 0,
      perTx: 0,
      rows: [{ label: "Fund with naira", value: "Locked", locked: true }],
    },
    verified: {
      daily: 200000,
      perTx: 20000,
      rows: [
        { label: "Fund with naira · daily", value: fmt(200000) },
        { label: "Fund with naira · per transaction", value: fmt(20000) },
      ],
    },
  },
  {
    key: "bills",
    label: "Bills",
    perLabel: "Per transaction",
    usageKeys: ["AIRTIME", "ELECTRICITY"],
    basic: {
      daily: 3000,
      perTx: 1000,
      rows: [
        { label: "Airtime and data · daily", value: fmt(3000) },
        { label: "Airtime and data · per transaction", value: fmt(1000) },
        { label: "Electricity · daily", value: fmt(5000) },
        { label: "Electricity · per transaction", value: fmt(5000) },
      ],
    },
    verified: {
      daily: 10000,
      perTx: 5000,
      rows: [
        { label: "Airtime and data · daily", value: fmt(10000) },
        { label: "Airtime and data · per transaction", value: fmt(5000) },
        { label: "Electricity · daily", value: fmt(20000) },
        { label: "Electricity · per transaction", value: fmt(10000) },
      ],
    },
  },
  /**
   * Its own pool, not a row inside Bills.
   *
   * The server counts betting separately from airtime and electricity, so
   * folding it in would draw one usage bar against three different
   * allowances and misreport all of them.
   *
   * The two figures match because the ceiling given was a daily one — there
   * is no smaller per-transfer cap underneath it.
   */
  {
    key: "betting",
    label: "Betting",
    perLabel: "Per transaction",
    usageKeys: ["BETTING"],
    basic: {
      // Verified only, like funding with naira. Zero is what draws the row
      // as locked rather than as an allowance of nothing.
      daily: 0,
      perTx: 0,
      rows: [{ label: "Betting", value: "Locked", locked: true }],
    },
    verified: {
      daily: 10000,
      perTx: 10000,
      rows: [
        { label: "Betting · daily", value: fmt(10000) },
        { label: "Betting · per transaction", value: fmt(10000) },
      ],
    },
  },
];

/** What each level asks of you. Didit collects the ID and selfie, not us. */
const DOCS: Record<LevelKey, string[]> = {
  basic: ["Email address"],
  verified: ["Valid government ID", "Face match", "Liveness check"],
};

export default function LimitsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const verified = !!user?.verified;
  const currentKey: LevelKey = verified ? "verified" : "basic";

  const [cat, setCat] = useState<CatKey>("transfers");
  // The level you are on opens itself; the other is there to compare against.
  const [open, setOpen] = useState<LevelKey | null>(currentKey);
  const [usage, setUsage] = useState<Record<string, number>>({});

  useFocusEffect(
    useCallback(() => {
      getDailyUsage()
        .then((r) => setUsage(r.usage))
        .catch(() => {});
    }, []),
  );

  const category = CATEGORIES.find((c) => c.key === cat) ?? CATEGORIES[0];
  const tier = category[currentKey];
  const usedToday = category.usageKeys.reduce((sum, k) => sum + (usage[k] || 0), 0);
  const pct = tier.daily > 0 ? Math.min(usedToday / tier.daily, 1) : 0;
  /**
   * Never nothing when something has been spent.
   *
   * A verified daily limit is ₦2,000,000, so a ₦500 sale is a fill a fortieth
   * of a point wide - narrower than the track's own corner radius, and so
   * invisible. A sale that counted then reads as one that did not.
   */
  const fill = usedToday > 0 ? Math.max(pct, 0.02) : 0;
  const locked = tier.daily === 0;

  const toggle = (key: LevelKey) => {
    LayoutAnimation.configureNext(LayoutAnimation.create(180, "easeInEaseOut", "opacity"));
    setOpen((prev) => (prev === key ? null : key));
  };

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={s.header}>
        <TouchableOpacity
          style={[s.close, { backgroundColor: colors.card }]}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <Feather name="x" size={18} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.foreground }]}>Transaction limits</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomPad + 110 }}
        showsVerticalScrollIndicator={false}
      >
        {/* The category scopes the whole page: the figures above and the rows
            in both level cards below all follow it. */}
        <View style={s.tabRow}>
          {CATEGORIES.map((c) => {
            const on = c.key === cat;
            return (
              <TouchableOpacity
                key={c.key}
                style={[s.chip, { backgroundColor: on ? colors.foreground : colors.card }]}
                onPress={() => setCat(c.key)}
                activeOpacity={0.75}
              >
                <Text
                  style={[s.chipText, { color: on ? colors.background : colors.mutedForeground }]}
                >
                  {c.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* What applies right now, before any comparison. */}
        <View style={[s.hero, { backgroundColor: colors.card }]}>
          <View style={[s.heroStats, { backgroundColor: colors.background }]}>
            <View style={s.heroStat}>
              <Text style={[s.heroLabel, { color: colors.mutedForeground }]}>Daily limit</Text>
              <Text style={[s.heroValue, { color: locked ? colors.mutedForeground : colors.foreground }]}>
                {locked ? "Locked" : fmt(tier.daily)}
              </Text>
            </View>
            <View style={[s.heroDivider, { backgroundColor: colors.border }]} />
            <View style={s.heroStat}>
              <Text style={[s.heroLabel, { color: colors.mutedForeground }]}>{category.perLabel}</Text>
              <Text style={[s.heroValue, { color: locked ? colors.mutedForeground : colors.foreground }]}>
                {locked ? "Locked" : fmt(tier.perTx)}
              </Text>
            </View>
          </View>

          {locked ? (
            <Text style={[s.heroCaption, { color: colors.mutedForeground, marginTop: 14 }]}>
              Verify your account to unlock {category.label.toLowerCase()}.
            </Text>
          ) : (
            <>
              <View style={[s.track, { backgroundColor: colors.muted }]}>
                <View style={[s.trackFill, { width: `${fill * 100}%`, backgroundColor: colors.primary }]} />
                {/* A knob on the fill, so zero still shows where the scale starts. */}
                <View
                  style={[
                    s.knob,
                    { left: `${fill * 100}%`, backgroundColor: colors.primary, borderColor: colors.card },
                  ]}
                />
              </View>

              {/* The figures, not a percentage of them. Against a ₦2,000,000
                  ceiling every ordinary day rounds to "0%", which reads as
                  nothing counted rather than as a large limit barely touched -
                  and it is the one thing someone opens this page to check. */}
              <Text style={[s.heroCaption, { color: colors.mutedForeground }]}>
                <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold" }}>
                  {fmt(usedToday)}
                </Text>{" "}
                of {fmt(tier.daily)} used today
              </Text>
            </>
          )}
        </View>

        {(["basic", "verified"] as LevelKey[]).map((lvlKey) => {
          const isOpen = open === lvlKey;
          const isCurrent = lvlKey === currentKey;
          const rows = category[lvlKey].rows;
          return (
            <View key={lvlKey} style={[s.card, { backgroundColor: colors.card }]}>
              <TouchableOpacity style={s.cardHead} onPress={() => toggle(lvlKey)} activeOpacity={0.75}>
                <Text style={[s.cardTitle, { color: colors.foreground }]}>
                  {lvlKey === "basic" ? "Basic" : "Verified"}
                </Text>
                {isCurrent && (
                  <View style={[s.badge, { backgroundColor: colors.primary + "22" }]}>
                    <Text style={[s.badgeText, { color: colors.primary }]}>Current</Text>
                  </View>
                )}
                <View style={{ flex: 1 }} />
                <Feather
                  name={isOpen ? "chevron-up" : "chevron-down"}
                  size={19}
                  color={colors.mutedForeground}
                />
              </TouchableOpacity>

              {isOpen && (
                <View style={s.cardBody}>
                  {rows.map((r) => (
                    <View key={r.label} style={s.row}>
                      <Text style={[s.rowLabel, { color: colors.foreground }]}>{r.label}</Text>
                      <Text
                        style={[
                          s.rowValue,
                          { color: r.locked ? colors.mutedForeground : colors.foreground },
                        ]}
                      >
                        {r.value}
                      </Text>
                    </View>
                  ))}

                  <View style={[s.seam, { backgroundColor: colors.border }]} />

                  <Text style={[s.docsLabel, { color: colors.mutedForeground }]}>
                    What this level needs
                  </Text>
                  {DOCS[lvlKey].map((d) => {
                    const done = lvlKey === "basic" || verified;
                    return (
                      <View key={d} style={s.docRow}>
                        <View
                          style={[
                            s.docMark,
                            {
                              backgroundColor: done ? colors.primary : "transparent",
                              borderColor: done ? colors.primary : colors.border,
                            },
                          ]}
                        >
                          {done && <Feather name="check" size={11} color={colors.primaryForeground} />}
                        </View>
                        <Text style={[s.docText, { color: colors.foreground }]}>{d}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View style={[s.bottom, { paddingBottom: bottomPad + 14, backgroundColor: colors.background }]}>
        {verified ? (
          <View style={[s.maxNote, { backgroundColor: colors.card }]}>
            <Feather name="check" size={15} color={colors.primary} />
            <Text style={[s.maxNoteText, { color: colors.mutedForeground }]}>
              You are on the highest level.
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[s.cta, { backgroundColor: colors.primary }]}
            onPress={() => router.push("/account/kyc")}
            activeOpacity={0.85}
          >
            <Text style={[s.ctaText, { color: colors.primaryForeground }]}>Upgrade to Verified</Text>
          </TouchableOpacity>
        )}
      </View>
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
    paddingBottom: 10,
  },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 16.5, lineHeight: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },

  tabRow: { flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 2 },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: 11, justifyContent: "center" },
  chipText: { fontSize: 13, lineHeight: 17, fontFamily: "Inter_500Medium" },

  hero: { marginHorizontal: 20, marginTop: 14, borderRadius: 20, padding: 16 },
  heroStats: { flexDirection: "row", borderRadius: 14, paddingVertical: 16 },
  heroStat: { flex: 1, alignItems: "center", gap: 6 },
  heroLabel: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular" },
  heroValue: { fontSize: 17, lineHeight: 23, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  heroDivider: { width: StyleSheet.hairlineWidth, marginVertical: 4 },

  track: { height: 8, borderRadius: 4, marginTop: 18, justifyContent: "center" },
  trackFill: { height: 8, borderRadius: 4 },
  knob: { position: "absolute", width: 16, height: 16, borderRadius: 8, borderWidth: 3, marginLeft: -8 },
  heroCaption: { fontSize: 12.5, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 12 },

  card: { marginHorizontal: 20, marginTop: 14, borderRadius: 18, paddingHorizontal: 16 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 9, height: 56 },
  cardTitle: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_700Bold" },
  badge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 11.5, lineHeight: 15, fontFamily: "Inter_600SemiBold" },

  cardBody: { paddingBottom: 18 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 8 },
  rowLabel: { flex: 1, fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_400Regular" },
  rowValue: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold" },

  seam: { height: StyleSheet.hairlineWidth, marginVertical: 14 },
  docsLabel: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_500Medium", marginBottom: 10 },
  docRow: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 5 },
  docMark: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  docText: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_500Medium" },

  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12 },
  cta: { height: 56, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  maxNote: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 52,
    borderRadius: 999,
  },
  maxNoteText: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_500Medium" },
});
