import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { getTransactions } from "@/services/transactions";
import {
  BILL_CATEGORIES,
  PROVIDER_LOGOS,
  billLabel,
  billCategory,
  type BillCategory,
} from "@/constants/bills";
import { useServiceStatus } from "@/hooks/useServiceStatus";

interface Recent {
  id: string;
  label: string;
  provider: string;
  logo?: any;
  category: BillCategory;
}

/**
 * Survives leaving the screen.
 *
 * Recents are a convenience, and a convenience that makes you watch a spinner
 * every time you open the screen is not one.
 */
let cachedRecents: Recent[] = [];

export default function BillsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState<Recent[]>(cachedRecents);
  const svc = useServiceStatus();

  /**
   * Off, and why.
   *
   * Two different states that look the same from a distance and must not read
   * the same: `soon` is something we have not built, paused is something that
   * normally works and is briefly off. Soon wins, because a service that does
   * not exist yet cannot be under maintenance.
   */
  const offState = (c: BillCategory): { off: boolean; tag: string } => {
    if (c.soon) return { off: true, tag: "Soon" };
    if (c.service && svc.paused(c.service)) return { off: true, tag: "Under maintenance" };
    return { off: false, tag: "" };
  };

  // ─── What you paid last ──────────────────────────────────
  useEffect(() => {
    getTransactions({ type: "AIRTIME", limit: 20 })
      .then((r) => {
        const seen = new Set<string>();
        const list: Recent[] = [];
        for (const t of r.transactions) {
          const meta: any = (t as any).metadata || {};
          const provider: string = meta.network || "";
          if (!provider) continue;
          // One row per provider per category: five MTN top-ups are one habit,
          // not five things to choose between.
          const key = `${meta.billType}:${provider}`;
          if (seen.has(key)) continue;
          const category = billCategory(meta.billType);
          if (category.soon) continue;
          seen.add(key);
          list.push({
            id: t.id,
            label: billLabel(meta.billType, provider),
            provider,
            logo: PROVIDER_LOGOS[provider.toUpperCase()],
            category,
          });
          if (list.length === 6) break;
        }
        cachedRecents = list;
        setRecents(list);
      })
      .catch(() => {});
  }, []);

  // ─── Search ──────────────────────────────────────────────
  /**
   * Matches the category name or any provider that sells it.
   *
   * The field says "search for a provider" because that is what people type.
   * "MTN" has to find Airtime and Data; "Eko" has to find Electricity.
   */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BILL_CATEGORIES;
    return BILL_CATEGORIES.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.keywords.some((k) => k.toLowerCase().includes(q)),
    );
  }, [query]);

  const open = (c: BillCategory) => {
    if (offState(c).off) return;
    router.push({ pathname: c.route, params: c.params } as any);
  };

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* Close rather than back: bills are a side trip from wherever you were,
          and an X says the whole errand ends here. */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[s.close, { backgroundColor: colors.muted }]}
          hitSlop={10}
        >
          <Feather name="x" size={19} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.foreground }]}>Pay a Bill</Text>
      </View>
      <View style={[s.rule, { backgroundColor: colors.border }]} />

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: bottomPad + 28 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.search, { backgroundColor: colors.card }]}>
          <Feather name="search" size={17} color={colors.mutedForeground} />
          <TextInput
            style={[s.searchInput, { color: colors.foreground }]}
            value={query}
            onChangeText={setQuery}
            placeholder="Search for a provider"
            placeholderTextColor={colors.mutedForeground}
            autoCorrect={false}
            returnKeyType="search"
          />
          {!!query && (
            <TouchableOpacity onPress={() => setQuery("")} hitSlop={10}>
              <Feather name="x-circle" size={17} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        {!query && recents.length > 0 && (
          <>
            <Text style={[s.sectionLabel, { color: colors.mutedForeground }]}>RECENT</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              // flexGrow:0: a horizontal scroller in a column stretches otherwise.
              style={s.recentBar}
              contentContainerStyle={s.recentRow}
            >
              {recents.map((r) => (
                <TouchableOpacity
                  key={r.id}
                  style={s.recent}
                  activeOpacity={0.75}
                  onPress={() => open(r.category)}
                >
                  <View style={[s.recentDisc, { backgroundColor: colors.card }]}>
                    {r.logo ? (
                      <Image source={r.logo} style={s.recentLogo} resizeMode="contain" />
                    ) : (
                      <Text style={[s.recentInitials, { color: colors.primary }]}>
                        {r.provider.slice(0, 3).toUpperCase()}
                      </Text>
                    )}
                  </View>
                  <Text style={[s.recentLabel, { color: colors.foreground }]} numberOfLines={1}>
                    {r.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        <Text style={[s.sectionLabel, { color: colors.mutedForeground }]}>
          {query ? "RESULTS" : "ALL CATEGORIES"}
        </Text>

        {shown.length === 0 ? (
          <View style={s.empty}>
            <Feather name="search" size={26} color={colors.mutedForeground} />
            <Text style={[s.emptyText, { color: colors.mutedForeground }]}>
              Nothing matches "{query.trim()}". We cover airtime, data, electricity, TV and betting.
            </Text>
          </View>
        ) : (
          <View style={s.grid}>
            {shown.map((c) => {
              const { off, tag } = offState(c);
              const maintenance = off && tag !== "Soon";

              return (
              <TouchableOpacity
                key={c.key}
                style={[s.card, { backgroundColor: colors.card }, off && s.cardSoon]}
                activeOpacity={off ? 1 : 0.8}
                disabled={off}
                onPress={() => open(c)}
              >
                {/* Oversized and clipped by the card, so it reads as texture
                    rather than as an icon that happens to be big. */}
                <View style={s.art} pointerEvents="none">
                  {c.art ? (
                    <Image
                      source={c.art}
                      style={[
                        s.artImg,
                        { tintColor: maintenance ? colors.warning : colors.primary },
                      ]}
                      resizeMode="contain"
                    />
                  ) : (
                    <Feather
                      name={c.icon!}
                      size={104}
                      color={maintenance ? colors.warning : colors.primary}
                    />
                  )}
                </View>

                <View style={s.cardHead}>
                  <Text
                    style={[
                      s.cardTitle,
                      { color: off ? colors.mutedForeground : colors.foreground },
                    ]}
                  >
                    {c.label}
                  </Text>
                  {off ? (
                    <View
                      style={[
                        s.soonTag,
                        {
                          borderColor: maintenance ? colors.warning + "55" : colors.border,
                          backgroundColor: maintenance ? colors.warning + "18" : "transparent",
                        },
                      ]}
                    >
                      <Text
                        style={[
                          s.soonText,
                          { color: maintenance ? colors.warning : colors.mutedForeground },
                        ]}
                        numberOfLines={1}
                      >
                        {tag}
                      </Text>
                    </View>
                  ) : (
                    <Feather name="chevron-right" size={17} color={colors.foreground} />
                  )}
                </View>
              </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const CARD_H = 152;

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingBottom: 14, paddingTop: 4 },
  close: { position: "absolute", left: 20, width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, lineHeight: 22, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },
  rule: { height: StyleSheet.hairlineWidth },

  content: { paddingHorizontal: 20, paddingTop: 18 },

  search: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, height: 46, borderRadius: 14 },
  searchInput: { flex: 1, fontSize: 14.5, lineHeight: 19, fontFamily: "Inter_400Regular", padding: 0 },

  sectionLabel: {
    fontSize: 10.5,
    lineHeight: 14,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.4,
    marginTop: 24,
    marginBottom: 12,
  },

  recentBar: { flexGrow: 0 },
  recentRow: { gap: 18, paddingRight: 20 },
  recent: { width: 64, alignItems: "center" },
  recentDisc: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  recentLogo: { width: 40, height: 40 },
  recentInitials: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  recentLabel: { fontSize: 11, lineHeight: 15, fontFamily: "Inter_500Medium", marginTop: 7, textAlign: "center" },

  // space-between sets the column gutter, so the pair always lands on the same
  // edges as the rest of the page. No flexGrow: an odd last card stays half
  // width instead of stretching across the row when a search returns three.
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 },
  card: {
    width: "48.5%",
    height: CARD_H,
    borderRadius: 20,
    padding: 16,
    overflow: "hidden",
  },
  art: { position: "absolute", right: -14, bottom: -18, opacity: 0.13 },
  artImg: { width: 104, height: 104 },
  // Dimmed, and the watermark goes with it - a full-strength mark under faded
  // text reads as a rendering fault rather than a disabled card.
  cardSoon: { opacity: 0.45 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  soonTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, flexShrink: 1 },
  soonText: { fontSize: 10.5, lineHeight: 14, fontFamily: "Inter_600SemiBold" },
  cardTitle: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },

  empty: { alignItems: "center", gap: 10, paddingVertical: 40, paddingHorizontal: 20 },
  emptyText: { fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_400Regular", textAlign: "center" },
});
