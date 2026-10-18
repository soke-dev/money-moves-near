import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
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
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { approveBusinessLink, declineBusinessLink, type BusinessLink } from "@/services/business-links";

/** Two letters for a business with no picture. "Ireti Crafts Ltd" is IC - the legal suffix says nothing about who it is. */
function initials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z0-9]+/, ""))
    .filter((w) => w && !/^(ltd|limited|plc|llc|inc|co|nig)\.?$/i.test(w));
  return (words.length ? words : [name]).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("") || "?";
}

/** When it was asked, the way people say it - the request lapses after a week, so days are as far as it goes. */
function askedAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? "An hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

/**
 * A business asking to be paid into this account, on Home, the moment it asks.
 *
 * Opened by Home whenever a request is waiting - on arrival, on coming back to
 * the app, and when the notification lands while it is open - so nobody has to
 * find the notification to answer it. Approve and Decline are side by side
 * because they are the two answers to the one question in the title; closing
 * it is "not now", and the request waits in Security > Linked businesses.
 *
 * A plain bottom sheet: it slides up from under the screen, without a bounce,
 * and sits on the bottom half over Home's blur (a dim on Android, which has
 * no real backdrop blur). Drag it down, tap outside or the cross to put it
 * away. The movement is React Native's own Animated on the native driver
 * rather than layout animations, and it slides out before it unmounts, so
 * nothing animates a view that is already gone.
 *
 * The marks at the top say it before the words do: this business, paying into
 * Money Moves - and, once approved, the tick lands on the Money Moves side.
 */
