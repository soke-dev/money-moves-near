import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, Platform, ActivityIndicator,
  RefreshControl, Alert, useWindowDimensions, NativeSyntheticEvent, NativeScrollEvent,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { CardFace } from "@/components/CardFace";
import { CardIllo } from "@/components/CardIllos";
import {
  getCards, getCardActivity, setCardFrozen, deleteCard,
  type CardsOverview, type CardActivityItem,
} from "@/services/cards";

const LIME = "#81FB02";

/** A button that gives a little under the thumb. */
function Press({ style, children, ...rest }: React.ComponentProps<typeof Pressable> & { style?: any }) {
  return (
    <Pressable
      {...rest}
      style={({ pressed }) => [style, { transform: [{ scale: pressed ? 0.96 : 1 }], opacity: pressed ? 0.88 : 1 }]}
    >
      {children as any}
    </Pressable>
  );
}

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function when(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${time}`;
}

export default function CardsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [data, setData] = useState<CardsOverview | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [index, setIndex] = useState(0);
  const [activity, setActivity] = useState<CardActivityItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const holder = `${user?.firstName || ""} ${user?.lastName || ""}`.trim().toUpperCase();
  const cards = data?.cards || [];
  const card = cards[Math.min(index, Math.max(0, cards.length - 1))];
  const cardWidth = width - 40;

  const loadActivity = useCallback(async (id?: string) => {
    if (!id) return setActivity(null);
    setActivity(null);
    try {
      setActivity(await getCardActivity(id));
    } catch {
      setActivity([]);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      setError("");
      const d = await getCards();
      setData(d);
      const list = d.cards || [];
      if (list.length) loadActivity(list[Math.min(index, list.length - 1)].id);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Couldn't load your cards.");
    }
  }, [index, loadActivity]);

  // While a top up or a new card is on its way, look again every 15 seconds.
  const waiting = !!data?.pendingCard || (data?.topups || []).some((t) => t.status === "pending");
  const waitingRef = useRef(waiting);
  waitingRef.current = waiting;

  useFocusEffect(
    useCallback(() => {
      load();
      const every = setInterval(() => {
        if (waitingRef.current) load();
      }, 15_000);
      return () => clearInterval(every);
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const onPage = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / (cardWidth + 12));
    if (i !== index && cards[i]) {
      setIndex(i);
      Haptics.selectionAsync().catch(() => {});
      loadActivity(cards[i].id);
    }
  };

  const toggleFreeze = async () => {
    if (!card || busy) return;
    const freeze = card.status !== "blocked";
    setBusy("freeze");
    try {
      const { status } = await setCardFrozen(card.id, freeze);
      setData((d) => d && { ...d, cards: d.cards?.map((c) => (c.id === card.id ? { ...c, status } : c)) });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      Alert.alert("Card", e?.response?.data?.error || "That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = () => {
    if (!card) return;
    Alert.alert(
      "Delete this card?",
      "It stops working straight away and can't be brought back. Your card balance stays, ready for your next card.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setBusy("delete");
            try {
              await deleteCard(card.id);
              setIndex(0);
              await load();
            } catch (e: any) {
              Alert.alert("Card", e?.response?.data?.error || "Couldn't delete the card. Try again.");
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  const pending = useMemo(() => (data?.topups || []).filter((t) => t.status !== "done"), [data]);

  /* ─── Header ─── */
  const header = (
    <View style={s.header}>
      <Text style={[s.title, { color: colors.foreground }]}>Cards</Text>
      {cards.length ? (
        <Press onPress={() => router.push("/cards/create" as any)} style={[s.round, { backgroundColor: colors.card }]} hitSlop={8}>
          <Ionicons name="add" size={22} color={colors.foreground} />
        </Press>
      ) : (
        <View style={{ width: 40 }} />
      )}
    </View>
  );

  if (!data && !error) {
    return (
      <View style={[s.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        {header}
        <ActivityIndicator color={LIME} style={{ marginTop: 80 }} />
      </View>
    );
  }

  if (error && !data) {
    return (
      <View style={[s.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        {header}
        <View style={s.center}>
          <Ionicons name="cloud-offline-outline" size={34} color={colors.mutedForeground} />
          <Text style={[s.centerText, { color: colors.mutedForeground }]}>{error}</Text>
          <Press onPress={load} style={[s.ghostBtn, { borderColor: colors.border }]}>
            <Text style={[s.ghostText, { color: colors.foreground }]}>Try again</Text>
          </Press>
        </View>
      </View>
    );
  }

  if (data && !data.enabled) {
    return (
      <View style={[s.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        {header}
        <View style={s.center}>
          <Ionicons name="card-outline" size={36} color={colors.mutedForeground} />
          <Text style={[s.centerTitle, { color: colors.foreground }]}>Cards are opening soon</Text>
          <Text style={[s.centerText, { color: colors.mutedForeground }]}>
            USD cards you top up with stablecoins. We'll let you know the moment they open.
          </Text>
        </View>
      </View>
    );
  }

  const blocked = data?.blocked;
  const balance = data?.balance;
  const pendingCard = data?.pendingCard;

  /* ─── Asked for with a top up, not made yet ─── */
  if (!cards.length && pendingCard) {
    return (
      <View style={[s.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        {header}
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 110 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={LIME} />}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ alignItems: "center", marginTop: 18, opacity: 0.85 }}>
            <CardFace width={cardWidth} name={pendingCard.name} last4={null} holder={holder} oneTime={pendingCard.kind === "one-time"} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 24 }}>
            {!pendingCard.stuck && <ActivityIndicator color={LIME} />}
            <Text style={[s.h1, { color: colors.foreground, fontSize: 24, lineHeight: 30, marginTop: 0, flex: 1 }]}>
              {pendingCard.stuck ? "Your card needs a quick check" : "Your card is being made"}
            </Text>
          </View>
          <Text style={[s.centerText, { color: colors.mutedForeground, textAlign: "left", marginTop: 8 }]}>
            {pendingCard.stuck
              ? "We're finishing it on our side and will let you know when it's ready."
              : `${pendingCard.name} will be ready as soon as your top up lands, usually within a couple of minutes. We'll let you know.`}
          </Text>
          {pending.length > 0 && <PendingTopups rows={pending} colors={colors} />}
        </ScrollView>
      </View>
    );
  }

  /* ─── No card yet ─── */
  if (!cards.length) {
    return (
      <View style={[s.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        {header}
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 110 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={LIME} />}
          showsVerticalScrollIndicator={false}
        >
          {/* Room above for the tilted card's raised corner, which the scroll view would otherwise clip. */}
          <View style={{ height: cardWidth * 0.78, marginTop: 30 }}>
            <View style={{ position: "absolute", left: 24, top: 6, transform: [{ rotate: "-7deg" }], opacity: 0.9 }}>
              <CardFace width={cardWidth - 24} name="One-time" last4="7730" oneTime holder={holder} />
            </View>
            <View style={{ position: "absolute", left: 0, top: 36, transform: [{ rotate: "2.5deg" }] }}>
              <CardFace width={cardWidth - 24} name="Everyday" last4={null} holder={holder} />
            </View>
          </View>

          <Text style={[s.h1, { color: colors.foreground }]}>Spend your stablecoins anywhere cards work.</Text>

          <View style={[s.panel, { backgroundColor: colors.card, marginTop: 18 }]}>
            {([
              { icon: "wallet", title: "Top up from your wallet", sub: "USDC or USDT on Solana" },
              { icon: "freeze", title: "Freeze in one tap", sub: "Unfreeze whenever you're ready" },
              { icon: "oneTime", title: "One-time cards", sub: "Close after a single payment" },
            ] as const).map((f, i, all) => (
              <View key={f.title} style={[s.feature, i < all.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
                <CardIllo name={f.icon} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.featureTitle, { color: colors.foreground }]}>{f.title}</Text>
                  <Text style={[s.featureSub, { color: colors.mutedForeground }]}>{f.sub}</Text>
                </View>
              </View>
            ))}
          </View>

          {!!balance && balance > 0 && (
            <Text style={[s.note, { color: colors.mutedForeground }]}>Card balance {money(balance)}, ready for your card.</Text>
          )}
          {pending.length > 0 && <PendingTopups rows={pending} colors={colors} />}

          {blocked ? (
            <LockedCta blocked={blocked} colors={colors} onAction={(path) => router.push(path as any)} />
          ) : (
            <Press onPress={() => router.push("/cards/create" as any)} style={s.cta}>
              <Text style={s.ctaText}>Get your card</Text>
              <View style={s.ctaArrow}>
                <Ionicons name="arrow-forward" size={18} color={LIME} />
              </View>
            </Press>
          )}
        </ScrollView>
      </View>
    );
  }

  /* ─── Cards ─── */
  const frozen = card?.status === "blocked";
  const used = card?.status === "deactivated";

  return (
    <View style={[s.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {header}
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={LIME} />}
        showsVerticalScrollIndicator={false}
      >
        <ScrollView
          horizontal
          decelerationRate="fast"
          snapToInterval={cardWidth + 12}
          snapToAlignment="start"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
          onMomentumScrollEnd={onPage}
        >
          {cards.map((c) => (
            <Press key={c.id} onPress={() => router.push({ pathname: "/cards/details", params: { id: c.id } } as any)}>
              <CardFace
                width={cardWidth}
                name={c.name}
                last4={c.last4}
                holder={holder}
                oneTime={c.kind === "one-time"}
                frozen={c.status === "blocked"}
              />
            </Press>
          ))}
        </ScrollView>

        {cards.length > 1 && (
          <View style={s.dots}>
            {cards.map((c, i) => (
              <View key={c.id} style={[s.dot, { backgroundColor: i === index ? colors.foreground : colors.border, width: i === index ? 18 : 6 }]} />
            ))}
          </View>
        )}

        <View style={s.balanceRow}>
          <View>
            <Text style={[s.balanceLabel, { color: colors.mutedForeground }]}>
              {card?.name} · card balance
            </Text>
            <Text style={[s.balance, { color: colors.foreground }]}>
              {balance == null ? "Not available" : money(balance)}
            </Text>
          </View>
          {frozen && (
            <View style={s.frozenPill}>
              <Ionicons name="snow" size={13} color="#9fd4ff" />
              <Text style={s.frozenPillText}>Frozen</Text>
            </View>
          )}
          {used && (
            <View style={[s.frozenPill, { backgroundColor: colors.card }]}>
              <Text style={[s.frozenPillText, { color: colors.mutedForeground }]}>Used</Text>
            </View>
          )}
        </View>

        <View style={s.actions}>
          {[
            { icon: "add", label: "Top up", primary: true, onPress: () => router.push("/cards/topup" as any) },
            { icon: "eye-outline", label: "Details", onPress: () => router.push({ pathname: "/cards/details", params: { id: card!.id } } as any) },
            {
              icon: frozen ? "sunny-outline" : "snow-outline",
              label: frozen ? "Unfreeze" : "Freeze",
              onPress: toggleFreeze,
              loading: busy === "freeze",
              disabled: used,
            },
            { icon: "trash-outline", label: "Delete", onPress: confirmDelete, loading: busy === "delete", danger: true },
          ].map((a) => (
            <Press key={a.label} onPress={a.onPress} disabled={!!busy || a.disabled} style={[s.action, a.disabled && { opacity: 0.4 }]}>
              <View
                style={[
                  s.actionCircle,
                  a.primary ? { backgroundColor: LIME } : { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
                ]}
              >
                {a.loading ? (
                  <ActivityIndicator size="small" color={a.primary ? "#0a0a0a" : colors.foreground} />
                ) : (
                  <Ionicons name={a.icon as any} size={22} color={a.primary ? "#0a0a0a" : a.danger ? "#ff8a8a" : colors.foreground} />
                )}
              </View>
              <Text style={[s.actionLabel, { color: colors.foreground }]}>{a.label}</Text>
            </Press>
          ))}
        </View>

        {pending.length > 0 && (
          <View style={{ paddingHorizontal: 20 }}>
            <PendingTopups rows={pending} colors={colors} />
          </View>
        )}

        <View style={[s.panel, { backgroundColor: colors.card, marginHorizontal: 20, marginTop: 18 }]}>
          <Text style={[s.panelTitle, { color: colors.foreground }]}>Recent</Text>
          {activity === null ? (
            <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 22 }} />
          ) : activity.length === 0 ? (
            <Text style={[s.empty, { color: colors.mutedForeground }]}>
              Payments made with this card show here.
            </Text>
          ) : (
            activity.slice(0, 20).map((a, i, all) => (
              <View key={a.id} style={[s.txRow, i < all.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
                <View style={[s.txIcon, { backgroundColor: a.status === "declined" ? "rgba(255,120,120,0.1)" : a.direction === "in" ? "rgba(129,251,2,0.1)" : colors.secondary }]}>
                  <Ionicons
                    name={a.status === "declined" ? "close-circle-outline" : a.direction === "in" ? "return-down-back-outline" : "bag-handle-outline"}
                    size={19}
                    color={a.status === "declined" ? "#ff8a8a" : a.direction === "in" ? LIME : colors.foreground}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.txTitle, { color: colors.foreground }]} numberOfLines={1}>
                    {a.kind === "reversal" ? `Refund from ${a.merchant}` : a.merchant}
                  </Text>
                  <Text style={[s.txSub, { color: a.status === "declined" ? "#ff9a9a" : colors.mutedForeground }]} numberOfLines={1}>
                    {a.status === "declined" ? "Declined" : a.status === "pending" ? "Pending" : when(a.at)}
                    {a.place ? ` · ${a.place}` : ""}
                  </Text>
                </View>
                <Text
                  style={[
                    s.txAmount,
                    { color: a.status === "declined" ? colors.mutedForeground : a.direction === "in" ? LIME : colors.foreground },
                    a.status === "declined" && { textDecorationLine: "line-through" },
                  ]}
                >
                  {a.direction === "in" ? "+" : "−"}
                  {money(a.amount)}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function PendingTopups({ rows, colors }: { rows: NonNullable<CardsOverview["topups"]>; colors: any }) {
  return (
    <View style={[s.pending, { backgroundColor: colors.card }]}>
      {rows.map((t) => (
        <View key={t.id} style={s.pendingRow}>
          <Ionicons name={t.status === "held" ? "alert-circle-outline" : "time-outline"} size={18} color={t.status === "held" ? "#f59e0b" : LIME} />
          <Text style={[s.pendingText, { color: colors.foreground }]}>
            {t.status === "held"
              ? `Your ${money(t.credit)} top up needs a check. We'll sort it and let you know.`
              : `${money(t.credit)} top up on its way to your card.`}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * "Get your card", locked, with what unlocks it underneath. For an account
 * that isn't verified (or has no phone number) the button and the line both
 * lead there; anything else just says why.
 */
function LockedCta({
  blocked,
  colors,
  onAction,
}: {
  blocked: NonNullable<CardsOverview["blocked"]>;
  colors: any;
  onAction: (path: string) => void;
}) {
  const unlock =
    blocked.code === "KYC"
      ? { line: "Verify your identity to unlock cards. It takes about two minutes.", label: "Verify now", path: "/account/kyc" }
      : blocked.code === "PHONE"
        ? { line: "Add your phone number to unlock cards.", label: "Add phone number", path: "/account/edit-phone" }
        : null;
  return (
    <View style={{ marginTop: 24, gap: 14 }}>
      <Press
        onPress={() => unlock && onAction(unlock.path)}
        disabled={!unlock}
        style={[s.cta, { marginTop: 0, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Ionicons name="lock-closed" size={16} color={colors.mutedForeground} />
          <Text style={[s.ctaText, { color: colors.mutedForeground }]}>Get your card</Text>
        </View>
      </Press>
      <View style={s.lockedRow}>
        <CardIllo name="lock" size={30} />
        <Text style={[s.lockedText, { color: colors.foreground }]}>{unlock ? unlock.line : blocked.error}</Text>
        {unlock && (
          <Press onPress={() => onAction(unlock.path)} style={s.lockedBtn}>
            <Text style={s.lockedBtnText}>{unlock.label}</Text>
          </Press>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 10 },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 26, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.6 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 36, gap: 12, paddingBottom: 80 },
  centerTitle: { fontSize: 19, fontFamily: "Inter_700Bold", textAlign: "center" },
  centerText: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular", textAlign: "center" },
  ghostBtn: { borderWidth: 1, borderRadius: 22, paddingHorizontal: 18, height: 44, justifyContent: "center", marginTop: 6 },
  ghostText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  h1: { fontSize: 28, lineHeight: 34, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.8, marginTop: 6 },
  panel: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 4 },
  panelTitle: { fontSize: 15, fontFamily: "Inter_700Bold", paddingTop: 12, paddingBottom: 4 },
  feature: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 13 },
  featureIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: "rgba(129,251,2,0.1)", alignItems: "center", justifyContent: "center" },
  featureTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  featureSub: { fontSize: 12.5, fontFamily: "Inter_400Regular", marginTop: 2 },
  note: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 16, textAlign: "center" },
  cta: { height: 58, borderRadius: 29, backgroundColor: LIME, alignItems: "center", justifyContent: "center", marginTop: 24 },
  ctaText: { fontSize: 16, fontFamily: "Inter_800ExtraBold", color: "#0a0a0a", letterSpacing: -0.2 },
  ctaArrow: { position: "absolute", right: 6, top: 6, width: 46, height: 46, borderRadius: 23, backgroundColor: "#0a0a0a", alignItems: "center", justifyContent: "center" },
  feeRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14 },
  feeText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 12 },
  dot: { height: 5, borderRadius: 3 },
  balanceRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 20, marginTop: 18 },
  balanceLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  balance: { fontSize: 34, lineHeight: 40, fontFamily: "Inter_800ExtraBold", letterSpacing: -1, marginTop: 2 },
  frozenPill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(124,196,255,0.12)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 6 },
  frozenPillText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#9fd4ff" },
  actions: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 28, marginTop: 22 },
  action: { alignItems: "center", gap: 8, width: 70 },
  actionCircle: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  actionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  pending: { borderRadius: 16, padding: 14, gap: 10, marginTop: 18 },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  pendingText: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium" },
  empty: { fontSize: 13, fontFamily: "Inter_400Regular", paddingVertical: 18 },
  txRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11 },
  txIcon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  txTitle: { fontSize: 14.5, fontFamily: "Inter_600SemiBold" },
  txSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  txAmount: { fontSize: 14.5, fontFamily: "Inter_600SemiBold" },
  lockedRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  lockedText: { flex: 1, fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_500Medium" },
  lockedBtn: { height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: LIME, justifyContent: "center" },
  lockedBtnText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#0a0a0a" },
});
