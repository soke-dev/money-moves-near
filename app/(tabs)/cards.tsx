import React, { useCallback, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  View, Text, StyleSheet, Pressable, ScrollView, Platform, ActivityIndicator,
  RefreshControl, Alert, useWindowDimensions, NativeSyntheticEvent, NativeScrollEvent, Modal, TextInput,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { CardFace } from "@/components/CardFace";
import { CardIllo } from "@/components/CardIllos";
import { CardReceipt } from "@/components/CardReceipt";
import { DragDownSheet } from "@/components/DragDownSheet";
import { CardWithdrawSheet } from "@/components/CardWithdrawSheet";
import {
  getCards, getCardActivity, setCardFrozen, deleteCard, renameCard,
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

/** A Recent row as a CARD transaction, so it opens in the same details screen. */
function activityTx(a: CardActivityItem, card: { id: string; name: string }) {
  const declined = a.status === "declined";
  const ev =
    declined ? "declined"
    : a.kind === "reversal" ? "refund"
    : a.kind === "created" ? "created"
    : a.kind === "withdraw" ? "toWallet"
    : a.kind === "topup" ? "topup"
    : "paid";
  // Card payments carry the issuer's id; our own rows already carry theirs.
  const reference = a.kind === "payment" || a.kind === "reversal" ? `card-${ev}-${a.id}` : `card-${a.id}`;
  return {
    type: "CARD",
    amount: a.amount,
    status: declined ? "FAILED" : a.status === "done" ? "COMPLETED" : "PROCESSING",
    createdAt: new Date(a.at).toISOString(),
    reference,
    metadata: { cardEvent: ev, cardId: card.id, cardName: card.name, merchant: a.kind === "payment" || a.kind === "reversal" ? a.merchant : null, place: a.place, note: a.note },
  };
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
  // Ice blue that reads on either theme: pale on dark, deeper on light.
  const frost = colors.background === "#0a0a0a" ? "#9fd4ff" : "#2F7BC0";
  const cards = data?.cards || [];
  const card = cards[Math.min(index, Math.max(0, cards.length - 1))];
  const cardWidth = width - 40;
  // The intro's card pictures: smaller, so the page fits a small phone.
  const introCard = Math.min(cardWidth - 64, 300);
  // Where the floating tab bar's top edge is (its own inset plus its 66pt height), plus a gap.
  const footerBottom = (insets.bottom > 0 ? insets.bottom - 6 : 16) + 66 + 10;

  /**
   * Each card's payments, kept between visits: what was there shows at once and
   * is quietly refreshed behind it, instead of a spinner every time the tab opens.
   * Only a card never seen before starts empty.
   */
  const activityCache = useRef<Record<string, CardActivityItem[]>>({});
  const loadActivity = useCallback(async (id?: string) => {
    if (!id) return setActivity(null);
    setActivity(activityCache.current[id] ?? null);
    try {
      const fresh = await getCardActivity(id);
      activityCache.current[id] = fresh;
      setActivity(fresh);
    } catch {
      if (!activityCache.current[id]) setActivity([]);
    }
  }, []);

  // Read through a ref so swiping between cards doesn't make a new `load`,
  // which re-ran the focus effect and fetched everything again on every swipe.
  const indexRef = useRef(index);
  indexRef.current = index;
  const load = useCallback(async () => {
    try {
      setError("");
      const d = await getCards();
      setData(d);
      const list = d.cards || [];
      if (list.length) loadActivity(list[Math.min(indexRef.current, list.length - 1)].id);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Couldn't load your cards.");
    }
  }, [loadActivity]);

  // While a top up or a new card is on its way, look again every 15 seconds.
  // A stuck card waits for a person, so it doesn't count: polling for it would never end.
  const waiting = (!!data?.pendingCard && !data.pendingCard.stuck) || (data?.topups || []).some((t) => t.status === "pending");
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

  const [withdrawOpen, setWithdrawOpen] = useState(false);

  // Hide the balance on the card (the eye beside BALANCE). Remembered between visits.
  const [hideBalance, setHideBalance] = useState(false);
  React.useEffect(() => {
    AsyncStorage.getItem("@cardBalanceHidden").then((v) => setHideBalance(v === "1")).catch(() => {});
  }, []);
  const toggleHide = () => {
    setHideBalance((h) => {
      AsyncStorage.setItem("@cardBalanceHidden", h ? "0" : "1").catch(() => {});
      return !h;
    });
    Haptics.selectionAsync().catch(() => {});
  };

  const confirmDelete = () => {
    if (!card) return;
    if ((card.balance ?? 0) > 0) {
      Alert.alert(
        "Withdraw the money first",
        `${card.name} still has ${money(card.balance ?? 0)} on it. Withdraw it to your wallet, then delete the card.`,
        [
          { text: "Not now", style: "cancel" },
          { text: "Withdraw to wallet", onPress: () => setWithdrawOpen(true) },
        ],
      );
      return;
    }
    Alert.alert(
      "Delete this card?",
      "It stops working straight away and can't be brought back.",
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

  /** The More sheet: everything else about a card, with Delete at the bottom. */
  const [moreOpen, setMoreOpen] = useState(false);
  // A Recent row opened: the same details screen as a card row on Home.
  const [openTx, setOpenTx] = useState<any>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");

  const saveName = async () => {
    const n = newName.trim();
    if (!card || !n || busy) return;
    setBusy("rename");
    try {
      await renameCard(card.id, n);
      setData((d) => d && { ...d, cards: d.cards?.map((c) => (c.id === card.id ? { ...c, name: n } : c)) });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setRenaming(false);
      setMoreOpen(false);
    } catch (e: any) {
      Alert.alert("Card", e?.response?.data?.error || "Couldn't rename the card. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const closeMore = () => {
    setMoreOpen(false);
    setRenaming(false);
  };

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
        <ActivityIndicator color={colors.primary} style={{ marginTop: 80 }} />
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
  // The card on screen: its own balance.
  const balance = card?.balance ?? null;
  const pendingCard = data?.pendingCard;

  /* ─── Asked for with a top up, not made yet ─── */
  if (!cards.length && pendingCard) {
    return (
      <View style={[s.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        {header}
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 110 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ alignItems: "center", marginTop: 18, opacity: 0.85 }}>
            <CardFace width={cardWidth} name={pendingCard.name} last4={null} holder={holder} oneTime={pendingCard.kind === "one-time"} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 24 }}>
            {!pendingCard.stuck && <ActivityIndicator color={colors.primary} />}
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
          // Room at the bottom for the pinned button and the tab bar under it.
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: footerBottom + (blocked ? 150 : 90) }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        >
          {/* Room above for the tilted card's raised corner, which the scroll view would otherwise clip. */}
          <View style={{ height: introCard * 0.86, marginTop: 22, alignItems: "center" }}>
            <View style={{ width: introCard + 24, flex: 1 }}>
              <View style={{ position: "absolute", left: 24, top: 4, transform: [{ rotate: "-7deg" }], opacity: 0.9 }}>
                <CardFace width={introCard} name="One-time" last4="7730" oneTime holder={holder} />
              </View>
              <View style={{ position: "absolute", left: 0, top: 26, transform: [{ rotate: "2.5deg" }] }}>
                <CardFace width={introCard} name="Everyday" last4={null} holder={holder} />
              </View>
            </View>
          </View>

          <Text style={[s.h1, { color: colors.foreground, fontSize: 23, lineHeight: 29 }]}>Spend your stablecoins anywhere cards work.</Text>

          <View style={[s.panel, { backgroundColor: colors.card, marginTop: 14 }]}>
            {([
              { icon: "wallet", title: "Top up from your wallet", sub: "USDC or USDT on Solana" },
              { icon: "freeze", title: "Freeze in one tap", sub: "Unfreeze whenever you're ready" },
              { icon: "oneTime", title: "One-time cards", sub: "Close after a single payment" },
            ] as const).map((f, i, all) => (
              <View key={f.title} style={[s.feature, { paddingVertical: 10 }, i < all.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
                <CardIllo name={f.icon} size={34} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.featureTitle, { color: colors.foreground }]}>{f.title}</Text>
                  <Text style={[s.featureSub, { color: colors.mutedForeground }]}>{f.sub}</Text>
                </View>
              </View>
            ))}
          </View>

          {pending.length > 0 && <PendingTopups rows={pending} colors={colors} />}
        </ScrollView>

        {/* Pinned just above the floating tab bar, so it's never under it on a small phone. */}
        <View style={[s.footer, { bottom: footerBottom, backgroundColor: colors.background }]}>
          {blocked ? (
            <LockedCta blocked={blocked} colors={colors} onAction={(path) => router.push(path as any)} />
          ) : (
            <Press onPress={() => router.push("/cards/create" as any)} style={[s.cta, { marginTop: 0 }]}>
              <Text style={s.ctaText}>Get your card</Text>
              <View style={s.ctaArrow}>
                <Ionicons name="arrow-forward" size={18} color={LIME} />
              </View>
            </Press>
          )}
        </View>
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
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
                balance={c.balance}
                hidden={hideBalance}
                onToggleHidden={toggleHide}
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

        {/* The card already shows its name and balance; only a state worth knowing gets a line. */}
        {(frozen || used) && (
        <View style={[s.balanceRow, { alignItems: "center", marginTop: 14 }]}>
          {frozen && (
            <View style={s.frozenPill}>
              <Ionicons name="snow" size={13} color={frost} />
              <Text style={[s.frozenPillText, { color: frost }]}>Frozen</Text>
            </View>
          )}
          {used && (
            <View style={[s.frozenPill, { backgroundColor: colors.card }]}>
              <Text style={[s.frozenPillText, { color: colors.mutedForeground }]}>Used</Text>
            </View>
          )}
        </View>
        )}

        <View style={s.actions}>
          {[
            { icon: "add", label: "Add money", primary: true, onPress: () => router.push({ pathname: "/cards/topup", params: { cardId: card!.id } } as any) },
            { icon: "eye-outline", label: "Details", onPress: () => router.push({ pathname: "/cards/details", params: { id: card!.id } } as any) },
            {
              icon: frozen ? "sunny-outline" : "snow-outline",
              label: frozen ? "Unfreeze" : "Freeze",
              onPress: toggleFreeze,
              loading: busy === "freeze",
              disabled: used,
            },
            { icon: "ellipsis-horizontal", label: "More", onPress: () => setMoreOpen(true), loading: busy === "delete" },
          ].map((a: { icon: string; label: string; onPress: () => void; primary?: boolean; loading?: boolean; disabled?: boolean; danger?: boolean }) => (
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
                  <Ionicons name={a.icon as any} size={22} color={a.primary ? "#0a0a0a" : a.danger ? colors.destructive : colors.foreground} />
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
              Top ups and payments with this card show here.
            </Text>
          ) : (
            activity.slice(0, 30).map((a, i, all) => {
              const declined = a.status === "declined";
              const held = a.status === "held";
              const look =
                declined ? { icon: "close-circle-outline", tint: colors.destructive, bg: "rgba(255,120,120,0.1)" }
                : a.kind === "topup" ? { icon: "arrow-down-circle-outline", tint: colors.primary, bg: "rgba(129,251,2,0.1)" }
                : a.kind === "created" ? { icon: "card-outline", tint: colors.foreground, bg: colors.secondary }
                : a.kind === "withdraw" ? { icon: "arrow-up-circle-outline", tint: colors.foreground, bg: colors.secondary }
                : a.direction === "in" ? { icon: "return-down-back-outline", tint: colors.primary, bg: "rgba(129,251,2,0.1)" }
                : { icon: "card-outline", tint: colors.foreground, bg: colors.secondary };
              const title = a.kind === "reversal" ? `Refund from ${a.merchant}` : a.merchant;
              // Line two: what happened, then the detail that explains it.
              const sub = declined
                ? `Declined${a.note ? ` · ${a.note}` : ""}`
                : held
                  ? "Needs a quick check"
                  : a.status === "pending"
                    ? a.kind === "topup" ? "On its way" : "Pending"
                    : `${when(a.at)}${a.note ? ` · ${a.note}` : a.place ? ` · ${a.place}` : ""}`;
              const showAmount = !(a.kind === "created" && a.amount === 0);
              return (
                <Pressable
                  key={a.id}
                  onPress={() => setOpenTx(activityTx(a, card!))}
                  style={({ pressed }) => [s.txRow, pressed && { opacity: 0.6 }, i < all.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
                >
                  <View style={[s.txIcon, { backgroundColor: look.bg }]}>
                    <Ionicons name={look.icon as any} size={19} color={look.tint} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.txTitle, { color: colors.foreground }]} numberOfLines={1}>
                      {title}
                    </Text>
                    <Text
                      style={[s.txSub, { color: declined ? colors.destructive : held ? "#f59e0b" : colors.mutedForeground }]}
                      numberOfLines={2}
                    >
                      {sub}
                    </Text>
                  </View>
                  {showAmount && (
                    <Text
                      style={[
                        s.txAmount,
                        { color: declined ? colors.mutedForeground : a.direction === "in" ? colors.primary : colors.foreground },
                        declined && { textDecorationLine: "line-through" },
                      ]}
                    >
                      {a.direction === "in" ? "+" : "−"}
                      {money(a.amount)}
                    </Text>
                  )}
                </Pressable>
              );
            })
          )}
        </View>
      </ScrollView>

      {card && (
        <CardWithdrawSheet
          visible={withdrawOpen}
          onClose={() => setWithdrawOpen(false)}
          onDone={() => {
            activityCache.current[card.id] = activityCache.current[card.id] || [];
            load();
          }}
          cardId={card.id}
          cardName={card.name}
          balance={card.balance ?? 0}
        />
      )}

      {/* One Recent row, in full: the card, what happened, its reference. */}
      <DragDownSheet visible={!!openTx} onClose={() => setOpenTx(null)} background={colors.background} handle={colors.border} bottomPad={insets.bottom + 14}>
        {openTx && <CardReceipt tx={openTx} />}
      </DragDownSheet>

      {/* More: the rest of what a card can do, Delete last and in red. */}
      <Modal visible={moreOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={closeMore}>
        <Pressable style={s.moreBackdrop} onPress={closeMore} />
        <View style={[s.moreSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 14 }]}>
          <View style={[s.moreHandle, { backgroundColor: colors.border }]} />
          <View style={s.moreHead}>
            <CardIllo name={card?.kind === "one-time" ? "oneTime" : "everyday"} size={36} />
            <View style={{ flex: 1 }}>
              <Text style={[s.moreTitle, { color: colors.foreground }]} numberOfLines={1}>{card?.name}</Text>
              <Text style={[s.moreSub, { color: colors.mutedForeground }]}>
                {card?.kind === "one-time" ? "One-time card" : "Everyday card"}
                {card?.last4 ? `  ·  ••••  ${card.last4}` : ""}
              </Text>
            </View>
          </View>

          {renaming ? (
            <View style={{ gap: 12 }}>
              <View style={[s.renameBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <TextInput
                  value={newName}
                  onChangeText={setNewName}
                  autoFocus
                  maxLength={40}
                  placeholder="e.g. Netflix, Shopping or Travel"
                  placeholderTextColor={colors.mutedForeground}
                  style={[s.renameInput, { color: colors.foreground }]}
                  onSubmitEditing={saveName}
                  returnKeyType="done"
                />
              </View>
              <Press onPress={saveName} disabled={!newName.trim() || busy === "rename"} style={[s.cta, { marginTop: 0 }, !newName.trim() && { opacity: 0.5 }]}>
                {busy === "rename" ? <ActivityIndicator color="#0a0a0a" /> : <Text style={s.ctaText}>Save name</Text>}
              </Press>
              <Press onPress={() => setRenaming(false)} style={{ alignItems: "center", paddingVertical: 10 }}>
                <Text style={[s.moreSub, { color: colors.mutedForeground }]}>Cancel</Text>
              </Press>
            </View>
          ) : (
            <View>
              {[
                { icon: "add-circle-outline", label: "Add money", onPress: () => { closeMore(); router.push({ pathname: "/cards/topup", params: { cardId: card!.id } } as any); } },
                { icon: "wallet-outline", label: "Withdraw to wallet", onPress: () => { closeMore(); setWithdrawOpen(true); } },
                { icon: "eye-outline", label: "Show card details", onPress: () => { closeMore(); router.push({ pathname: "/cards/details", params: { id: card!.id } } as any); } },
                { icon: "create-outline", label: "Rename card", onPress: () => { setNewName(card?.name || ""); setRenaming(true); } },
                ...(used
                  ? []
                  : [{ icon: frozen ? "sunny-outline" : "snow-outline", label: frozen ? "Unfreeze card" : "Freeze card", onPress: () => { closeMore(); toggleFreeze(); } }]),
                { icon: "trash-outline", label: "Delete card", danger: true, onPress: () => { closeMore(); confirmDelete(); } },
              ].map((o: { icon: string; label: string; onPress: () => void; danger?: boolean }, i, all) => (
                <Press
                  key={o.label}
                  onPress={o.onPress}
                  style={[s.moreRow, i < all.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
                >
                  <Ionicons name={o.icon as any} size={21} color={o.danger ? colors.destructive : colors.foreground} />
                  <Text style={[s.moreLabel, { color: o.danger ? colors.destructive : colors.foreground }]}>{o.label}</Text>
                  {!o.danger && <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />}
                </Press>
              ))}
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

function PendingTopups({ rows, colors }: { rows: NonNullable<CardsOverview["topups"]>; colors: any }) {
  return (
    <View style={[s.pending, { backgroundColor: colors.card }]}>
      {rows.map((t) => (
        <View key={t.id} style={s.pendingRow}>
          <Ionicons name={t.status === "held" ? "alert-circle-outline" : "time-outline"} size={18} color={t.status === "held" ? "#f59e0b" : colors.primary} />
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
    <View style={{ gap: 12 }}>
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
  moreBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  moreSheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10 },
  moreHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 16 },
  moreHead: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  moreTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  moreSub: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 2 },
  moreRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 16 },
  moreLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  renameBox: { height: 54, borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, justifyContent: "center" },
  renameInput: { fontSize: 15, fontFamily: "Inter_500Medium", height: "100%" },
  footer: { position: "absolute", left: 20, right: 20, paddingTop: 10 },
  lockedRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  lockedText: { flex: 1, fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_500Medium" },
  lockedBtn: { height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: LIME, justifyContent: "center" },
  lockedBtnText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#0a0a0a" },
});