export function BusinessLinkSheet({
  requests,
  username,
  bottomInset,
  onAnswered,
  onLater,
}: {
  /** Waiting requests, oldest first. The sheet answers the first. */
  requests: BusinessLink[];
  username?: string | null;
  bottomInset: number;
  /** Approved or declined: take it off the list. */
  onAnswered: (id: string) => void;
  /** Closed without an answer. */
  onLater: () => void;
}) {
  const colors = useColors();
  const { height } = useWindowDimensions();
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [problem, setProblem] = useState("");
  // Just approved: says so, and where it lives now, before moving on.
  const [linked, setLinked] = useState<BusinessLink | null>(null);
  const [logoFailed, setLogoFailed] = useState<string | null>(null);
  const req = linked ?? requests[0];

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

  const done = () => {
    const id = linked?.id;
    if (!id) return;
    // More waiting: the next one takes this one's place without the sheet going anywhere.
    if (requests.some((r) => r.id !== id)) {
      setLinked(null);
      onAnswered(id);
      return;
    }
    slideAway(() => onAnswered(id));
  };

  const later = () => {
    if (busy) return;
    if (linked) return done();
    slideAway(onLater);
  };

  // Dragged down far enough, or flicked: away. Otherwise it settles back - eased, not sprung.
  // Claimed on touch start: inside a Modal on Android, a drag that waits for movement to
  // claim it is never offered the touch at all. The cross is deeper, so it keeps its taps.
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
  const more = requests.filter((r) => r.id !== req.id).length;

  const answer = async (how: "approve" | "decline") => {
    setBusy(how);
    setProblem("");
    try {
      if (how === "approve") {
        await approveBusinessLink(req.id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setLinked(req);
      } else {
        await declineBusinessLink(req.id);
        if (more) onAnswered(req.id);
        else slideAway(() => onAnswered(req.id));
      }
    } catch (e: any) {
      const status = e?.response?.status;
      // Answered somewhere else already, withdrawn by the business, or lapsed: nothing left to answer.
      if (status === 404 || status === 409) {
        if (more) onAnswered(req.id);
        else slideAway(() => onAnswered(req.id));
        return;
      }
      if (!e?.maintenanceHandled) setProblem(e?.response?.data?.error || "That didn't go through. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  };

  const flow = (approved: boolean) => (
    <View style={s.flow}>
      {req.businessLogo && logoFailed !== req.id ? (
        <Image source={{ uri: req.businessLogo }} onError={() => setLogoFailed(req.id)} resizeMode="contain" style={[s.mark, { backgroundColor: "#fff" }]} />
      ) : (
        <View style={[s.mark, { backgroundColor: colors.foreground }]}>
          <Text style={[s.markText, { color: colors.background }]}>{initials(req.businessName)}</Text>
        </View>
      )}
      <View style={s.link}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[s.dot, { backgroundColor: colors.mutedForeground }]} />
        ))}
        <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
      </View>
      <View>
        <Image source={require("@/assets/images/logo-badge.png")} style={[s.badge, { borderColor: colors.border }]} />
        {approved && (
          <View style={[s.tick, { backgroundColor: colors.primary, borderColor: colors.card }]}>
            <Feather name="check" size={11} color={colors.primaryForeground} />
          </View>
        )}
      </View>
    </View>
  );

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
          // Asking holds the bottom half so the answers sit low; once linked, it's only as tall as what it says.
          { backgroundColor: colors.card, minHeight: linked ? undefined : height * 0.5, paddingBottom: bottomInset + 18, transform: [{ translateY: y }] },
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
            {flow(!!linked)}
            <View style={{ flex: 1 }} />
            {!linked && requests.length > 1 && (
              <Text style={[s.count, { color: colors.mutedForeground }]}>1 of {requests.length}</Text>
            )}
            {!linked && (
              <TouchableOpacity onPress={later} style={[s.close, { backgroundColor: colors.muted }]} hitSlop={10} accessibilityLabel="Not now">
                <Feather name="x" size={17} color={colors.foreground} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {linked ? (
          <>
            <Text style={[s.title, { color: colors.foreground }]}>{linked.businessName} is linked</Text>
            <Text style={[s.body, { color: colors.mutedForeground }]}>
              Its payments now land in your Money Moves account. To unlink it, go to Account, then Security.
            </Text>
            <TouchableOpacity style={[s.button, s.wide, { backgroundColor: colors.primary }]} onPress={done} activeOpacity={0.85}>
              <Text style={[s.buttonText, { color: colors.primaryForeground }]}>{more ? "Next request" : "Done"}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={[s.title, { color: colors.foreground }]}>Let {req.businessName} pay into your account?</Text>
            <Text style={[s.body, { color: colors.mutedForeground }]}>
              When its customers pay, the money lands in your Money Moves account. It can't see your balance or take anything out.
            </Text>

            <View style={[s.facts, { backgroundColor: colors.background }]}>
              {[
                ["Pays into", username ? `@${username}` : "This account"],
                ["Merchant ID", req.merchantId],
                ["Asked", askedAgo(req.createdAt)],
              ].map(([k, v], i, all) => (
                <View key={k} style={[s.fact, i < all.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
                  <Text style={[s.factKey, { color: colors.mutedForeground }]}>{k}</Text>
                  <Text style={[s.factValue, { color: colors.foreground }]} numberOfLines={1}>
                    {v}
                  </Text>
                </View>
              ))}
            </View>

            {!!problem && <Text style={[s.problem, { color: colors.destructive }]}>{problem}</Text>}

            <View style={{ flex: 1 }} />
            <View style={s.actions}>
              <TouchableOpacity
                style={[s.button, s.decline, { backgroundColor: colors.muted }]}
                onPress={() => void answer("decline")}
                disabled={!!busy}
                activeOpacity={0.8}
              >
                {busy === "decline" ? (
                  <ActivityIndicator size="small" color={colors.foreground} />
                ) : (
                  <Text style={[s.buttonText, { color: colors.foreground }]}>Decline</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.button, s.approve, { backgroundColor: colors.primary }]}
                onPress={() => void answer("approve")}
                disabled={!!busy}
                activeOpacity={0.85}
              >
                {busy === "approve" ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <Text style={[s.buttonText, { color: colors.primaryForeground }]}>Approve</Text>
                )}
              </TouchableOpacity>
            </View>
            <Text style={[s.foot, { color: colors.mutedForeground }]}>
              Only approve a business you know. You can unlink it any time in Security.
            </Text>
          </>
        )}
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
  flow: { flexDirection: "row", alignItems: "center" },
  // Solid, not a tint: it stands for the business, the way a logo would.
  mark: { width: 48, height: 48, borderRadius: 15, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  markText: { fontSize: 17, lineHeight: 22, fontFamily: "Inter_700Bold", letterSpacing: 0.3 },
  badge: { width: 48, height: 48, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth },
  link: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 9 },
  dot: { width: 3.5, height: 3.5, borderRadius: 2, opacity: 0.55 },
  tick: {
    position: "absolute",
    right: -5,
    bottom: -5,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2.5,
    alignItems: "center",
    justifyContent: "center",
  },
  count: { fontSize: 12.5, lineHeight: 16, fontFamily: "Inter_500Medium" },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 21, lineHeight: 27, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  body: { fontSize: 13.5, lineHeight: 20, fontFamily: "Inter_400Regular", marginTop: 6 },
  facts: { borderRadius: 16, paddingHorizontal: 14, marginTop: 16 },
  fact: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, paddingVertical: 11 },
  factKey: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  factValue: { flexShrink: 1, fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold", textAlign: "right" },
  problem: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium", marginTop: 12 },
  actions: { flexDirection: "row", gap: 10, marginTop: 18 },
  button: { height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  decline: { flex: 1 },
  approve: { flex: 1.4 },
  wide: { marginTop: 20 },
  buttonText: { fontSize: 15.5, lineHeight: 20, fontFamily: "Inter_700Bold" },
  foot: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 12 },
});
