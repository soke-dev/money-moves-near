import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { BlurView } from "expo-blur";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { fmtAsset } from "@/constants/transfer";
import { declineBusinessPayment, type BusinessPayment } from "@/services/business-payments";

/** Two letters for a business with no picture. "Ireti Crafts Ltd" is IC - the legal suffix says nothing about who it is. */
function initials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z0-9]+/, ""))
    .filter((w) => w && !/^(ltd|limited|plc|llc|inc|co|nig)\.?$/i.test(w));
  return (words.length ? words : [name]).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("") || "?";
}

/** How long it has left - a checkout stays open for minutes, not days. */
function closesIn(iso: string): string {
  const mins = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
  if (mins < 1) return "Under a minute";
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  return hours === 1 ? "An hour" : `${hours} hours`;
}

/**
 * A business asking to be paid, on Home, the moment it asks.
 *
 * The customer chose "Money Moves app" at a checkout and typed their
 * username; this is that checkout arriving on their phone. It says who and
 * how much, and hands over to the pay screen, where they pick the balance it
 * comes from and confirm with their PIN. Closing it is "not now": it waits
 * until the checkout closes.
 *
 * The same plain bottom sheet as a link request - React Native's Animated on
 * the native driver, sliding out before it unmounts.
 */
export function BusinessPaySheet({
  requests,
  bottomInset,
  onReview,
  onAnswered,
  onLater,
}: {
  /** Waiting payments, oldest first. The sheet shows the first. */
  requests: BusinessPayment[];
  bottomInset: number;
  /** Review and pay: Home opens the pay screen. */
  onReview: (id: string) => void;
  /** Declined, or not waiting any more: take it off the list. */
  onAnswered: (id: string) => void;
  /** Closed without an answer. */
  onLater: () => void;
}) {
  const colors = useColors();
  const { height } = useWindowDimensions();
  const [busy, setBusy] = useState(false);
  const req = requests[0];

  // 0 = resting on the bottom half, `height` = below the screen.
  const y = useRef(new Animated.Value(height)).current;
  const dim = useRef(new Animated.Value(0)).current;
  const leaving = useRef(false);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(y, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(dim, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [y, dim]);

  /** Slides it back down, then says what happened - the parent unmounts it only once it's off the screen. */
  const slideAway = (then: () => void) => {
    if (leaving.current) return;
    leaving.current = true;
    Animated.parallel([
      Animated.timing(y, { toValue: height, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(dim, { toValue: 0, duration: 240, useNativeDriver: true }),
    ]).start(() => then());
  };

  const later = () => {
    if (busy) return;
    slideAway(onLater);
  };

  // Dragged down far enough, or flicked: away. Claimed on touch start - inside a Modal on
  // Android, a drag that waits for movement to claim it is never offered the touch at all.
  const settle = () => Animated.timing(y, { toValue: 0, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  const drag = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => y.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 110 || g.vy > 1.1) laterRef.current();
        else settleRef.current();
      },
      onPanResponderTerminate: () => settleRef.current(),
    })
  ).current;
  // The responder is made once; these keep it calling today's functions.
  const laterRef = useRef(later);
  laterRef.current = later;
  const settleRef = useRef(settle);
  settleRef.current = settle;

  if (!req) return null;
  const more = requests.length - 1;

  const decline = async () => {
    setBusy(true);
    try {
      await declineBusinessPayment(req.id);
    } catch {
      // Paid, closed or declined somewhere else - nothing left to answer either way.
    } finally {
      setBusy(false);
    }
    if (more) onAnswered(req.id);
    else slideAway(() => onAnswered(req.id));
  };

  const review = () => slideAway(() => onReview(req.id));

  const facts: [string, string][] = [
    ["Amount", `$${fmtAsset(req.amount)}${req.priceLabel ? ` · ${req.priceLabel}` : ""}`],
    ...(req.title ? [["For", req.title] as [string, string]] : []),
    ["Closes in", closesIn(req.expiresAt)],
  ];

  return (
    <Modal transparent animationType="none" visible statusBarTranslucent onRequestClose={later}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: dim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={later} accessibilityLabel="Not now">
          {Platform.OS === "ios" ? (
            <BlurView intensity={22} tint="dark" style={StyleSheet.absoluteFill} />
          ) : (
            // Android has no real backdrop blur; a dim is the honest fallback.
            <View style={[StyleSheet.absoluteFill, s.dim]} />
          )}
        </Pressable>
      </Animated.View>

      <Animated.View
        style={[
          s.sheet,
          { backgroundColor: colors.card, minHeight: height * 0.5, paddingBottom: bottomInset + 18, transform: [{ translateY: y }] },
        ]}
      >
        {/* The handle and the row under it take the drag, so the buttons keep their taps. Not
            collapsable: a plain View is flattened out of the native tree, and the drag would
            land on the sheet behind it and never reach these handlers. */}
        <View collapsable={false} {...drag.panHandlers}>
          <View style={s.handleZone}>
            <View style={[s.handle, { backgroundColor: colors.mutedForeground }]} />
          </View>
          <View style={s.top}>
            <View style={[s.mark, { backgroundColor: colors.foreground }]}>
              <Text style={[s.markText, { color: colors.background }]}>{initials(req.businessName)}</Text>
            </View>
            <View style={{ flex: 1 }} />
            {requests.length > 1 && <Text style={[s.count, { color: colors.mutedForeground }]}>1 of {requests.length}</Text>}
            <TouchableOpacity onPress={later} style={[s.close, { backgroundColor: colors.muted }]} hitSlop={10} accessibilityLabel="Not now">
              <Feather name="x" size={17} color={colors.foreground} />
            </TouchableOpacity>
          </View>
        </View>

        <Text style={[s.title, { color: colors.foreground }]}>
          Pay {req.businessName} ${fmtAsset(req.amount)}?
        </Text>
        <Text style={[s.body, { color: colors.mutedForeground }]}>
          You chose to pay with Money Moves at {req.businessName}'s checkout. It goes from your wallet once you confirm with your PIN.
        </Text>

        <View style={[s.facts, { backgroundColor: colors.background }]}>
          {facts.map(([k, v], i, all) => (
            <View key={k} style={[s.fact, i < all.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
              <Text style={[s.factKey, { color: colors.mutedForeground }]}>{k}</Text>
              <Text style={[s.factValue, { color: colors.foreground }]} numberOfLines={1}>
                {v}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ flex: 1 }} />
        <View style={s.actions}>
          <TouchableOpacity style={[s.button, s.decline, { backgroundColor: colors.muted }]} onPress={() => void decline()} disabled={busy} activeOpacity={0.8}>
            {busy ? <ActivityIndicator size="small" color={colors.foreground} /> : <Text style={[s.buttonText, { color: colors.foreground }]}>Decline</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={[s.button, s.approve, { backgroundColor: colors.primary }]} onPress={review} disabled={busy} activeOpacity={0.85}>
            <Text style={[s.buttonText, { color: colors.primaryForeground }]}>Review and pay</Text>
          </TouchableOpacity>
        </View>
        <Text style={[s.foot, { color: colors.mutedForeground }]}>Didn't start this payment? Decline it - nothing leaves your wallet.</Text>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  dim: { backgroundColor: "rgba(0,0,0,0.62)" },
  // Fixed to the bottom edge, full width: part of the screen, not an object on it.
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
  },
  handleZone: { alignItems: "center", paddingTop: 10, paddingBottom: 14 },
  handle: { width: 40, height: 4, borderRadius: 2, opacity: 0.4 },
  top: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  // Solid, not a tint: it stands for the business, the way a logo would.
  mark: { width: 48, height: 48, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  markText: { fontSize: 17, lineHeight: 22, fontFamily: "Inter_700Bold", letterSpacing: 0.3 },
  count: { fontSize: 12.5, lineHeight: 16, fontFamily: "Inter_500Medium" },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 21, lineHeight: 27, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  body: { fontSize: 13.5, lineHeight: 20, fontFamily: "Inter_400Regular", marginTop: 6 },
  facts: { borderRadius: 16, paddingHorizontal: 14, marginTop: 16 },
  fact: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, paddingVertical: 11 },
  factKey: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  factValue: { flexShrink: 1, fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold", textAlign: "right" },
  actions: { flexDirection: "row", gap: 10, marginTop: 18 },
  button: { height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  decline: { flex: 1 },
  approve: { flex: 1.4 },
  buttonText: { fontSize: 15.5, lineHeight: 20, fontFamily: "Inter_700Bold" },
  foot: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 12 },
});
