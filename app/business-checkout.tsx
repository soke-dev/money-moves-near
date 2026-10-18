import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Image, Linking, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { ts } from "@/constants/transfer";
import { getBusinessCheckout, openBusinessCheckout, type BusinessCheckout, type CheckoutKind } from "@/services/business-payments";

/** Two letters for a business with no picture - the legal suffix says nothing about who it is. */
function initials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z0-9]+/, ""))
    .filter((w) => w && !/^(ltd|limited|plc|llc|inc|co|nig)\.?$/i.test(w));
  return (words.length ? words : [name]).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("") || "?";
}

const money = (n: number, currency: "NGN" | "USD") =>
  currency === "NGN"
    ? `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** What's been typed, with thousands separators and the decimals as typed ("1,000.5"). */
const shown = (typed: string) => {
  if (!typed) return "0";
  const [whole, dec] = typed.split(".");
  const w = Number(whole || "0").toLocaleString("en-US");
  return dec !== undefined ? `${w}.${dec}` : w;
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"] as const;

/**
 * A business's poster, payment link or invoice, scanned with the app.
 *
 * Instead of the web checkout, it's paid here. A set price opens the payment
 * straight away and the pay screen takes over. Any amount - a shop's poster, an
 * open link - asks for the amount first: one large figure in the middle, the
 * dollar value as it's typed, the shop's range in a quiet pill that turns red
 * past it, and a keypad of bare numbers. One the app can't take (a test
 * checkout, one without Money Moves) says why and offers the web page instead.
 * A phone's own camera never comes here: it opens the web checkout.
 */
export default function BusinessCheckoutScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const params = useLocalSearchParams<{ kind?: string; ref?: string; url?: string }>();
  const kind = (["link", "outlet", "invoice"].includes(String(params.kind)) ? params.kind : "link") as CheckoutKind;
  const ref = String(params.ref ?? "");
  const url = String(params.url ?? "");

  const [checkout, setCheckout] = useState<BusinessCheckout | null>(null);
  const [problem, setProblem] = useState("");
  const [typed, setTyped] = useState("");
  const [opening, setOpening] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  // The cursor after the figure: it blinks, so it's plain the amount is being typed.
  const blink = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0, duration: 1, delay: 500, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 1, delay: 500, easing: Easing.linear, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [blink]);

  /** Opens the payment for this person and hands over to the pay screen, which is the review. */
  const open = async (body: { amount?: number; currency?: "NGN" | "USD" } = {}) => {
    setOpening(true);
    setProblem("");
    try {
      const payment = await openBusinessCheckout(kind, ref, body);
      router.replace({ pathname: "/business-pay", params: { id: payment.id } } as any);
    } catch (e: any) {
      setProblem(e?.response?.data?.error || "We couldn't open this checkout just now. Try again in a moment.");
      setOpening(false);
    }
  };

  useEffect(() => {
    if (!ref) {
      setProblem("That code doesn't lead to a checkout.");
      return;
    }
    getBusinessCheckout(kind, ref)
      .then((c) => {
        setCheckout(c);
        // A set price: nothing to ask - straight to the payment.
        if (c.payable && c.amount != null) void open();
      })
      .catch((e) => setProblem(e?.response?.data?.error || "We couldn't load this checkout. Try again in a moment."));
  }, [kind, ref]);

  // What one payment can be, in the checkout's own money.
  const bounds = (() => {
    if (!checkout) return null;
    const { currency, limits, rate, min } = checkout;
    const toCur = (ngn: number) => (currency === "NGN" ? ngn : rate ? ngn / rate : null);
    const lo = Math.max(min ?? 0, toCur(limits.minNgn) ?? 0);
    const hi = toCur(limits.maxNgn);
    return { lo: currency === "USD" ? Math.ceil(lo * 100) / 100 : Math.ceil(lo), hi: hi == null ? null : currency === "USD" ? Math.floor(hi * 100) / 100 : Math.floor(hi) };
  })();
  const value = Number(typed) || 0;
  const tooLow = !!bounds && value > 0 && value < bounds.lo;
  const tooHigh = !!bounds && bounds.hi != null && value > bounds.hi;
  const canGo = value > 0 && !tooLow && !tooHigh && !opening;

  // The other money, as it's typed: what goes out in USDC or USDT, or its naira worth.
  const other = (() => {
    if (!checkout || !value || !checkout.rate) return null;
    return checkout.currency === "NGN"
      ? `≈ $${(value / checkout.rate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `≈ ₦${Math.round(value * checkout.rate).toLocaleString("en-NG")}`;
  })();

  const press = (k: (typeof KEYS)[number]) => {
    if (opening) return;
    Haptics.selectionAsync().catch(() => {});
    setProblem("");
    if (k === "back") return setTyped((t) => t.slice(0, -1));
    setTyped((t) => {
      if (k === ".") return t.includes(".") ? t : (t || "0") + ".";
      const next = t === "0" ? k : t + k;
      const [, dec] = next.split(".");
      if (dec && dec.length > 2) return t;
      if (next.replace(".", "").length > 9) return t;
      return next;
    });
  };

  const mark = (size: number, radius: number) =>
    checkout?.business.logo && !logoFailed ? (
      <Image source={{ uri: checkout.business.logo }} onError={() => setLogoFailed(true)} style={{ width: size, height: size, borderRadius: radius, backgroundColor: "#fff" }} resizeMode="contain" />
    ) : (
      <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: size * 0.36, fontFamily: "Inter_700Bold", color: "#0a0a0a" }}>{initials(checkout?.business.name ?? "")}</Text>
      </View>
    );

  const tick = checkout?.business.verified ? (
    <View style={[st.tick, { backgroundColor: colors.primary }]}>
      <Feather name="check" size={9} color={colors.primaryForeground} />
    </View>
  ) : null;

  // The full header, for the screens that aren't the amount.
  const header = checkout && (
    <View style={st.who}>
      {mark(48, 14)}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={st.nameRow}>
          <Text style={[st.name, { color: colors.foreground }]} numberOfLines={1}>
            {checkout.business.name}
          </Text>
          {tick}
        </View>
        <Text style={[st.sub, { color: colors.mutedForeground }]} numberOfLines={1}>
          {checkout.title}
        </Text>
      </View>
    </View>
  );

  const asking = !!checkout && checkout.payable && checkout.amount == null;
  const bad = tooLow || tooHigh;

  return (
    <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={st.top}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={[st.round, { backgroundColor: colors.muted }]} accessibilityLabel="Close">
          <Feather name="x" size={18} color={colors.foreground} />
        </TouchableOpacity>
        {asking && checkout ? (
          // On the amount screen the business is a chip: the figure is what this screen is for.
          <View style={[st.chip, { backgroundColor: colors.muted }]}>
            {mark(26, 8)}
            <Text style={[st.chipName, { color: colors.foreground }]} numberOfLines={1}>
              {checkout.business.name}
            </Text>
            {tick}
          </View>
        ) : null}
        <View style={{ width: 36 }} />
      </View>

      {!checkout ? (
        <View style={st.center}>
          {problem ? <Text style={[st.note, { color: colors.mutedForeground }]}>{problem}</Text> : <ActivityIndicator color={colors.primary} />}
        </View>
      ) : !checkout.payable ? (
        // The app can't take this one: why, and the web page instead.
        <>
          <View style={{ paddingHorizontal: 20, paddingTop: 18, flex: 1 }}>
            {header}
            <View style={[st.float, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[st.blockText, { color: colors.foreground }]}>{checkout.blocked?.message ?? "This checkout can't be paid in the app."}</Text>
            </View>
          </View>
          <View style={[st.cta, { paddingBottom: bottomPad + 14 }]}>
            {!!url && checkout.blocked?.code !== "paid" && (
              <TouchableOpacity style={[st.btn, { backgroundColor: colors.primary }]} onPress={() => Linking.openURL(url)} activeOpacity={0.85}>
                <Text style={[st.btnText, { color: colors.primaryForeground }]}>Open in browser</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => router.back()} style={st.ghost} activeOpacity={0.7}>
              <Text style={[st.ghostText, { color: colors.mutedForeground }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : asking ? (
        // Any amount: one large figure, the range under it, and bare keys.
        <>
          <View style={st.amountArea}>
            <Text style={[st.for, { color: colors.mutedForeground }]} numberOfLines={1}>
              {checkout.title} · any amount
            </Text>
            <View style={st.figureRow}>
              <Text style={[st.cur, { color: colors.mutedForeground }]}>{checkout.currency === "NGN" ? "₦" : "$"}</Text>
              <Text
                style={[st.figure, { color: bad ? colors.destructive : typed ? colors.foreground : colors.border }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.5}
              >
                {shown(typed)}
              </Text>
              {!bad && <Animated.View style={[st.caret, { backgroundColor: colors.primary, opacity: blink }]} />}
            </View>
            <Text style={[st.conv, { color: colors.mutedForeground }]}>
              {other ? `${other}${checkout.currency === "NGN" ? " · paid in USDC or USDT" : ""}` : "Type what the shop asked for"}
            </Text>
            {bounds && (
              <View style={[st.pill, { backgroundColor: bad ? "rgba(255,107,94,0.12)" : colors.muted }]}>
                <Text style={[st.pillText, { color: bad ? colors.destructive : colors.mutedForeground }]}>
                  {tooHigh && bounds.hi != null
                    ? `Up to ${money(bounds.hi, checkout.currency)} in one payment`
                    : tooLow
                      ? `At least ${money(bounds.lo, checkout.currency)}`
                      : bounds.hi != null
                        ? `${money(bounds.lo, checkout.currency)} to ${money(bounds.hi, checkout.currency)}`
                        : `At least ${money(bounds.lo, checkout.currency)}`}
                </Text>
              </View>
            )}
            {!!problem && <Text style={[st.problem, { color: colors.destructive }]}>{problem}</Text>}
          </View>

          <View style={st.pad}>
            {KEYS.map((k) => (
              <Pressable
                key={k}
                onPress={() => press(k)}
                disabled={opening}
                style={({ pressed }) => [st.key, pressed && { backgroundColor: colors.muted }]}
                accessibilityLabel={k === "back" ? "Delete" : k === "." ? "Decimal point" : k}
              >
                {k === "back" ? (
                  <Feather name="delete" size={22} color={colors.mutedForeground} />
                ) : (
                  <Text style={[st.keyText, { color: colors.foreground }]}>{k}</Text>
                )}
              </Pressable>
            ))}
          </View>

          <View style={[st.cta, { paddingBottom: bottomPad + 14 }]}>
            <TouchableOpacity
              style={[st.btn, st.btnSplit, { backgroundColor: canGo ? colors.primary : colors.muted }]}
              disabled={!canGo}
              onPress={() => void open({ amount: value, currency: checkout.currency })}
              activeOpacity={0.85}
            >
              {opening ? (
                <ActivityIndicator color={colors.primaryForeground} style={{ flex: 1 }} />
              ) : (
                <>
                  <Text style={[st.btnText, { color: canGo ? colors.primaryForeground : colors.mutedForeground }]}>Continue</Text>
                  {canGo && <Text style={[st.btnAmount, { color: colors.primaryForeground }]}>{money(value, checkout.currency)} →</Text>}
                </>
              )}
            </TouchableOpacity>
          </View>
        </>
      ) : (
        // A set price: opening it now.
        <View style={{ paddingHorizontal: 20, paddingTop: 18, flex: 1 }}>
          {header}
          {problem ? (
            <>
              <Text style={[st.problem, { color: colors.destructive, marginTop: 28 }]}>{problem}</Text>
              <TouchableOpacity style={[st.btn, { backgroundColor: colors.primary, marginTop: 18 }]} onPress={() => void open()} activeOpacity={0.85}>
                <Text style={[st.btnText, { color: colors.primaryForeground }]}>Try again</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={st.openingRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[st.note, { color: colors.mutedForeground }]}>Opening {money(checkout.amount ?? 0, checkout.currency)} for {checkout.business.name}…</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingTop: 8, gap: 10 },
  round: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 999, paddingVertical: 4, paddingLeft: 4, paddingRight: 12, flexShrink: 1 },
  chipName: { fontSize: 13, lineHeight: 17, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  who: { flexDirection: "row", alignItems: "center", gap: 12 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  tick: { width: 15, height: 15, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  sub: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 1 },
  amountArea: { flex: 1, alignItems: "center", paddingHorizontal: 24, paddingTop: 34 },
  for: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular" },
  figureRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center", marginTop: 12, maxWidth: "100%" },
  cur: { fontSize: 30, lineHeight: 40, fontFamily: "Inter_600SemiBold", marginTop: 4, marginRight: 2 },
  figure: { fontSize: 62, lineHeight: 72, fontFamily: "Inter_700Bold", letterSpacing: -2.6, fontVariant: ["tabular-nums"], flexShrink: 1 },
  caret: { width: 3, height: 54, borderRadius: 2, marginLeft: 4, marginTop: 9 },
  conv: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 8, fontVariant: ["tabular-nums"] },
  pill: { marginTop: 14, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  pillText: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_600SemiBold" },
  problem: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_500Medium", marginTop: 14, textAlign: "center" },
  note: { fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_400Regular", textAlign: "center" },
  openingRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 34 },
  float: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 16, marginTop: 24 },
  blockText: { fontSize: 14.5, lineHeight: 21, fontFamily: "Inter_500Medium" },
  pad: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 22, rowGap: 4 },
  key: { width: "33.333%", height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  keyText: { fontSize: 26, lineHeight: 32, fontFamily: "Inter_500Medium" },
  cta: { paddingHorizontal: 20, paddingTop: 12 },
  btn: { height: 54, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  btnSplit: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20 },
  btnText: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_700Bold" },
  btnAmount: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_600SemiBold", opacity: 0.8 },
  ghost: { alignItems: "center", justifyContent: "center", height: 42, marginTop: 4 },
  ghostText: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
});
