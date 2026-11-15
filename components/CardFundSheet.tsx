import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, Animated, Easing, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { Keypad } from "@/components/Keypad";
import { CardIllo } from "@/components/CardIllos";
import { startCardTopup, syncCardTopups, getCards, type CardKind, type CardSummary } from "@/services/cards";
import { CardFace } from "@/components/CardFace";
import { prepareWithdrawal, submitWithdrawal, abandonWithdraw } from "@/services/transactions";
import { signSolanaTransaction, getLocalAddresses, ensureSigningSession } from "@/services/wallet-core";

const LIME = "#81FB02";

type Step = "confirm" | "pin" | "sending" | "tracking" | "done" | "held" | "slow" | "error";

/**
 * Confirms a card top up (or a new card and its first top up) in a sheet over
 * the top up screen, and does the send itself: Face ID or PIN, then the same
 * prepare, sign and submit every Solana send uses. Worded for the card
 * throughout; the deposit address is ours and never shown.
 */
export function CardFundSheet({
  visible,
  onClose,
  onFinished,
  coin,
  amount,
  sendFee,
  credit,
  newCard,
  cardId,
  cardFee,
  startsWith,
}: {
  visible: boolean;
  onClose: () => void;
  /** After the send: back to Cards. */
  onFinished: () => void;
  coin: "USDC" | "USDT";
  amount: number;
  sendFee: number;
  credit: number;
  newCard: { kind: CardKind; name: string } | null;
  /** The card being topped up (when not making a new one). */
  cardId?: string;
  cardFee: number;
  startsWith: number;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { verifyPin, bioTx, refreshBalances, refreshTransactions } = useApp();

  const [step, setStep] = useState<Step>("confirm");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState(0);
  /** What the server has said since the send: received, added, card made. */
  const [progress, setProgress] = useState({ received: false, added: false, made: false });
  const [madeCard, setMadeCard] = useState<CardSummary | null>(null);
  const before = useRef<{ ids: Set<string>; at: number }>({ ids: new Set(), at: 0 });
  const { user } = useApp();

  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    setStep("confirm");
    setPin("");
    setPinError(false);
    setError("");
    setStage(0);
    setProgress({ received: false, added: false, made: false });
    setMadeCard(null);
    rise.setValue(0);
    Animated.timing(rise, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [visible, rise]);

  const close = () => {
    if (step === "sending") return; // never mid-send
    Animated.timing(rise, { toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() =>
      step === "done" || step === "tracking" || step === "held" || step === "slow" ? onFinished() : onClose(),
    );
  };

  const send = async () => {
    setStep("sending");
    setStage(0);
    let preparedId: string | undefined;
    // Past this point the send may be on the chain, so a failure can't promise nothing moved.
    let submitted = false;
    try {
      const now = await getCards().catch(() => null);
      before.current = { ids: new Set((now?.cards || []).map((c) => c.id)), at: Date.now() };
      // Opens the card account if needed, checks the limits, and (for a new card) books it.
      const t = await startCardTopup(amount, coin, newCard ? { card: newCard } : { cardId: cardId! });
      setStage(1);
      const local = await getLocalAddresses().catch(() => null);
      await ensureSigningSession();
      const prepared = (await prepareWithdrawal({
        asset: coin,
        chain: "SOL",
        amount,
        address: t.address,
        senderAddress: local?.SOL || undefined,
      })) as any;
      preparedId = prepared.withdrawalId;
      const { signature, publicKey } = await signSolanaTransaction(prepared.signingMessage);
      setStage(2);
      submitted = true;
      await submitWithdrawal({ withdrawalId: prepared.withdrawalId, signature, publicKey });
      setStage(3);
      syncCardTopups().catch(() => {});
      refreshBalances(true);
      refreshTransactions();
      setStep("tracking");
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || "That didn't go through.";
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      if (submitted) {
        // It may well have gone: follow it rather than call it failed. Anything that
        // reaches us is credited (and the card made) by itself.
        syncCardTopups().catch(() => {});
        setStep("tracking");
        return;
      }
      if (preparedId) abandonWithdraw(preparedId, msg, "sign:SOL");
      setError(msg);
      setStep("error");
    }
  };

  /**
   * After the send: follow it to the end. The server checks the send on chain,
   * adds the money to the card and (for a new card) makes it; asking for the
   * cards runs that check, so polling here also moves it along.
   */
  useEffect(() => {
    // Only while the sheet is open: closed, the Cards screen keeps an eye on it instead.
    if (step !== "tracking" || !visible) return;
    let stop = false;
    let busy = false;
    const startedAt = before.current.at;
    const tick = async () => {
      // One request at a time: a slow answer must not stack up behind the next tick.
      if (busy) return;
      busy = true;
      const d = await getCards().catch(() => null);
      busy = false;
      if (stop || !d) return;
      const mine = (d.topups || []).filter((t) => new Date(t.createdAt).getTime() >= startedAt - 60_000);
      const latest = mine[0];
      const fresh = (d.cards || []).find((c) => !before.current.ids.has(c.id)) || null;
      const next = {
        received: !!latest,
        added: latest?.status === "done",
        made: !!fresh,
      };
      setProgress(next);
      if (latest?.status === "held" || d.pendingCard?.stuck) return setStep("held");
      if (newCard ? next.made : next.added) {
        setMadeCard(fresh);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setStep("done");
      }
    };
    tick();
    const every = setInterval(tick, 4000);
    const slow = setTimeout(() => !stop && setStep((st) => (st === "tracking" ? "slow" : st)), 4 * 60 * 1000);
    return () => {
      stop = true;
      clearInterval(every);
      clearTimeout(slow);
    };
  }, [step, newCard, visible]);

  const confirm = () => {
    if (bioTx && Platform.OS !== "web") {
      LocalAuthentication.authenticateAsync({
        promptMessage: newCard ? "Create your card" : "Top up your card",
        fallbackLabel: "Use PIN",
        cancelLabel: "Cancel",
      })
        .then((r) => (r.success ? send() : setStep("pin")))
        .catch(() => setStep("pin"));
      return;
    }
    setStep("pin");
  };

  const onPinKey = async (k: string) => {
    if (k === ".") return;
    const next = (pin + k).slice(0, 4);
    setPin(next);
    setPinError(false);
    if (next.length < 4) return;
    let ok = false;
    try {
      ok = await verifyPin(next);
    } catch {
      ok = false;
    }
    if (ok) return send();
    setPinError(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    setTimeout(() => setPin(""), 500);
  };

  const row = (label: string, value: string, opts: { strong?: boolean; lime?: boolean } = {}) => (
    <View style={s.row}>
      <Text style={[s.rowLabel, { color: opts.strong ? colors.foreground : colors.mutedForeground }, opts.strong && s.strong]}>{label}</Text>
      <Text style={[s.rowValue, { color: opts.lime ? colors.primary : colors.foreground }, opts.strong && s.strong]}>{value}</Text>
    </View>
  );

  const title = newCard ? `Create ${newCard.name}` : "Top up your card";
  const holder = `${user?.firstName || ""} ${user?.lastName || ""}`.trim().toUpperCase();
  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [500, 0] });

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={close}>
      <Animated.View style={[s.backdrop, { opacity: rise }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>
      <Animated.View
        style={[s.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16, transform: [{ translateY }] }]}
      >
        <View style={[s.handle, { backgroundColor: colors.border }]} />

        {step === "confirm" && (
          <>
            <View style={s.head}>
              <CardIllo name={newCard?.kind === "one-time" ? "oneTime" : newCard ? "everyday" : "wallet"} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={[s.title, { color: colors.foreground }]} numberOfLines={1}>{title}</Text>
                <Text style={[s.sub, { color: colors.mutedForeground }]}>From your {coin} on Solana</Text>
              </View>
            </View>
            <View style={[s.slip, { backgroundColor: colors.background }]}>
              {row("Amount", `${amount.toFixed(2)} ${coin}`)}
              {sendFee > 0 && row("Network fee", `${sendFee.toFixed(2)} ${coin}`)}
              {sendFee > 0 && row("Total from your wallet", `${(amount + sendFee).toFixed(2)} ${coin}`, { strong: true })}
              {credit < amount && row("Top up fee", `−$${(amount - credit).toFixed(2)}`)}
              {newCard && row("Card creation fee", `−$${cardFee.toFixed(2)}`)}
              <View style={[s.rule, { backgroundColor: colors.border }]} />
              {row(newCard ? "Your card starts with" : "Added to your card", `$${(newCard ? startsWith : credit).toFixed(2)}`, { strong: true, lime: true })}
            </View>
            <View style={s.note}>
              <Ionicons name="time-outline" size={15} color={colors.mutedForeground} />
              <Text style={[s.noteText, { color: colors.mutedForeground }]}>
                {newCard ? "Your card is ready within a couple of minutes. We'll let you know." : "On your card within a couple of minutes."}
              </Text>
            </View>
            <Pressable onPress={confirm} style={({ pressed }) => [s.cta, { transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
              <Text style={s.ctaText}>{newCard ? "Confirm and create card" : "Confirm top up"}</Text>
            </Pressable>
            <Pressable onPress={close} style={s.cancel}>
              <Text style={[s.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
            </Pressable>
          </>
        )}

        {step === "pin" && (
          <>
            <Text style={[s.title, { color: colors.foreground, textAlign: "center", marginTop: 6 }]}>Enter your PIN</Text>
            <Text style={[s.sub, { color: pinError ? colors.destructive : colors.mutedForeground, textAlign: "center" }]}>
              {pinError ? "That PIN isn't right" : `To ${newCard ? "create your card" : "top up your card"}`}
            </Text>
            <View style={s.dots}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={[s.dot, { backgroundColor: i < pin.length ? (pinError ? colors.destructive : colors.primary) : colors.border }]} />
              ))}
            </View>
            <Keypad onKey={onPinKey} onBackspace={() => setPin((p) => p.slice(0, -1))} />
          </>
        )}

        {step === "sending" && (
          <View style={s.center}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={[s.title, { color: colors.foreground, textAlign: "center" }]}>
              {newCard ? "Creating your card" : "Topping up your card"}
            </Text>
            <View style={s.stages}>
              {["Getting your card ready", "Approving", "Sending from your wallet"].map((label, i) => (
                <View key={label} style={s.stageRow}>
                  <Ionicons
                    name={stage > i ? "checkmark-circle" : "ellipse-outline"}
                    size={18}
                    color={stage > i ? colors.primary : colors.mutedForeground}
                  />
                  <Text style={[s.stageText, { color: stage > i ? colors.foreground : colors.mutedForeground }]}>{label}</Text>
                </View>
              ))}
            </View>
            <Text style={[s.sub, { color: colors.mutedForeground, textAlign: "center" }]}>Keep this open for a moment.</Text>
          </View>
        )}


        {(step === "tracking" || step === "slow") && (
          <View style={s.center}>
            <View style={{ opacity: 0.9 }}>
              {newCard ? (
                <CardFace width={260} name={newCard.name} last4={null} holder={holder} oneTime={newCard.kind === "one-time"} />
              ) : (
                <CardIllo name="wallet" size={56} />
              )}
            </View>
            <Text style={[s.title, { color: colors.foreground, textAlign: "center", marginTop: 6 }]}>
              {step === "slow" ? "Taking a little longer" : newCard ? "Making your card" : "Adding to your card"}
            </Text>
            <View style={s.stages}>
              {(newCard
                ? [
                    ["Sent from your wallet", true],
                    ["Received", progress.received],
                    ["Card creation fee paid", progress.added],
                    ["Card created", progress.made],
                  ]
                : [
                    ["Sent from your wallet", true],
                    ["Received", progress.received],
                    [`$${credit.toFixed(2)} added to your card`, progress.added],
                  ]
              ).map(([label, done], i, all) => {
                const current = !done && (i === 0 || all[i - 1][1]);
                return (
                  <View key={String(label)} style={s.stageRow}>
                    {done ? (
                      <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                    ) : current ? (
                      <ActivityIndicator size="small" color={colors.primary} style={{ width: 20 }} />
                    ) : (
                      <Ionicons name="ellipse-outline" size={20} color={colors.border} />
                    )}
                    <Text style={[s.stageText, { color: done || current ? colors.foreground : colors.mutedForeground }]}>{String(label)}</Text>
                  </View>
                );
              })}
            </View>
            <Text style={[s.sub, { color: colors.mutedForeground, textAlign: "center" }]}>
              {step === "slow"
                ? "Your money is safe. It's still going through, and we'll let you know the moment it's done."
                : "Usually under two minutes. You can close this, and we'll let you know."}
            </Text>
            <Pressable onPress={close} style={s.cancel}>
              <Text style={[s.cancelText, { color: colors.mutedForeground }]}>{step === "slow" ? "Back to cards" : "Close"}</Text>
            </Pressable>
          </View>
        )}

        {step === "done" && (
          <View style={s.center}>
            {newCard ? (
              <CardFace
                width={280}
                name={madeCard?.name || newCard.name}
                last4={madeCard?.last4 || null}
                holder={holder}
                oneTime={newCard.kind === "one-time"}
              />
            ) : (
              <Ionicons name="checkmark-circle" size={56} color={colors.primary} />
            )}
            <Text style={[s.title, { color: colors.foreground, textAlign: "center", marginTop: 8 }]}>
              {newCard ? "Your card is ready" : "Added to your card"}
            </Text>
            <Text style={[s.sub, { color: colors.mutedForeground, textAlign: "center" }]}>
              {newCard
                ? `${madeCard?.name || newCard.name} is ready to use, with $${startsWith.toFixed(2)} on it.`
                : `$${credit.toFixed(2)} is on your card.`}
            </Text>
            <Pressable onPress={close} style={({ pressed }) => [s.cta, { alignSelf: "stretch", transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
              <Text style={s.ctaText}>{newCard ? "View card" : "Back to cards"}</Text>
            </Pressable>
          </View>
        )}

        {step === "held" && (
          <View style={s.center}>
            <Ionicons name="shield-checkmark" size={52} color="#f59e0b" />
            <Text style={[s.title, { color: colors.foreground, textAlign: "center" }]}>This needs a quick check</Text>
            <Text style={[s.sub, { color: colors.mutedForeground, textAlign: "center" }]}>
              Your money arrived and is safe. We're finishing this on our side and will let you know when it's done.
            </Text>
            <Pressable onPress={close} style={({ pressed }) => [s.cta, { alignSelf: "stretch", transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
              <Text style={s.ctaText}>Back to cards</Text>
            </Pressable>
          </View>
        )}

        {step === "error" && (
          <View style={s.center}>
            <Ionicons name="alert-circle" size={52} color="#f59e0b" />
            <Text style={[s.title, { color: colors.foreground, textAlign: "center" }]}>That didn't go through</Text>
            <Text style={[s.sub, { color: colors.mutedForeground, textAlign: "center" }]}>{error} Nothing left your wallet.</Text>
            <Pressable onPress={() => setStep("confirm")} style={({ pressed }) => [s.cta, { alignSelf: "stretch", transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
              <Text style={s.ctaText}>Try again</Text>
            </Pressable>
            <Pressable onPress={close} style={s.cancel}>
              <Text style={[s.cancelText, { color: colors.mutedForeground }]}>Close</Text>
            </Pressable>
          </View>
        )}
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10 },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 16 },
  head: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 16 },
  title: { fontSize: 19, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },
  sub: { fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_400Regular", marginTop: 3 },
  slip: { borderRadius: 18, padding: 16, gap: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  rowValue: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  strong: { fontFamily: "Inter_700Bold" },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  note: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 14, paddingHorizontal: 2 },
  noteText: { flex: 1, fontSize: 12.5, fontFamily: "Inter_400Regular" },
  cta: { height: 56, borderRadius: 28, backgroundColor: LIME, alignItems: "center", justifyContent: "center", marginTop: 18 },
  ctaText: { fontSize: 16, fontFamily: "Inter_800ExtraBold", color: "#0a0a0a" },
  cancel: { alignItems: "center", paddingVertical: 14 },
  cancelText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 14, marginVertical: 20 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  center: { alignItems: "center", gap: 10, paddingVertical: 18 },
  stages: { alignSelf: "stretch", gap: 10, marginVertical: 8, paddingHorizontal: 30 },
  stageRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stageText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
