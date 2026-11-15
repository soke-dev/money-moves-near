import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, AppState, Platform, Modal, Animated, Easing, useWindowDimensions } from "react-native";
import * as Updates from "expo-updates";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import { openStore, storeUpdateAvailable, subscribeStoreUpdate } from "@/services/store-update";

/**
 * The update prompt.
 *
 * The app launches on whatever bundle it already has and fetches the new one
 * in the background, so a change would otherwise reach people only on their
 * *second* launch. This fetches the same way and, once the download has
 * finished, raises a sheet over Home whose only way forward is the button:
 * no close, no swipe, no tap outside, and Android's back does nothing.
 *
 * It mounts on Home alone, the one screen where nothing is half finished, so
 * insisting on the restart never interrupts a payment being signed. When a new
 * store build is out (one this bundle can't become over the air), the same
 * sheet sends people to the store instead.
 */

const LIME = "#81FB02";
const LIME_DEEP = "#4FA300";
const MINT = "#D6FFA8";
const INK = "#151A10";

export default function UpdateStub() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [ready, setReady] = useState(false);
  const [restarting, setRestarting] = useState(false);

  /** A build on the stores that this one cannot become; it outranks the restart. */
  const [storeVersion, setStoreVersion] = useState<string | null>(storeUpdateAvailable());
  useEffect(() => subscribeStoreUpdate(setStoreVersion), []);
  // One check in flight at a time, and none at all once one has landed.
  const busy = useRef(false);

  const look = useCallback(async () => {
    // Nothing to fetch in development (the bundle comes from Metro), and
    // expo-updates is inert there, so this would only throw.
    if (__DEV__ || Platform.OS === "web" || !Updates.isEnabled) return;
    if (busy.current || ready) return;
    busy.current = true;
    try {
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) return;
      const fetched = await Updates.fetchUpdateAsync();
      // isNew is false when what came back is what is already running.
      if (fetched.isNew) setReady(true);
    } catch {
      // A failed check isn't worth telling anyone about: the update is picked
      // up on the next launch exactly as it was before this existed.
    } finally {
      busy.current = false;
    }
  }, [ready]);

  useEffect(() => {
    look();
    // And again whenever the app comes back, which is when a publish made
    // while it was away would be waiting.
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") look();
    });
    return () => sub.remove();
  }, [look]);

  const visible = ready || !!storeVersion;
  const toStore = !!storeVersion;

  // The scrim fades, the sheet rises with a little give, the picture pops a beat after.
  const scrim = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    scrim.setValue(0);
    rise.setValue(0);
    pop.setValue(0);
    Animated.parallel([
      Animated.timing(scrim, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(rise, { toValue: 1, damping: 14, stiffness: 140, mass: 0.9, useNativeDriver: true }),
      Animated.sequence([Animated.delay(160), Animated.spring(pop, { toValue: 1, damping: 9, stiffness: 180, useNativeDriver: true })]),
    ]).start();
  }, [visible, scrim, rise, pop]);

  if (!visible) return null;

  const go = async () => {
    if (toStore) {
      openStore();
      return;
    }
    if (restarting) return;
    setRestarting(true);
    try {
      await Updates.reloadAsync();
    } catch {
      setRestarting(false);
    }
  };

  const store = Platform.OS === "ios" ? "the App Store" : "Google Play";
  const art = Math.min(150, width * 0.38);

  return (
    // onRequestClose does nothing on purpose: Android's back can't dismiss it.
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => {}}>
      <Animated.View style={[StyleSheet.absoluteFill, s.scrim, { opacity: scrim }]} />
      <View style={s.fill} pointerEvents="box-none">
        <Animated.View
          style={[
            s.sheet,
            {
              backgroundColor: colors.card,
              marginBottom: Math.max(insets.bottom, 12),
              paddingTop: art * 0.62,
              transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [520, 0] }) }],
            },
          ]}
        >
          {/* The picture sits half above the sheet's edge. */}
          <Animated.View
            style={[
              s.art,
              {
                width: art,
                height: art,
                top: -art * 0.42,
                marginLeft: -art / 2,
                opacity: pop,
                transform: [
                  { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
                  { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) },
                ],
              },
            ]}
          >
            {toStore ? <StoreArt size={art} /> : <RestartArt size={art} />}
          </Animated.View>

          <Text style={[s.cap, { color: colors.mutedForeground }]}>{toStore ? `VERSION ${storeVersion} IS OUT` : "UPDATE READY"}</Text>
          <Text style={[s.title, { color: colors.foreground }]}>{toStore ? "Get the new Money Moves" : "A fresher Money Moves is ready"}</Text>
          <Text style={[s.body, { color: colors.mutedForeground }]}>
            {toStore
              ? `This update comes from ${store}. Update to keep getting the newest features.`
              : "Restart to get the newest features and fixes. It only takes a second."}
          </Text>

          <Pressable
            onPress={go}
            style={({ pressed }) => [s.btn, { opacity: restarting ? 0.7 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
          >
            <Ionicons name={toStore ? "download-outline" : "refresh"} size={20} color={INK} />
            <Text style={s.btnText}>{toStore ? "Update now" : restarting ? "Restarting…" : "Restart now"}</Text>
          </Pressable>

          <View style={s.note}>
            <Ionicons name="shield-checkmark-outline" size={13} color={colors.mutedForeground} />
            <Text style={[s.noteText, { color: colors.mutedForeground }]}>Your money and settings stay just as they are.</Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** The app on a phone mid refresh: arrows going round it, the new version arriving on its screen. */
function RestartArt({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 160 160">
      <Circle cx={80} cy={84} r={64} fill={MINT} />
      <Path d="M30 70a52 52 0 0 1 86-30" fill="none" stroke={LIME_DEEP} strokeWidth={8} strokeLinecap="round" />
      <Path d="M110 28l8 14-16 2z" fill={LIME_DEEP} />
      <Path d="M130 98a52 52 0 0 1-86 30" fill="none" stroke={LIME_DEEP} strokeWidth={8} strokeLinecap="round" />
      <Path d="M50 140l-8-14 16-2z" fill={LIME_DEEP} />
      <Rect x={54} y={38} width={52} height={92} rx={12} fill={INK} />
      <Rect x={59} y={46} width={42} height={76} rx={6} fill={LIME} />
      <Rect x={72} y={41} width={16} height={3} rx={1.5} fill="#2C3326" />
      <Path d="M80 98V66M68 78l12-12 12 12" fill="none" stroke={INK} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
      <Rect x={66} y={106} width={28} height={6} rx={3} fill={INK} opacity={0.25} />
      <Rect x={66} y={106} width={18} height={6} rx={3} fill={INK} />
      <Path d="M128 40l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#FFFFFF" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <Path d="M28 106l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill={LIME} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <Circle cx={136} cy={118} r={4} fill={INK} />
      <Circle cx={22} cy={58} r={3} fill={LIME_DEEP} />
    </Svg>
  );
}

/** The new version arriving from the store: a box opening with the app above it. */
function StoreArt({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 160 160">
      <Circle cx={80} cy={84} r={64} fill={MINT} />
      <Path d="M34 78l46-22 46 22-46 22z" fill={LIME} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <Path d="M34 78v42l46 22v-42z" fill={LIME_DEEP} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <Path d="M126 78v42l-46 22v-42z" fill={LIME} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <Path d="M34 78l-12 18 46 22 12-18z" fill={MINT} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <Path d="M126 78l12 18-46 22-12-18z" fill={MINT} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <Rect x={62} y={18} width={36} height={36} rx={10} fill={INK} />
      <Path d="M71 43c1-6 3-10 5-10s3 4 4 7c1-3 2-7 4-7s4 4 5 10" fill="none" stroke={LIME} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M80 58v10" stroke={INK} strokeWidth={3} strokeLinecap="round" strokeDasharray="2 5" />
      <Path d="M128 34l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#FFFFFF" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <Path d="M30 38l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill={LIME} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <Circle cx={138} cy={112} r={4} fill={INK} />
    </Svg>
  );
}

const s = StyleSheet.create({
  scrim: { backgroundColor: "rgba(0,0,0,0.55)" },
  fill: { flex: 1, justifyContent: "flex-end", paddingHorizontal: 12 },
  sheet: { borderRadius: 30, paddingHorizontal: 22, paddingBottom: 18, alignItems: "center" },
  art: { position: "absolute", left: "50%" },
  cap: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1.6, marginTop: 4 },
  title: { fontSize: 28, lineHeight: 32, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.9, textAlign: "center", marginTop: 8 },
  body: { fontSize: 15, lineHeight: 21, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 8, maxWidth: 320 },
  btn: { marginTop: 20, alignSelf: "stretch", height: 56, borderRadius: 28, backgroundColor: LIME, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  btnText: { fontSize: 16.5, fontFamily: "Inter_800ExtraBold", color: INK, letterSpacing: -0.2 },
  note: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  noteText: { fontSize: 12.5, fontFamily: "Inter_400Regular" },
});
