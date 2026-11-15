import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, ActivityIndicator, ScrollView } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import * as LocalAuthentication from "expo-local-authentication";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { Keypad } from "@/components/Keypad";
import { getCardDetails, type CardDetails } from "@/services/cards";

const LIME = "#81FB02";
/** How long the details stay up before they hide themselves. */
const SHOW_FOR = 60;

function Press({ style, children, ...rest }: React.ComponentProps<typeof Pressable> & { style?: any }) {
  return (
    <Pressable {...rest} style={({ pressed }) => [style, { transform: [{ scale: pressed ? 0.95 : 1 }], opacity: pressed ? 0.85 : 1 }]}>
      {children as any}
    </Pressable>
  );
}

const grouped = (n: string) => n.replace(/(\d{4})(?=\d)/g, "$1 ");

/**
 * Card number, CVV and expiry. Behind Face ID or the PIN every time, read
 * fresh from the issuer, never kept, and hidden again after a minute.
 */
export default function CardDetailsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { verifyPin, bioTx } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [details, setDetails] = useState<CardDetails | null>(null);
  const [error, setError] = useState("");
  const [left, setLeft] = useState(SHOW_FOR);
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Face ID first when it's on; the PIN pad is always there behind it.
  useEffect(() => {
    if (!bioTx || Platform.OS === "web") return;
    LocalAuthentication.authenticateAsync({ promptMessage: "Show card details", fallbackLabel: "Use PIN", cancelLabel: "Cancel" })
      .then((r) => r.success && setUnlocked(true))
      .catch(() => {});
  }, [bioTx]);

  useEffect(() => {
    if (!unlocked || !id) return;
    getCardDetails(String(id))
      .then((d) => {
        setDetails(d);
        timer.current = setInterval(() => setLeft((n) => n - 1), 1000);
      })
      .catch((e) => setError(e?.response?.data?.error || "Couldn't show the card details."));
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [unlocked, id]);

  useEffect(() => {
    if (left <= 0) {
      if (timer.current) clearInterval(timer.current);
      setDetails(null);
      router.back();
    }
  }, [left, router]);

  const onKey = async (k: string) => {
    if (k === ".") return;
    const next = (pin + k).slice(0, 4);
    setPin(next);
    setPinError(false);
    if (next.length < 4) return;
    try {
      if (await verifyPin(next)) {
        setUnlocked(true);
        return;
      }
    } catch {
      /* falls through to the error */
    }
    setPinError(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    setTimeout(() => setPin(""), 500);
  };

  const copy = async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    setCopied(label);
    Haptics.selectionAsync().catch(() => {});
    setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
  };

  const header = (
    <View style={s.header}>
      <Press onPress={() => router.back()} style={[s.round, { backgroundColor: colors.card }]} hitSlop={8}>
        <Ionicons name="chevron-back" size={20} color={colors.foreground} />
      </Press>
      <Text style={[s.title, { color: colors.foreground }]}>Card details</Text>
      <View style={{ width: 40 }} />
    </View>
  );

  if (!unlocked) {
    return (
      <View style={[s.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        {header}
        <View style={s.lockWrap}>
          <View style={s.lockIcon}>
            <Ionicons name="lock-closed" size={24} color={LIME} />
          </View>
          <Text style={[s.lockTitle, { color: colors.foreground }]}>Enter your PIN</Text>
          <Text style={[s.lockSub, { color: pinError ? "#ff9a9a" : colors.mutedForeground }]}>
            {pinError ? "That PIN isn't right" : "To show your card number and CVV"}
          </Text>
          <View style={s.dots}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={[s.dot, { backgroundColor: i < pin.length ? (pinError ? "#ff8a8a" : LIME) : colors.border }]} />
            ))}
          </View>
        </View>
        <View style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 16 }}>
          <Keypad onKey={onKey} onBackspace={() => setPin((p) => p.slice(0, -1))} />
        </View>
      </View>
    );
  }

  const row = (label: string, value: string, opts: { mono?: boolean; copyValue?: string; last?: boolean } = {}) => (
    <View style={[s.row, !opts.last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[s.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[opts.mono ? s.rowMono : s.rowValue, { color: colors.foreground }]}>{value}</Text>
      </View>
      <Press onPress={() => copy(label, opts.copyValue ?? value)} style={[s.copy, { backgroundColor: copied === label ? LIME : colors.secondary }]}>
        <Ionicons name={copied === label ? "checkmark" : "copy-outline"} size={16} color={copied === label ? "#0a0a0a" : colors.foreground} />
      </Press>
    </View>
  );

  const b = details?.billing;
  const address = b ? [b.address_line_1, b.address_line_2, b.city, b.state, b.postal_code, b.country].filter(Boolean).join(", ") : "";

  return (
    <View style={[s.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {header}
      {!details ? (
        error ? (
          <Text style={[s.err, { color: colors.mutedForeground }]}>{error}</Text>
        ) : (
          <ActivityIndicator color={LIME} style={{ marginTop: 80 }} />
        )
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}>
          <View style={[s.timer, { borderColor: "rgba(129,251,2,0.2)" }]}>
            <Ionicons name="time-outline" size={17} color={LIME} />
            <Text style={s.timerText}>Hidden again in 0:{String(Math.max(0, left)).padStart(2, "0")}. Never share these details.</Text>
          </View>

          <View style={[s.panel, { backgroundColor: colors.card }]}>
            {row("Card number", grouped(details.number), { mono: true, copyValue: details.number })}
            <View style={[s.split, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border, paddingRight: 12 }}>
                {row("Expires", details.expiry, { mono: true, last: true })}
              </View>
              <View style={{ flex: 1, paddingLeft: 12 }}>
                {row("CVV", details.cvv, { mono: true, last: true })}
              </View>
            </View>
            {row("Name on card", details.name || " ")}
            {row("Billing address", address || "Not given", { last: true })}
          </View>

          <Press onPress={() => router.back()} style={[s.hide, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="eye-off-outline" size={18} color={colors.foreground} />
            <Text style={[s.hideText, { color: colors.foreground }]}>Hide details</Text>
          </Press>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 10 },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontFamily: "Inter_700Bold" },
  lockWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  lockIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(129,251,2,0.1)", alignItems: "center", justifyContent: "center", marginBottom: 6 },
  lockTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  lockSub: { fontSize: 13.5, fontFamily: "Inter_400Regular" },
  dots: { flexDirection: "row", gap: 14, marginTop: 14 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  err: { textAlign: "center", marginTop: 80, paddingHorizontal: 40, fontFamily: "Inter_500Medium" },
  timer: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, backgroundColor: "rgba(129,251,2,0.07)", marginTop: 6 },
  timerText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#d9f7b8" },
  panel: { borderRadius: 20, paddingHorizontal: 16, marginTop: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13 },
  split: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  rowValue: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginTop: 3 },
  rowMono: { fontSize: 16, fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), marginTop: 3, letterSpacing: 0.6 },
  copy: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  hide: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 54, borderRadius: 27, borderWidth: 1, marginTop: 22 },
  hideText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
