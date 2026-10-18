import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { ts, assetLabel, fmtAsset, spendableBalance, CHAIN_MARKS, TOKEN_NETWORKS, type TokenSymbol } from "@/constants/transfer";
import { TokenLogo } from "@/components/TokenLogo";
import {
  claimBusinessPayment,
  declineBusinessPayment,
  getBusinessPayment,
  getBusinessPayments,
  holdBusinessPayCode,
  type BusinessPayment,
} from "@/services/business-payments";

/** Two letters for a business with no picture - the legal suffix says nothing about who it is. */
function initials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z0-9]+/, ""))
    .filter((w) => w && !/^(ltd|limited|plc|llc|inc|co|nig)\.?$/i.test(w));
  return (words.length ? words : [name]).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("") || "?";
}

const chainName = (tag: string) =>
  Object.values(TOKEN_NETWORKS).flat().find((n) => n.tag === tag)?.name ?? tag;

/** Minutes and seconds left, ticking - the chip at the top. */
function useClock(iso: string | undefined): string | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!iso) return null;
  const s = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type Source = { chain: string; asset: string; address: string; balance: number; enough: boolean };

/**
 * A business's checkout, paid from this account.
 *
 * Reached by scanning the checkout's code or tapping its link. The business
 * leads - its logo, its name, what the order is - then one large amount and
 * the one balance it'll be paid from, picked for you and changeable from a
 * sheet. "Pay" goes straight to the PIN; the server holds that send to exactly
 * this amount and the business's own address, and the screen says so.
 */
