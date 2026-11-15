import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, ActivityIndicator, ScrollView } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { Keypad } from "@/components/Keypad";
import { TokenLogo } from "@/components/TokenLogo";
import { CardIllo } from "@/components/CardIllos";
import { CardFundSheet } from "@/components/CardFundSheet";
import { getCards, type CardKind } from "@/services/cards";

const LIME = "#81FB02";
type Coin = "USDC" | "USDT";

function Press({ style, children, ...rest }: React.ComponentProps<typeof Pressable> & { style?: any }) {
  return (
    <Pressable {...rest} style={({ pressed }) => [style, { transform: [{ scale: pressed ? 0.96 : 1 }], opacity: pressed ? 0.88 : 1 }]}>
      {children as any}
    </Pressable>
  );
}

/**
 * Top up: the person's own USDC or USDT on Solana goes to our card deposit
 * address through the normal send screen, and lands on the card as dollars
 * once the send is read back off the chain.
 */
export default function CardTopupScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { walletBalances } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  // Funding a new card: the card is made by itself once this lands, fee taken out of it.
  const params = useLocalSearchParams<{ kind?: string; name?: string; cardId?: string }>();
  // Topping up one card: its own balance, its own limit.
  const cardId = params.cardId ? String(params.cardId) : undefined;
  const newCard =
    params.name && (params.kind === "everyday" || params.kind === "one-time")
      ? { kind: params.kind as CardKind, name: String(params.name) }
      : null;

  const [coin, setCoin] = useState<Coin>("USDC");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [min, setMin] = useState(5);
  const [feeBps, setFeeBps] = useState(0);
  const [cardBalance, setCardBalance] = useState<number | null>(null);
  const [cardFee, setCardFee] = useState(0);
  const [cardName, setCardName] = useState("");
  const [maxBalance, setMaxBalance] = useState<number | null>(null);

  useEffect(() => {
    getCards()
      .then((d) => {
        if (d.minTopup) setMin(d.minTopup);
        setFeeBps(d.topupFeeBps || 0);
        setCardFee(d.cardFee || 0);
        setMaxBalance(d.maxCardBalance ?? null);
        // A new card starts empty: it gets its own account.
        if (newCard) setCardBalance(0);
        else {
          const c = (d.cards || []).find((x) => x.id === cardId) || (d.cards || [])[0];
          setCardBalance(c?.balance ?? null);
          setCardName(c?.name || "");
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const held = walletBalances.find((b) => b.asset === coin && b.chain === "SOL")?.balance ?? 0;
  // Funding a card is never charged the Solana send fee: that is only for sends out to a wallet.
  const sendFee = 0;
  const spendable = Math.max(0, held - sendFee);
  const value = Number(amount) || 0;
  const credit = Math.floor(value * 100 * (1 - feeBps / 10_000)) / 100;
  const tooMuch = value > spendable;
  // A new card needs the fee covered, by what's already there plus this top up.
  const short = newCard ? Math.max(0, Math.round((cardFee - (cardBalance ?? 0)) * 100) / 100) : 0;
  const notEnoughForCard = !!newCard && value > 0 && credit < short;
  const tooLittle = value > 0 && (value < min || notEnoughForCard);
  const startsWith = Math.max(0, Math.round(((cardBalance ?? 0) + credit - cardFee) * 100) / 100);
  // A card can only hold so much: what it would have after this top up.
  const after = newCard ? startsWith : (cardBalance ?? 0) + credit;
  const overLimit = maxBalance != null && value > 0 && after > maxBalance + 1e-9;
  const room = maxBalance != null ? Math.max(0, maxBalance - (newCard ? 0 : cardBalance ?? 0)) : null;
  const ok = value > 0 && !tooMuch && !tooLittle && !overLimit && !loading;

  const onKey = (k: string) => {
    setError("");
    setAmount((a) => {
      if (k === "." && a.includes(".")) return a;
      const next = a === "0" && k !== "." ? k : a + k;
      const [, dec] = next.split(".");
      if (dec && dec.length > 2) return a;
      if (Number(next) > 10_000) return a;
      return next === "." ? "0." : next;
    });
  };

  // The confirm step is a sheet over this screen, worded for the card; it does the send itself.
  const [sheet, setSheet] = useState(false);
  const go = () => {
    if (!ok) return;
    setError("");
    setSheet(true);
  };

  const [whole, cents] = (amount || "0").split(".");

  return (
    <View style={[s.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={s.header}>
        <Press onPress={() => router.back()} style={[s.round, { backgroundColor: colors.card }]} hitSlop={8}>
          <Ionicons name="chevron-back" size={20} color={colors.foreground} />
        </Press>
        <Text style={[s.title, { color: colors.foreground }]}>{newCard ? "Fund your new card" : "Top up card"}</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={{ paddingHorizontal: 20, flex: 1 }}>
        {/* Everything above the keypad scrolls, so a short Android screen never pushes the button off. */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
        {/* From and to, one panel. */}
        <View style={[s.panel, { backgroundColor: colors.card }]}>
          <View style={[s.leg, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
            <TokenLogo symbol={coin} size={38} dark />
            <View style={{ flex: 1 }}>
              <Text style={[s.legLabel, { color: colors.mutedForeground }]}>FROM</Text>
              <Text style={[s.legTitle, { color: colors.foreground }]}>{coin} on Solana</Text>
            </View>
            <View style={s.coins}>
              {(["USDC", "USDT"] as Coin[]).map((c) => (
                <Press
                  key={c}
                  onPress={() => {
                    setCoin(c);
                    Haptics.selectionAsync().catch(() => {});
                  }}
                  style={[s.coin, { backgroundColor: coin === c ? colors.foreground : "transparent" }]}
                >
                  <Text style={[s.coinText, { color: coin === c ? colors.background : colors.mutedForeground }]}>{c}</Text>
                </Press>
              ))}
            </View>
          </View>
          <View style={[s.arrow, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Ionicons name="arrow-down" size={14} color={colors.primary} />
          </View>
          <View style={s.leg}>
            <CardIllo name={newCard?.kind === "one-time" ? "oneTime" : "everyday"} size={38} />
            <View style={{ flex: 1 }}>
              <Text style={[s.legLabel, { color: colors.mutedForeground }]}>{newCard ? "NEW CARD" : "TO"}</Text>
              <Text style={[s.legTitle, { color: colors.foreground }]} numberOfLines={1}>
                {newCard ? newCard.name : cardName || "Your card"}
              </Text>
            </View>
            {!newCard || (cardBalance ?? 0) > 0 ? (
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[s.legLabel, { color: colors.mutedForeground }]}>Balance</Text>
                <Text style={[s.legValue, { color: colors.foreground }]}>
                  {cardBalance == null ? "…" : `$${cardBalance.toFixed(2)}`}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* The amount. */}
        <View style={s.amountWrap}>
          <View style={s.amountRow}>
            <Text style={[s.dollar, { color: colors.mutedForeground }]}>$</Text>
            <Text style={[s.amount, { color: colors.foreground }]}>{Number(whole).toLocaleString("en-US")}</Text>
            <Text style={[s.amount, { color: amount.includes(".") ? colors.foreground : colors.border }]}>
              .{(cents || "").padEnd(2, "0")}
            </Text>
          </View>
          <Text style={[s.sub, { color: tooMuch || tooLittle || overLimit || error ? colors.destructive : colors.mutedForeground }]}>
            {error
              ? error
              : tooMuch
                ? `You have ${spendable.toFixed(2)} ${coin} on Solana`
                : overLimit
                  ? `A card can hold up to $${maxBalance}${room != null && !newCard ? `. You can add about $${room.toFixed(2)}` : ""}`
                : notEnoughForCard
                  ? `Add at least $${short.toFixed(2)} to cover the card creation fee`
                  : tooLittle
                    ? `The smallest top up is $${min}`
                    : `${spendable.toFixed(2)} ${coin} available`}
          </Text>
        </View>

        <View style={[s.chips, { backgroundColor: colors.card }]}>
          {[10, 25, 50].map((n) => (
            <Press key={n} onPress={() => setAmount(String(n))} style={[s.chip, value === n && { backgroundColor: colors.foreground }]}>
              <Text style={[s.chipText, { color: value === n ? colors.background : colors.foreground }]}>${n}</Text>
            </Press>
          ))}
          <Press
            onPress={() => setAmount(String(Math.floor(spendable * 100) / 100))}
            style={[s.chip, value > 0 && value === Math.floor(spendable * 100) / 100 && { backgroundColor: colors.foreground }]}
          >
            <Text style={[s.chipText, { color: value > 0 && value === Math.floor(spendable * 100) / 100 ? colors.background : colors.foreground }]}>Max</Text>
          </Press>
        </View>

        {/* Every charge on its own line, so nothing comes off that wasn't shown. */}
        <View style={s.lines}>
          <Row label="You send" value={`${value.toFixed(2)} ${coin}`} colors={colors} />
          {sendFee > 0 && <Row label="Solana network fee" value={`${sendFee.toFixed(2)} ${coin}`} colors={colors} />}
          {sendFee > 0 && (
            <Row label="Total from your wallet" value={`${(value + sendFee).toFixed(2)} ${coin}`} colors={colors} strong />
          )}
          {feeBps > 0 && (
            <Row label={`Top up fee (${(feeBps / 100).toFixed(feeBps % 100 ? 2 : 0)}%)`} value={`−$${(value - credit).toFixed(2)}`} colors={colors} />
          )}
          {newCard && (cardBalance ?? 0) > 0 && (
            <Row label="Already on your card" value={`$${(cardBalance ?? 0).toFixed(2)}`} colors={colors} />
          )}
          {newCard && <Row label="Card creation fee" value={`−$${cardFee.toFixed(2)}`} colors={colors} />}
          <View style={[s.line, s.totalLine, { borderTopColor: colors.border }]}>
            <Text style={[s.lineLabel, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              {newCard ? "Your card starts with" : "Lands on your card"}
            </Text>
            <Text style={[s.lineValue, { color: colors.primary, fontFamily: "Inter_800ExtraBold" }]}>
              ${(newCard ? startsWith : credit).toFixed(2)}
            </Text>
          </View>
        </View>

        </ScrollView>

        <Keypad decimal onKey={onKey} onBackspace={() => setAmount((a) => a.slice(0, -1))} />

        <Press onPress={go} disabled={!ok} style={[s.cta, { marginBottom: insets.bottom + 12 }, !ok && { opacity: 0.45 }]}>
          {loading ? (
            <ActivityIndicator color="#0a0a0a" />
          ) : (
            <>
              <Text style={s.ctaText}>
                {newCard
                  ? value > 0
                    ? `Create card with $${value.toFixed(2)}`
                    : "Create card"
                  : value > 0
                    ? `Top up $${value.toFixed(2)}`
                    : "Top up"}
              </Text>
              <View style={s.ctaArrow}><Ionicons name="arrow-forward" size={18} color={LIME} /></View>
            </>
          )}
        </Press>
      <CardFundSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        onFinished={() => {
          setSheet(false);
          router.replace("/cards" as any);
        }}
        coin={coin}
        amount={value}
        sendFee={sendFee}
        credit={credit}
        newCard={newCard}
        cardId={cardId}
        cardFee={cardFee}
        startsWith={startsWith}
      />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 10 },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontFamily: "Inter_700Bold" },
  panel: { borderRadius: 20, marginTop: 8 },
  leg: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  legLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.6 },
  legTitle: { fontSize: 15, fontFamily: "Inter_700Bold", marginTop: 3 },
  legValue: { fontSize: 13.5, fontFamily: "Inter_600SemiBold", marginTop: 3 },
  coins: { flexDirection: "row", gap: 4 },
  coin: { paddingHorizontal: 10, height: 30, borderRadius: 15, justifyContent: "center" },
  coinText: { fontSize: 12.5, fontFamily: "Inter_700Bold" },
  arrow: { position: "absolute", left: "50%", top: 66, marginLeft: -15, marginTop: -15, width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: "center", justifyContent: "center", zIndex: 2 },
  miniCard: { width: 38, height: 26, borderRadius: 5, backgroundColor: "#1d1d1d", borderWidth: 1, borderColor: "#333", marginVertical: 6 },
  miniChip: { position: "absolute", left: 5, top: 8, width: 8, height: 7, borderRadius: 2, backgroundColor: "#d8b961" },
  miniMc: { position: "absolute", right: 4, bottom: 4, flexDirection: "row" },
  miniDot: { width: 7, height: 7, borderRadius: 4 },
  amountWrap: { alignItems: "center", paddingTop: 24, paddingBottom: 16, gap: 8 },
  amountRow: { flexDirection: "row", alignItems: "flex-start" },
  dollar: { fontSize: 28, fontFamily: "Inter_800ExtraBold", marginTop: 8, marginRight: 3 },
  amount: { fontSize: 56, lineHeight: 64, fontFamily: "Inter_800ExtraBold", letterSpacing: -2 },
  sub: { fontSize: 13, fontFamily: "Inter_500Medium" },
  chips: { flexDirection: "row", borderRadius: 16, padding: 4, gap: 4 },
  chip: { flex: 1, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 13.5, fontFamily: "Inter_600SemiBold" },
  lines: { gap: 9, marginTop: 16, paddingHorizontal: 4 },
  line: { flexDirection: "row", justifyContent: "space-between" },
  totalLine: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 2 },
  lineLabel: { fontSize: 13.5, fontFamily: "Inter_400Regular" },
  lineValue: { fontSize: 13.5, fontFamily: "Inter_600SemiBold" },
  cta: { height: 58, borderRadius: 29, backgroundColor: LIME, alignItems: "center", justifyContent: "center", marginTop: 10 },
  ctaText: { fontSize: 16, fontFamily: "Inter_800ExtraBold", color: "#0a0a0a" },
  ctaArrow: { position: "absolute", right: 6, top: 6, width: 46, height: 46, borderRadius: 23, backgroundColor: "#0a0a0a", alignItems: "center", justifyContent: "center" },
});

function Row({ label, value, colors, strong }: { label: string; value: string; colors: any; strong?: boolean }) {
  return (
    <View style={s.line}>
      <Text style={[s.lineLabel, { color: strong ? colors.foreground : colors.mutedForeground }]}>{label}</Text>
      <Text style={[s.lineValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}
