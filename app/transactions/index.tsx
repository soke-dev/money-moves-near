import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SectionList,
  Platform,
  Modal,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { TransactionItem } from "@/components/TransactionItem";
import { ts } from "@/constants/transfer";
import { getTransactions, type Transaction } from "@/services/transactions";

/** The server's largest page, and the size Home loads first. */
const PAGE = 50;
/** The period the screen opens on. */
const DEFAULT_DATE = "30d";

/**
 * Type filters, in the user's terms rather than the schema's.
 *
 * The database splits a transfer into TRANSFER, TRANSFER_IN and TRANSFER_OUT
 * and files data and electricity under AIRTIME; nobody scanning their history
 * thinks that way. Each filter collects the types that mean one thing, and the
 * labels match what a receipt for that transaction is badged.
 */
const TYPE_FILTERS: { key: string; label: string; types: string[] }[] = [
  { key: "all", label: "All", types: [] },
  { key: "in", label: "Money in", types: ["DEPOSIT", "TRANSFER_IN"] },
  { key: "out", label: "Money out", types: ["WITHDRAW", "TRANSFER_OUT", "TRANSFER"] },
  { key: "fund", label: "Fund", types: ["BUY"] },
  {
    key: "transfers",
    label: "Transfers",
    types: ["SELL", "TRANSFER", "TRANSFER_IN", "TRANSFER_OUT", "WITHDRAW"],
  },
  { key: "bills", label: "Bills", types: ["AIRTIME", "DATA", "TV"] },
  { key: "savings", label: "Savings", types: ["LOCK", "UNLOCK", "SAVINGS_LOCK", "SAVINGS_WITHDRAW"] },
];

/**
 * Periods rather than a calendar.
 *
 * Presets answer what people actually ask of a history screen ("what did I
 * spend this week") in one tap, and need no date-picker dependency.
 */
const DATE_FILTERS: { key: string; label: string; from: () => Date | null }[] = [
  { key: "all", label: "All time", from: () => null },
  {
    key: "today",
    label: "Today",
    from: () => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    },
  },
  { key: "7d", label: "Last 7 days", from: () => new Date(Date.now() - 7 * 864e5) },
  { key: "30d", label: "Last 30 days", from: () => new Date(Date.now() - 30 * 864e5) },
  { key: "year", label: "This year", from: () => new Date(new Date().getFullYear(), 0, 1) },
];

