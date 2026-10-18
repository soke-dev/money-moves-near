import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import {
  getDisplayCurrency,
  currencySymbol,
  type DisplayCurrency,
} from "@/services/display-currency";

type Period = "week" | "month";

const MONEY_IN = ["DEPOSIT", "BUY", "TRANSFER_IN"];
const MONEY_OUT = ["SELL", "TRANSFER", "TRANSFER_OUT", "WITHDRAW", "AIRTIME", "DATA", "TV", "ELECTRICITY"];

/**
 * Categories named the way the rest of the app names them.
 *
 * A receipt for a BUY is badged "Fund" and a SELL "Transfer", so calling them
 * Buy and Sell here meant one transaction had two names depending on which
 * screen you were looking at.
 */
const CATEGORIES: { label: string; types: string[]; color: (c: any) => string }[] = [
  { label: "Fund", types: ["BUY"], color: (c) => c.primary },
  { label: "Bank transfer", types: ["SELL"], color: (c) => c.destructive },
  { label: "Crypto sent", types: ["TRANSFER", "TRANSFER_OUT"], color: () => "#2775CA" },
  { label: "Withdrawals", types: ["WITHDRAW"], color: () => "#8B5CF6" },
  { label: "Received", types: ["DEPOSIT", "TRANSFER_IN"], color: (c) => c.success },
  { label: "Bills", types: ["AIRTIME", "DATA", "TV", "ELECTRICITY"], color: () => "#F59E0B" },
  { label: "Savings", types: ["LOCK", "UNLOCK", "SAVINGS_LOCK", "SAVINGS_WITHDRAW"], color: () => "#14B8A6" },
];

