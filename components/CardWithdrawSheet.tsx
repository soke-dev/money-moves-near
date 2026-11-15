import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, Animated, Easing, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { Keypad } from "@/components/Keypad";
import { TokenLogo } from "@/components/TokenLogo";
import { withdrawCard } from "@/services/cards";

const LIME = "#81FB02";
type Step = "amount" | "pin" | "sending" | "done" | "error";

/**
 * A card's balance back to the person's own wallet, as USDC on Solana. Face ID
 * or PIN first; the issuer converts the dollars and sends them, usually within
 * a few minutes.
 */
export function CardWithdrawSheet({
  visible,
  onClose,
  onDone,
  cardId,
  cardName,
  balance,
}: {
  visible: boolean;
  onClose: () => void;
  /** After a send: refresh the cards. */
  onDone: () => void;
  cardId: string;
  cardName: string;
  balance: number;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { verifyPin, bioTx, refreshBalances } = useApp();

  const [step, setStep] = useState<Step>("amount");
  const [amount, setAmount] = useState("");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<{ amount: number; fee: number; status: string } | null>(null);
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    setStep("amount");
    setAmount("");
    setPin("");
    setPinError(false);
    setError("");
    setSent(null);
    rise.setValue(0);
    Animated.timing(rise, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [visible, balance, rise]);

  const close = () => {
    if (step === "sending") return;
    Animated.timing(rise, { toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => {
      if (step === "done") onDone();
      onClose();
    });
  };

  const value = Number(amount) || 0;
  const all = Math.abs(value - balance) < 0.005;
  const valid = value >= 0.01 && value <= balance + 1e-9;

  const send = async () => {
    setStep("sending");
    try {
      const r = await withdrawCard(cardId, all ? { max: true } : { amount: value });
      setSent({ amount: r.amount, fee: r.fee, status: r.status });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      refreshBalances(true);
      setStep("done");
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || "That didn't go through.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setStep("error");
    }
  };

  const confirm = () => {
    if (!valid) return;
    if (bioTx && Platform.OS !== "web") {
      LocalAuthentication.authenticateAsync({ promptMessage: "Withdraw to your wallet", fallbackLabel: "Use PIN", cancelLabel: "Cancel" })
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
    setTimeout(() => setPin(""), 500);
  };

  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [500, 0] });

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={close}>
      <Animated.View style={[s.backdrop, { opacity: rise }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>
      <Animated.View style={[s.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16, transform: [{ translateY }] }]}>
        <View style={[s.handle, { backgroundColor: colors.border }]} />

        {step === "amount" && (
          <>
            <Text style={[s.title, { color: colors.foreground }]}>Withdraw to wallet</Text>
            <Text style={[s.sub, { color: colors.mutedForeground }]}>From {cardName} · ${balance.toFixed(2)} on the card</Text>

            {/* The amount is typed on our own pad below, never the phone's keyboard,
                so nothing slides up over the form. */}
            <View style={[s.amountBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={[s.dollar, { color: colors.mutedForeground }]}>$</Text>
              <Text style={[s.amountInput, { color: amount ? colors.foreground : colors.mutedForeground }]} numberOfLines={1}>
                {amount || "0.00"}
              </Text>
              <Pressable onPress={() => setAmount(balance.toFixed(2))} style={[s.max, { borderColor: colors.border }]}>
                <Text style={[s.maxText, { color: colors.foreground }]}>Max</Text>
              </Pressable>
            </View>

            <View style={[s.toRow, { backgroundColor: colors.background }]}>
              <TokenLogo symbol="USDC" size={30} dark />
              <View style={{ flex: 1 }}>
                <Text style={[s.toTitle, { color: colors.foreground }]}>Your wallet</Text>
                <Text style={[s.toSub, { color: colors.mutedForeground }]}>Arrives as USDC on Solana</Text>
              </View>
            </View>
            <Text style={[s.fine, { color: value > balance + 1e-9 ? colors.destructive : colors.mutedForeground }]}>
              {value > balance + 1e-9
                ? `The card has $${balance.toFixed(2)}.`
                : "A small network fee may be taken from the card. Usually arrives within a few minutes."}
            </Text>

            <Keypad
              decimal
              onKey={(k) =>
                setAmount((a) => {
                  if (k === "." && a.includes(".")) return a;
                  const next = a === "0" && k !== "." ? k : a + k;
                  const [, dec] = next.split(".");
                  if (dec && dec.length > 2) return a;
                  return next === "." ? "0." : next;
                })
              }
              onBackspace={() => setAmount((a) => a.slice(0, -1))}
            />

            <Pressable onPress={confirm} disabled={!valid} style={({ pressed }) => [s.cta, !valid && { opacity: 0.45 }, { transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
              <Text style={s.ctaText}>{valid ? `Withdraw $${value.toFixed(2)}` : "Withdraw to wallet"}</Text>
            </Pressable>
            <Pressable onPress={close} style={s.cancel}>
              <Text style={[s.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
            </Pressable>
          </>
        )}

        {step === "pin" && (
          <>
            <Text style={[s.title, { color: colors.foreground, textAlign: "center" }]}>Enter your PIN</Text>
            <Text style={[s.sub, { color: pinError ? colors.destructive : colors.mutedForeground, textAlign: "center" }]}>
              {pinError ? "That PIN isn't right" : "To withdraw to your wallet"}
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
            <Text style={[s.title, { color: colors.foreground, textAlign: "center" }]}>Withdrawing to your wallet</Text>
            <Text style={[s.sub, { color: colors.mutedForeground, textAlign: "center" }]}>Keep this open for a moment.</Text>
          </View>
        )}

        {step === "done" && sent && (
          <View style={s.center}>
            <Ionicons name="checkmark-circle" size={56} color={colors.primary} />
            <Text style={[s.title, { color: colors.foreground, textAlign: "center" }]}>
              {sent.status === "sent" ? "Sent to your wallet" : "On its way to your wallet"}
            </Text>
            <Text style={[s.sub, { color: colors.mutedForeground, textAlign: "center" }]}>
              ${sent.amount.toFixed(2)} as USDC on Solana{sent.fee > 0 ? `, $${sent.fee.toFixed(2)} network fee` : ""}.
              {sent.status === "sent" ? "" : " We'll let you know when it lands."}
            </Text>
            <Pressable onPress={close} style={({ pressed }) => [s.cta, { alignSelf: "stretch", transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
              <Text style={s.ctaText}>Done</Text>
            </Pressable>
          </View>
        )}

        {step === "error" && (
          <View style={s.center}>
            <Ionicons name="alert-circle" size={52} color="#f59e0b" />
            <Text style={[s.title, { color: colors.foreground, textAlign: "center" }]}>That didn't go through</Text>
            <Text style={[s.sub, { color: colors.mutedForeground, textAlign: "center" }]}>{error}</Text>
            <Pressable onPress={() => setStep("amount")} style={({ pressed }) => [s.cta, { alignSelf: "stretch", transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
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
  title: { fontSize: 19, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },
  sub: { fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_400Regular", marginTop: 4 },
  amountBox: { flexDirection: "row", alignItems: "center", height: 60, borderRadius: 18, borderWidth: 1, paddingHorizontal: 16, marginTop: 14, gap: 6 },
  dollar: { fontSize: 24, fontFamily: "Inter_800ExtraBold" },
  amountInput: { flex: 1, fontSize: 28, fontFamily: "Inter_800ExtraBold" },
  max: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, height: 32, justifyContent: "center" },
  maxText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  toRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, marginTop: 10 },
  toTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  toSub: { fontSize: 12.5, fontFamily: "Inter_400Regular", marginTop: 2 },
  fine: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 12, paddingHorizontal: 2 },
  cta: { height: 56, borderRadius: 28, backgroundColor: LIME, alignItems: "center", justifyContent: "center", marginTop: 18 },
  ctaText: { fontSize: 16, fontFamily: "Inter_800ExtraBold", color: "#0a0a0a" },
  cancel: { alignItems: "center", paddingVertical: 14 },
  cancelText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 14, marginVertical: 20 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  center: { alignItems: "center", gap: 10, paddingVertical: 18 },
});