export default function TransactionsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { transactions: recent } = useApp();

  /**
   * Older pages, fetched here as they're needed.
   *
   * Home holds only the newest page, so "All time" used to end wherever that
   * page did - a few weeks back for anyone busy. The rest comes in as the list
   * is scrolled, and a period further back than what's loaded is filled in
   * before it's shown.
   */
  const [older, setOlder] = useState<Transaction[]>([]);
  const [nextPage, setNextPage] = useState(2);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const busy = useRef(false);
  const transactions = useMemo(() => {
    const seen = new Set<string>();
    return [...recent, ...older]
      .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [recent, older]);
  const loadMore = useCallback(async () => {
    if (busy.current || !hasMore || recent.length < PAGE) return;
    busy.current = true;
    setLoadingMore(true);
    try {
      const r = await getTransactions({ page: nextPage, limit: PAGE });
      setOlder((o) => [...o, ...r.transactions]);
      setNextPage((n) => n + 1);
      setHasMore(r.transactions.length > 0 && nextPage < (r.pagination?.pages ?? 0));
    } catch {
      // Not now: scrolling again asks again.
    } finally {
      busy.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, nextPage, recent.length]);
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [typeKey, setTypeKey] = useState("all");
  const [dateKey, setDateKey] = useState(DEFAULT_DATE);
  const [showDates, setShowDates] = useState(false);

  const typeFilter = TYPE_FILTERS.find((f) => f.key === typeKey) ?? TYPE_FILTERS[0];
  const dateFilter = DATE_FILTERS.find((f) => f.key === dateKey) ?? DATE_FILTERS[0];
  const filtering = typeKey !== "all" || dateKey !== "all";

  const filtered = useMemo(() => {
    const types = typeFilter.types;
    const from = dateFilter.from();
    return transactions.filter((tx) => {
      if (types.length && !types.includes(tx.type)) return false;
      if (from && new Date(tx.createdAt) < from) return false;
      return true;
    });
  }, [transactions, typeFilter, dateFilter]);

  // A period reaching further back than what's loaded: the next page, until it's covered or there's nothing older.
  useEffect(() => {
    const from = dateFilter.from();
    const oldest = transactions[transactions.length - 1];
    if (from && oldest && new Date(oldest.createdAt) >= from) void loadMore();
  }, [dateFilter, transactions, loadMore]);

  const sections = useMemo(() => {
    const grouped = filtered.reduce((acc: Record<string, typeof filtered>, tx) => {
      const key = new Date(tx.createdAt).toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
      });
      if (!acc[key]) acc[key] = [];
      acc[key].push(tx);
      return acc;
    }, {});
    return Object.entries(grouped).map(([date, data]) => ({ title: date, data }));
  }, [filtered]);

  // Lit only when it's been changed from the period the screen opens on.
  const dateOn = dateKey !== DEFAULT_DATE;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* Both ways out of this list live in the header beside the title.
          As banners under it they were two more rows to scroll past before
          reaching the thing the screen is for. */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        {/* Left, and smaller. Centred it was competing with two buttons for
            the middle of the row; here it is a label on the screen and the
            buttons are what the eye goes to. */}
        <Text style={[styles.title, { color: colors.foreground }]}>Transactions</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[styles.action, { backgroundColor: colors.card }]}
            onPress={() => router.push("/transactions/summary")}
            activeOpacity={0.75}
          >
            <Feather name="bar-chart-2" size={14} color={colors.foreground} />
            <Text style={[styles.actionText, { color: colors.foreground }]}>Summary</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.action, { backgroundColor: colors.card }]}
            onPress={() => router.push("/transactions/statement")}
            activeOpacity={0.75}
          >
            <Feather name="file-text" size={14} color={colors.foreground} />
            <Text style={[styles.actionText, { color: colors.foreground }]}>Statement</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Filtering happens in the list, not in a form.
          A sheet with sections and an Apply button made choosing a filter a
          task of its own. Here every tap re-filters immediately and the row
          doubles as the readout of what is applied, so there is nothing to
          confirm and nothing to close. The period leads because it scopes
          whichever type is chosen. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // flexGrow:0: a horizontal scroller in a column stretches otherwise.
        style={styles.barTrack}
        contentContainerStyle={styles.bar}
      >
        <TouchableOpacity
          style={[
            styles.chip,
            styles.dateChip,
            { backgroundColor: dateOn ? colors.foreground : colors.card },
          ]}
          onPress={() => setShowDates(true)}
          activeOpacity={0.75}
        >
          <Feather
            name="calendar"
            size={13}
            color={dateOn ? colors.background : colors.mutedForeground}
          />
          <Text
            style={[styles.chipText, { color: dateOn ? colors.background : colors.mutedForeground }]}
          >
            {dateFilter.label}
          </Text>
          <Feather
            name="chevron-down"
            size={13}
            color={dateOn ? colors.background : colors.mutedForeground}
          />
        </TouchableOpacity>

        <View style={[styles.barDivider, { backgroundColor: colors.border }]} />

        {TYPE_FILTERS.map((f) => {
          const on = f.key === typeKey;
          return (
            <TouchableOpacity
              key={f.key}
              style={[styles.chip, { backgroundColor: on ? colors.foreground : colors.card }]}
              onPress={() => setTypeKey(f.key)}
              activeOpacity={0.75}
            >
              <Text
                style={[styles.chipText, { color: on ? colors.background : colors.mutedForeground }]}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderSectionHeader={({ section: { title } }) => (
          <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{title}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() =>
              router.push({ pathname: "/transactions/detail", params: { id: item.id } })
            }
          >
            <TransactionItem
              type={item.type}
              asset={item.asset}
              chain={item.chain}
              amount={Number(item.amount)}
              createdAt={item.createdAt}
              status={item.status}
              metadata={item.metadata}
            />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {filtering ? "Nothing here" : "No transactions yet"}
            </Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {filtering
                ? `No ${typeKey === "all" ? "transactions" : typeFilter.label.toLowerCase()} in this period.`
                : "Your transactions will appear here."}
            </Text>
            {filtering && (
              <TouchableOpacity
                style={styles.emptyBtn}
                onPress={() => { setTypeKey("all"); setDateKey("all"); }}
                activeOpacity={0.7}
              >
                <Text style={[styles.emptyBtnText, { color: colors.primary }]}>Clear filters</Text>
              </TouchableOpacity>
            )}
          </View>
        }
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.6}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: 20 }} color={colors.mutedForeground} /> : null}
        contentContainerStyle={sections.length === 0 ? { flexGrow: 1 } : { paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      />

      {/* Five choices, so the sheet is the list and nothing else - no title, no
          confirm step. Picking one is the whole interaction. */}
      {showDates && (
        <Modal transparent animationType="slide" visible>
          <TouchableOpacity
            style={ts.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowDates(false)}
          >
            <View
              style={[ts.bankSheet, { backgroundColor: colors.card, paddingBottom: bottomPad + 12 }]}
              onStartShouldSetResponder={() => true}
            >
              <View style={[ts.handle, { alignSelf: "center", backgroundColor: colors.primary }]} />

              {DATE_FILTERS.map((f, i) => {
                const on = f.key === dateKey;
                return (
                  <TouchableOpacity
                    key={f.key}
                    style={[
                      styles.dateRow,
                      i < DATE_FILTERS.length - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: colors.border,
                      },
                    ]}
                    onPress={() => { setDateKey(f.key); setShowDates(false); }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.dateText,
                        {
                          color: on ? colors.primary : colors.foreground,
                          fontFamily: on ? "Inter_600SemiBold" : "Inter_400Regular",
                        },
                      ]}
                    >
                      {f.label}
                    </Text>
                    {on && <Feather name="check" size={17} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 14,
  },
  // Takes the slack between the title and the buttons, so they sit hard right
  // whatever the title is called.
  title: { flex: 1, marginLeft: 12, fontSize: 15.5, fontFamily: "Inter_600SemiBold" },
  headerActions: { flexDirection: "row", gap: 7 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 9,
  },
  actionText: { fontSize: 11.5, lineHeight: 15, fontFamily: "Inter_500Medium" },


  // A row that runs off the edge of the screen, so it reads as part of the
  // list rather than a control panel bolted above it.
  // The row carries only its own height; the space under it belongs to the
  // date header, which gets the same gap wherever it falls in the list.
  barTrack: { flexGrow: 0 },
  bar: { paddingHorizontal: 20, gap: 8, alignItems: "center" },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: 11, justifyContent: "center" },
  dateChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12 },
  chipText: { fontSize: 13, lineHeight: 17, fontFamily: "Inter_500Medium" },
  barDivider: { width: StyleSheet.hairlineWidth, height: 18, marginHorizontal: 3 },

  sectionHeader: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 },
  sectionTitle: { fontSize: 12, fontFamily: "Inter_500Medium" },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, paddingBottom: 90 },
  emptyTitle: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 5 },
  emptyBtn: { paddingVertical: 12, paddingHorizontal: 18, marginTop: 4 },
  emptyBtnText: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold" },

  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 54,
  },
  dateText: { fontSize: 15, lineHeight: 20 },
});