export default function SummaryScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { transactions, rates } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const [period, setPeriod] = useState<Period>("month");
  const [currency, setCurrency] = useState<DisplayCurrency>("NGN");

  // The same preference the home balance follows. Showing dollars here while
  // the dashboard shows naira made the two screens disagree.
  useFocusEffect(
    useCallback(() => {
      getDisplayCurrency().then(setCurrency);
    }, []),
  );

  const symbol = currencySymbol(currency);

  const convert = useCallback(
    (amount: number, asset: string) => {
      const r = (rates as any)?.[asset];
      if (currency === "NGN") {
        const ngn = r?.ngn ?? (asset === "USDC" || asset === "USDT" ? (rates as any)?.USDC?.ngn ?? 0 : 0);
        return amount * ngn;
      }
      const usd = r?.usd ?? (asset === "USDC" || asset === "USDT" ? 1 : 0);
      return amount * usd;
    },
    [rates, currency],
  );

  const money = useCallback(
    (v: number) =>
      symbol +
      v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [symbol],
  );

  /**
   * Where the period starts.
   *
   * "This week" means the week you are in, not the last seven days. It was
   * rolling, so on a Monday it reached back to the previous Tuesday and the
   * label was simply untrue - and since it then covered most of the month, the
   * two tabs showed the same totals and looked broken.
   *
   * The week starts Sunday, which is where a Nigerian calendar week starts.
   */
  const cutoff = useMemo(() => {
    const now = new Date();
    if (period === "week") {
      const d = new Date(now);
      d.setDate(d.getDate() - d.getDay());
      d.setHours(0, 0, 0, 0);
      return d;
    }
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }, [period]);

  const filtered = useMemo(
    () => transactions.filter((t) => t.status === "COMPLETED" && new Date(t.createdAt) >= cutoff),
    [transactions, cutoff],
  );

  const totalIn = useMemo(
    () =>
      filtered
        .filter((t) => MONEY_IN.includes(t.type))
        .reduce((sum, t) => sum + convert(Number(t.amount), t.asset), 0),
    [filtered, convert],
  );

  const totalOut = useMemo(
    () =>
      filtered
        .filter((t) => MONEY_OUT.includes(t.type))
        .reduce((sum, t) => sum + convert(Number(t.amount), t.asset), 0),
    [filtered, convert],
  );

  const net = totalIn - totalOut;
  const flow = totalIn + totalOut;
  const inShare = flow > 0 ? totalIn / flow : 0.5;

  const categories = useMemo(() => {
    const rows = CATEGORIES.map((cat) => {
      const txs = filtered.filter((t) => cat.types.includes(t.type));
      return {
        label: cat.label,
        color: cat.color(colors),
        count: txs.length,
        amount: txs.reduce((s, t) => s + convert(Number(t.amount), t.asset), 0),
      };
    }).filter((c) => c.count > 0);

    // Biggest first. A fixed order buried the number that mattered halfway
    // down the list, and it is also the order the stacked bar is drawn in.
    rows.sort((a, b) => b.amount - a.amount);
    return rows;
  }, [filtered, convert, colors]);

  /**
   * Daily in/out columns, from the start of the period to today.
   *
   * One bucket per day elapsed, never per day the period could hold: a week
   * two days old draws two columns rather than seven, five of which would be
   * empty and read as five days of nothing.
   */
  const bars = useMemo(() => {
    const now = new Date();
    const days = Math.floor((now.getTime() - cutoff.getTime()) / 864e5) + 1;
    const buckets = Array.from({ length: Math.max(days, 1) }, () => ({ inAmt: 0, outAmt: 0 }));

    filtered.forEach((t) => {
      const d = new Date(t.createdAt);
      const idx = Math.floor((d.getTime() - cutoff.getTime()) / 864e5);
      if (idx < 0 || idx >= buckets.length) return;
      const v = convert(Number(t.amount), t.asset);
      if (MONEY_IN.includes(t.type)) buckets[idx].inAmt += v;
      else if (MONEY_OUT.includes(t.type)) buckets[idx].outAmt += v;
    });

    const max = Math.max(...buckets.flatMap((b) => [b.inAmt, b.outAmt]), 1);
    return buckets.map((b) => ({ i: b.inAmt / max, o: b.outAmt / max }));
  }, [filtered, cutoff, convert]);

  const rangeLabel = useMemo(() => {
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return {
      from: cutoff.toLocaleDateString("en-US", opts),
      to: new Date().toLocaleDateString("en-US", opts),
    };
  }, [cutoff]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Summary</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        {/* One control, two segments, rather than two loose chips that each
            look like they could be on at the same time. */}
        <View style={[styles.segment, { backgroundColor: colors.card }]}>
          {(["week", "month"] as Period[]).map((p) => {
            const on = p === period;
            return (
              <TouchableOpacity
                key={p}
                style={[styles.segmentItem, on && { backgroundColor: colors.foreground }]}
                onPress={() => setPeriod(p)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.segmentText,
                    { color: on ? colors.background : colors.mutedForeground },
                  ]}
                >
                  {p === "week" ? "This week" : "This month"}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* No card. A figure this size is the page - boxing it made it a
            widget on a page, and put a border between the headline and the
            chart that explains it. */}
        <View style={styles.hero}>
          <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>
            NET {period === "week" ? "THIS WEEK" : "THIS MONTH"}
          </Text>
          <Text
            style={[styles.heroAmount, { color: net >= 0 ? colors.success : colors.destructive }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {net >= 0 ? "+" : "-"}
            {money(Math.abs(net))}
          </Text>
          {/* The two figures that make it, on one line. Stacked in a legend
              with dots they read as a key to a chart that was not there. */}
          <Text style={[styles.heroSplit, { color: colors.mutedForeground }]}>
            <Text style={{ color: colors.success, fontFamily: "Inter_600SemiBold" }}>
              {money(totalIn)}
            </Text>
            {" in  ·  "}
            <Text style={{ color: colors.destructive, fontFamily: "Inter_600SemiBold" }}>
              {money(totalOut)}
            </Text>
            {" out"}
          </Text>
        </View>

        {/*
          In above the line, out below it.
          Two bars side by side per day made every day look like a pair of
          unrelated readings and halved the width each one had. Hung off a
          common baseline the shape of the month is the point: which days took
          money in, which days sent it out, and which did both.
        */}
        <View style={styles.chart}>
          {bars.map((b, i) => (
            <View key={i} style={styles.col}>
              <View style={styles.colUp}>
                {b.i > 0 && (
                  <View
                    style={[
                      styles.barUp,
                      { height: `${Math.max(b.i * 100, 4)}%`, backgroundColor: colors.success },
                    ]}
                  />
                )}
              </View>
              <View style={[styles.baseline, { backgroundColor: colors.border }]} />
              <View style={styles.colDown}>
                {b.o > 0 && (
                  <View
                    style={[
                      styles.barDown,
                      { height: `${Math.max(b.o * 100, 4)}%`, backgroundColor: colors.destructive },
                    ]}
                  />
                )}
              </View>
            </View>
          ))}
        </View>
        <View style={styles.axis}>
          <Text style={[styles.axisText, { color: colors.mutedForeground }]}>{rangeLabel.from}</Text>
          <Text style={[styles.axisText, { color: colors.mutedForeground }]}>{rangeLabel.to}</Text>
        </View>

        <Text style={[styles.eyebrow, styles.sectionLabel, { color: colors.mutedForeground }]}>
          BREAKDOWN
        </Text>

        {categories.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Nothing completed in this period yet.
          </Text>
        ) : (
          <>
            {/* The comparison, once. Every row used to carry its own progress
                bar, which is seven bars to say one thing - and none of them
                could be compared to each other without measuring. */}
            <View style={styles.stack}>
              {categories.map((cat) => (
                <View
                  key={cat.label}
                  style={{ flex: Math.max(cat.amount, 0.0001), backgroundColor: cat.color }}
                />
              ))}
            </View>

            <View style={styles.list}>
              {categories.map((cat, i) => (
                <View
                  key={cat.label}
                  style={[
                    styles.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                  ]}
                >
                  <View style={[styles.dot, { backgroundColor: cat.color }]} />
                  <Text style={[styles.rowLabel, { color: colors.foreground }]} numberOfLines={1}>
                    {cat.label}
                  </Text>
                  <Text style={[styles.rowCount, { color: colors.mutedForeground }]}>
                    {cat.count}
                  </Text>
                  <Text style={[styles.rowAmount, { color: colors.foreground }]}>
                    {money(cat.amount)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },

  segment: {
    flexDirection: "row",
    alignSelf: "flex-start",
    marginHorizontal: 20,
    padding: 3,
    borderRadius: 12,
    gap: 3,
  },
  segmentItem: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 9 },
  segmentText: { fontSize: 13, lineHeight: 17, fontFamily: "Inter_500Medium" },

  // Small, caps, spaced. Used for every label on this screen so they read as
  // one family rather than as headings of varying importance.
  eyebrow: { fontSize: 10.5, fontFamily: "Inter_700Bold", letterSpacing: 1.3 },

  hero: { paddingHorizontal: 22, paddingTop: 30 },
  heroAmount: {
    fontSize: 40,
    lineHeight: 48,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -1.4,
    marginTop: 8,
  },
  heroSplit: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 8 },

  chart: { flexDirection: "row", alignItems: "stretch", gap: 2, height: 128, paddingHorizontal: 20, marginTop: 30 },
  col: { flex: 1 },
  colUp: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  colDown: { flex: 1, justifyContent: "flex-start", alignItems: "center" },
  // Drawn even where a day is empty, so the line is continuous and the chart
  // has an axis rather than a row of floating marks.
  baseline: { height: StyleSheet.hairlineWidth },
  // Capped, so a period two days old draws two bars rather than two slabs.
  barUp: { width: "100%", maxWidth: 30, borderTopLeftRadius: 2.5, borderTopRightRadius: 2.5, minHeight: 3 },
  barDown: { width: "100%", maxWidth: 30, borderBottomLeftRadius: 2.5, borderBottomRightRadius: 2.5, minHeight: 3 },
  axis: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    marginTop: 10,
  },
  axisText: { fontSize: 11, lineHeight: 15, fontFamily: "Inter_400Regular" },

  sectionLabel: { marginTop: 34, marginBottom: 14, marginHorizontal: 22 },

  stack: {
    flexDirection: "row",
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    marginHorizontal: 20,
    marginBottom: 6,
    gap: 2,
  },

  list: { marginHorizontal: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  rowLabel: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_500Medium" },
  // Takes the slack, so the label sits by its dot and the amount by the edge.
  rowCount: { flex: 1, fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular" },
  rowAmount: {
    fontSize: 14,
    lineHeight: 19,
    fontFamily: "Inter_600SemiBold",
    fontVariant: ["tabular-nums"],
  },

  emptyText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingVertical: 26,
  },
});
