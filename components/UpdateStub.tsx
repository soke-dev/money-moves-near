import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, AppState, Platform } from "react-native";
import * as Updates from "expo-updates";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { DashedRule, SLIP_MONO } from "@/components/Slip";
import { openStore, storeUpdateAvailable, subscribeStoreUpdate } from "@/services/store-update";

/**
 * The strip that says a new update has landed.
 *
 * The app launches on whatever bundle it already has and fetches the new one
 * in the background, so a change reaches people on their *second* launch -
 * open, close, open. Nobody was told that, so they were being asked to do it
 * by hand.
 *
 * This fetches the same way and then offers the restart, so it lands in the
 * session someone is already in. Offered, never taken: reloading on its own
 * while a transaction is being signed would be the worst moment there is.
 *
 * It only mounts on Home for the same reason - it is the one screen where
 * nothing is half-finished - and it only appears once the download has
 * completed, so tapping restarts straight into the new bundle rather than
 * waiting on the network with the screen already gone.
 */

/** The tab bar is 66 tall and sits on the safe-area inset. */
const BAR_H = 66;

export default function UpdateStub() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const [restarting, setRestarting] = useState(false);

  /**
   * A build on the stores that this one cannot become.
   *
   * An update over the air only reaches installs on its own runtime version,
   * and the runtime version is the app version - so once a new store build is
   * out, everybody on the previous one is past the reach of anything we
   * publish. Restarting will not help them. The only move left is to ask them
   * to fetch it, and to take them there.
   *
   * It outranks the restart below: a bundle we can still deliver is worth
   * less than the build we cannot.
   */
  const [storeVersion, setStoreVersion] = useState<string | null>(storeUpdateAvailable());
  useEffect(() => subscribeStoreUpdate(setStoreVersion), []);
  // One check in flight at a time, and none at all once one has landed.
  const busy = useRef(false);

  const look = useCallback(async () => {
    // Nothing to fetch in development - the bundle comes from Metro - and
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
      // A failed check is not worth telling anyone about: the update will be
      // picked up on the next launch exactly as it was before this existed.
    } finally {
      busy.current = false;
    }
  }, [ready]);

  useEffect(() => {
    look();
    // And again whenever the app comes back, which is when a publish that
    // happened while it was away would be waiting.
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") look();
    });
    return () => sub.remove();
  }, [look]);

  if (!ready && !storeVersion) return null;

  const toStore = !!storeVersion;

  return (
    <View
      style={[s.wrap, { bottom: (insets.bottom > 0 ? insets.bottom - 6 : 16) + BAR_H + 10 }]}
      pointerEvents="box-none"
    >
      {/* The torn slip the confirm screens are built from, carrying an update
          instead of an amount. The notches are circles painted in the screen's
          own background, not holes, so nothing may sit behind this. */}
      <TouchableOpacity
        style={[s.stub, { backgroundColor: colors.card }]}
        onPress={async () => {
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
        }}
        activeOpacity={0.85}
      >
        <View style={s.tear}>
          <View style={[s.notch, { left: -8, backgroundColor: colors.background }]} />
          <View style={s.rule}>
            <DashedRule color={colors.border} dash={5} gap={4} thickness={1.5} />
          </View>
          <View style={[s.notch, { right: -8, backgroundColor: colors.background }]} />
        </View>

        <View style={s.row}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.cap, { color: colors.mutedForeground }]}>
              {toStore ? `VERSION ${storeVersion} IS OUT` : "UPDATE READY"}
            </Text>
            <Text style={[s.line, { color: colors.primary }]} numberOfLines={1}>
              {toStore
                ? "Get it from the store"
                : restarting
                  ? "Restarting…"
                  : "Restart to pick it up"}
            </Text>
          </View>
          <Text style={[s.go, { color: colors.primary, opacity: !toStore && restarting ? 0.5 : 1 }]}>
            {toStore ? "UPDATE" : "RESTART"}
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16 },

  stub: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingBottom: 13,
    // The notches are painted over the card's own edges, so nothing may
    // overflow past it.
    overflow: "hidden",
  },

  // Height is the notch, so the circles sit centred on the line.
  tear: { height: 16, marginHorizontal: -14, justifyContent: "center" },
  rule: { marginHorizontal: 10 },
  notch: { position: "absolute", top: 0, width: 16, height: 16, borderRadius: 8 },

  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  cap: { fontSize: 8.5, lineHeight: 12, fontFamily: SLIP_MONO, letterSpacing: 1.7 },
  line: { fontSize: 12, lineHeight: 16, fontFamily: SLIP_MONO, marginTop: 5 },
  go: { fontSize: 10.5, lineHeight: 14, fontFamily: SLIP_MONO, letterSpacing: 1.2, paddingTop: 2 },
});