export default function BusinessPayScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { walletBalances, refreshBalances, isReady, isLoggedIn, unlocked } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  // An id from the request on Home; a code from a checkout's link or QR.
  const { id, code } = useLocalSearchParams<{ id?: string; code?: string }>();
  const [payment, setPayment] = useState<BusinessPayment | null>(null);
  const [problem, setProblem] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const clock = useClock(payment?.expiresAt);

  useEffect(() => {
    if (!isReady) return;
    /**
     * A checkout link can open the app straight onto this screen, ahead of the
     * PIN. A payment is never shown to whoever is holding a locked phone: the
     * code waits while they sign in or unlock, and Home brings them back here.
     */
    if (code && (!isLoggedIn || (Platform.OS !== "web" && !unlocked))) {
      holdBusinessPayCode(String(code));
      router.replace("/");
      return;
    }
    refreshBalances(true);
    (code
      ? claimBusinessPayment(String(code))
      : id
        ? getBusinessPayment(String(id))
        : getBusinessPayments().then((all) => all[0] ?? null)
    )
      .then((p) => (p ? setPayment(p) : setProblem("Nothing is waiting to be paid.")))
      .catch((e) => setProblem(e?.response?.data?.error || "We couldn't load this payment. Try again in a moment."));
  }, [id, code, isReady, isLoggedIn, unlocked]);

  const amount = Number(payment?.amount ?? 0);

  // What this account holds of the coins and networks the business takes - empty ones left out.
  // Enough first, then the most held.
  const sources: Source[] = useMemo(() => {
    if (!payment) return [];
    const out: Source[] = [];
    for (const p of payment.pay) {
      for (const asset of p.assets) {
        const held = walletBalances.find((b) => b.asset === asset && b.chain === p.chain)?.balance ?? 0;
        const balance = spendableBalance(p.chain, held);
        if (balance > 0) out.push({ chain: p.chain, asset, address: p.address, balance, enough: balance >= amount });
      }
    }
    return out.sort((a, b) => Number(b.enough) - Number(a.enough) || b.balance - a.balance);
  }, [payment, walletBalances, amount]);

  const keyOf = (s: Source) => `${s.asset}:${s.chain}`;
  useEffect(() => {
    if (!picked && sources[0]?.enough) setPicked(keyOf(sources[0]));
  }, [sources, picked]);

  const chosen = sources.find((s) => keyOf(s) === picked && s.enough) ?? null;
  const open = payment?.status === "PENDING";
  const canPay = open && !!chosen;
  const noneEnough = open && !sources.some((s) => s.enough);

  const pay = () => {
    if (!payment || !chosen) return;
    router.push({
      pathname: "/withdraw-summary",
      params: {
        token: chosen.asset,
        label: assetLabel(chosen.asset),
        network: chosen.chain,
        networkName: chainName(chosen.chain),
        address: chosen.address,
        amount: payment.amount,
        payRequestId: payment.id,
        payee: payment.businessName,
        payRef: payment.reference ?? "",
        // This screen was the review: straight to the PIN.
        direct: "1",
      },
    } as any);
  };

  const decline = async () => {
    if (!payment) return;
    setDeclining(true);
    try {
      await declineBusinessPayment(payment.id);
    } catch {
      // Closed or answered already - either way there's nothing left to do here.
    }
    router.back();
  };

  const closedWords: Record<string, string> = {
    PAID: "Paid. The business has it.",
    PAYING: "This payment is on its way.",
    DECLINED: "You declined this payment.",
    CANCELLED: "The business closed this payment.",
    EXPIRED: "This payment closed. Ask the business for a fresh one.",
  };

  const tokenMark = (s: Source, size = 30) => (
    <View style={{ width: size, height: size }}>
      <TokenLogo symbol={assetLabel(s.asset) as TokenSymbol} size={size} />
      {!!CHAIN_MARKS[s.chain] && (
        <Image source={CHAIN_MARKS[s.chain]} style={[st.chainMark, { borderColor: colors.card, width: size * 0.5, height: size * 0.5, borderRadius: size * 0.25 }]} />
      )}
    </View>
  );

  return (
    <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={st.top}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={[st.round, { backgroundColor: colors.muted }]} accessibilityLabel="Close">
          <Feather name="x" size={18} color={colors.foreground} />
        </TouchableOpacity>
        {open && clock && (
          <View style={[st.closes, { backgroundColor: colors.muted }]}>
            <View style={[st.closesDot, { backgroundColor: colors.primary }]} />
            <Text style={[st.closesText, { color: colors.mutedForeground }]}>
              Closes in <Text style={{ color: colors.foreground }}>{clock}</Text>
            </Text>
          </View>
        )}
      </View>

      {!payment ? (
        <View style={st.center}>
          {problem ? (
            <Text style={[st.problem, { color: colors.mutedForeground, textAlign: "center" }]}>{problem}</Text>
          ) : (
            <ActivityIndicator color={colors.primary} />
          )}
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
            {/* Who is asking. */}
            <View style={st.who}>
              {payment.businessLogo && !logoFailed ? (
                <Image source={{ uri: payment.businessLogo }} onError={() => setLogoFailed(true)} style={[st.mark, { backgroundColor: "#fff" }]} resizeMode="contain" />
              ) : (
                <View style={[st.mark, { backgroundColor: colors.foreground }]}>
                  <Text style={[st.markText, { color: colors.background }]}>{initials(payment.businessName)}</Text>
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={st.nameRow}>
                  <Text style={[st.name, { color: colors.foreground }]} numberOfLines={1}>
                    {payment.businessName}
                  </Text>
                  <View style={[st.tick, { backgroundColor: colors.primary }]}>
                    <Feather name="check" size={10} color={colors.primaryForeground} />
                  </View>
                </View>
                <Text style={[st.sub, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {payment.title || "Verified business"}
                </Text>
              </View>
            </View>

            {/* How much - one figure, large. */}
            <Text style={[st.big, { color: colors.foreground }]}>
              <Text style={[st.bigSign, { color: colors.mutedForeground }]}>$</Text>
              {fmtAsset(amount)}
            </Text>
            {!!payment.priceLabel && <Text style={[st.bigSub, { color: colors.mutedForeground }]}>Priced at {payment.priceLabel}</Text>}

            {open ? (
              <>
                <View style={[st.float, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {chosen ? (
                    <View style={st.fromRow}>
                      {tokenMark(chosen)}
                      <View style={{ flex: 1 }}>
                        <Text style={[st.rowTitle, { color: colors.foreground }]}>
                          {assetLabel(chosen.asset)} on {chainName(chosen.chain)}
                        </Text>
                        <Text style={[st.rowSub, { color: colors.mutedForeground }]}>{fmtAsset(chosen.balance)} available</Text>
                      </View>
                      {sources.filter((s) => s.enough).length > 1 && (
                        <TouchableOpacity onPress={() => setChoosing(true)} hitSlop={10}>
                          <Text style={[st.change, { color: colors.primary }]}>Change</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ) : (
                    <View style={st.fromRow}>
                      <View style={[st.emptyMark, { backgroundColor: colors.muted }]}>
                        <Feather name="credit-card" size={14} color={colors.mutedForeground} />
                      </View>
                      <Text style={[st.rowSub, { color: colors.mutedForeground, flex: 1 }]}>
                        You don't have ${fmtAsset(amount)} of USDC or USDT on a network {payment.businessName} takes.
                      </Text>
                    </View>
                  )}
                  <View style={[st.line, { borderTopColor: colors.border }]}>
                    <Text style={[st.lineLabel, { color: colors.mutedForeground }]}>Network fee</Text>
                    <Text style={[st.lineValue, { color: colors.primary }]}>Free</Text>
                  </View>
                  {!!payment.reference && (
                    <View style={[st.line, { borderTopColor: colors.border }]}>
                      <Text style={[st.lineLabel, { color: colors.mutedForeground }]}>Reference</Text>
                      <Text style={[st.lineValue, st.mono, { color: colors.foreground }]}>{payment.reference}</Text>
                    </View>
                  )}
                </View>
                <View style={st.lock}>
                  <Feather name="lock" size={13} color={colors.mutedForeground} style={{ marginTop: 1 }} />
                  <Text style={[st.lockText, { color: colors.mutedForeground }]}>
                    The amount and {payment.businessName}'s address are locked to this payment. Nothing else can be sent.
                  </Text>
                </View>
              </>
            ) : (
              <Text style={[st.closed, { color: colors.foreground }]}>{closedWords[payment.status] ?? "This payment isn't waiting any more."}</Text>
            )}
          </ScrollView>

          <View style={[st.cta, { paddingBottom: bottomPad + 14, backgroundColor: colors.background }]}>
            {open ? (
              <>
                {noneEnough ? (
                  <TouchableOpacity style={[st.btn, { backgroundColor: colors.primary }]} onPress={() => router.push("/deposit" as any)} activeOpacity={0.85}>
                    <Text style={[st.btnText, { color: colors.primaryForeground }]}>Add money</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[st.btn, { backgroundColor: colors.primary, opacity: canPay ? 1 : 0.6 }]} onPress={pay} disabled={!canPay} activeOpacity={0.85}>
                    <Text style={[st.btnText, { color: colors.primaryForeground }]}>Pay ${fmtAsset(amount)}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => void decline()} disabled={declining} style={st.ghost} activeOpacity={0.7}>
                  {declining ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <Text style={[st.ghostText, { color: colors.mutedForeground }]}>Decline</Text>}
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={[st.btn, { backgroundColor: colors.primary }]} onPress={() => router.replace("/(tabs)")} activeOpacity={0.85}>
                <Text style={[st.btnText, { color: colors.primaryForeground }]}>Done</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Where it's paid from - every balance the business takes, the short ones dimmed. */}
          <Modal transparent animationType="slide" visible={choosing} onRequestClose={() => setChoosing(false)}>
            <TouchableOpacity style={st.dim} activeOpacity={1} onPress={() => setChoosing(false)}>
              <View
                style={[st.sheet, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: bottomPad + 8 }]}
                onStartShouldSetResponder={() => true}
                {...(Platform.OS === "web" ? { onClick: (e: any) => e.stopPropagation() } : {})}
              >
                <View style={[st.grab, { backgroundColor: colors.border }]} />
                <Text style={[st.sheetTitle, { color: colors.foreground }]}>Pay from</Text>
                <Text style={[st.sheetSub, { color: colors.mutedForeground }]}>{payment.businessName} takes USDC and USDT on these networks.</Text>
                {sources.map((s, i) => {
                  const on = keyOf(s) === picked && s.enough;
                  return (
                    <TouchableOpacity
                      key={keyOf(s)}
                      disabled={!s.enough}
                      onPress={() => {
                        setPicked(keyOf(s));
                        setChoosing(false);
                      }}
                      activeOpacity={0.75}
                      style={[st.opt, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, !s.enough && { opacity: 0.4 }]}
                    >
                      {tokenMark(s, 32)}
                      <View style={{ flex: 1 }}>
                        <Text style={[st.rowTitle, { color: colors.foreground }]}>
                          {assetLabel(s.asset)} on {chainName(s.chain)}
                        </Text>
                        <Text style={[st.rowSub, { color: colors.mutedForeground }]}>{s.enough ? `${fmtAsset(s.balance)} available` : `Only ${fmtAsset(s.balance)} here`}</Text>
                      </View>
                      <View style={[st.radio, { borderColor: on ? colors.primary : colors.border }]}>{on && <View style={[st.radioDot, { backgroundColor: colors.primary }]} />}</View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </TouchableOpacity>
          </Modal>
        </>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingTop: 8 },
  round: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  closes: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999 },
  closesDot: { width: 6, height: 6, borderRadius: 3 },
  closesText: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  who: { flexDirection: "row", alignItems: "center", gap: 12 },
  // The business's own picture, or its initials - solid, the way a logo would be.
  mark: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  markText: { fontSize: 16, lineHeight: 20, fontFamily: "Inter_700Bold", letterSpacing: 0.3 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  tick: { width: 15, height: 15, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  sub: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 1 },
  big: { fontSize: 56, lineHeight: 62, fontFamily: "Inter_700Bold", letterSpacing: -2.4, marginTop: 28, fontVariant: ["tabular-nums"] },
  bigSign: { fontSize: 28, fontFamily: "Inter_600SemiBold", letterSpacing: -0.5 },
  bigSub: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 4 },
  float: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, marginTop: 24 },
  fromRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  emptyMark: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  chainMark: { position: "absolute", right: -4, bottom: -4, borderWidth: 2 },
  rowTitle: { fontSize: 14.5, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
  rowSub: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 1 },
  change: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  line: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth },
  lineLabel: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  lineValue: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  mono: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12 },
  lock: { flexDirection: "row", gap: 8, marginTop: 14, paddingHorizontal: 4 },
  lockText: { flex: 1, fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  problem: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular", marginTop: 14, marginHorizontal: 4 },
  closed: { fontSize: 15, lineHeight: 22, fontFamily: "Inter_500Medium", marginTop: 28 },
  cta: { paddingHorizontal: 20, paddingTop: 10 },
  btn: { height: 54, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_700Bold" },
  ghost: { alignItems: "center", justifyContent: "center", height: 42, marginTop: 4 },
  ghostText: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
  dim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { marginHorizontal: 8, borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 14 },
  grab: { width: 38, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 14 },
  sheetTitle: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  sheetSub: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 2, marginBottom: 6 },
  opt: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 11, height: 11, borderRadius: 6 },
});
