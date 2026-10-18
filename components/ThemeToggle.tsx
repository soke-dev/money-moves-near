import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Animated, Image } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useTheme, type ThemePreference } from "@/context/ThemeContext";

const OPTIONS: { key: ThemePreference; label: string; icon: any }[] = [
  { key: "light", label: "Light", icon: "sun" },
  { key: "dark", label: "Dark", icon: "moon" },
  { key: "system", label: "Device", icon: "smartphone" },
];

/** Breathing room between the track and the thumb inside it. */
const PAD = 4;
const TRACK_H = 46;

/**
 * Appearance, as a segmented control rather than a flip.
 *
 * A single sun/moon button could only ever say "the other one", which left
 * "follow my device" unreachable and never showed which of the three was in
 * force. Three segments show the current choice at rest, and the thumb slides
 * between them so the change reads as movement instead of a repaint.
 */
export default function ThemeToggle() {
  const colors = useColors();
  const { preference, setPreference, isDark } = useTheme();
  const [trackW, setTrackW] = useState(0);

  const index = Math.max(0, OPTIONS.findIndex((o) => o.key === preference));
  const segW = trackW > 0 ? (trackW - PAD * 2) / OPTIONS.length : 0;

  const x = useRef(new Animated.Value(0)).current;
  // The first placement is where the thumb already belongs, so it must not
  // animate in from the left edge on mount.
  const placed = useRef(false);

  useEffect(() => {
    if (!segW) return;
    const to = PAD + index * segW;
    if (!placed.current) {
      x.setValue(to);
      placed.current = true;
      return;
    }
    Animated.spring(x, {
      toValue: to,
      useNativeDriver: true,
      speed: 16,
      bounciness: 7,
    }).start();
  }, [index, segW, x]);

  const subtitle =
    preference === "system"
      ? `Following your device \u00B7 ${isDark ? "Dark" : "Light"}`
      : preference === "dark"
        ? "Always dark"
        : "Always light";

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: colors.muted }]}>
          {/* The drawn mark the rest of the column uses, tinted to match it.
              It does not swap with the theme any more: the row already says
              which mode is on, twice - in the subtitle and in the segment the
              thumb is sitting on - and a glyph that changed underneath them
              read as a third control rather than a label. */}
          <Image
            source={require("@/assets/images/night-mode.png")}
            style={[styles.mark, { tintColor: colors.mutedForeground }]}
            resizeMode="contain"
          />
        </View>
        <View style={styles.headText}>
          <Text style={[styles.title, { color: colors.foreground }]}>Appearance</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </View>

      <View
        style={[styles.track, { backgroundColor: colors.muted }]}
        onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
      >
        {segW > 0 && (
          <Animated.View
            style={[
              styles.thumb,
              {
                width: segW,
                backgroundColor: colors.background,
                borderColor: colors.border,
                transform: [{ translateX: x }],
              },
            ]}
          />
        )}

        {OPTIONS.map((o) => {
          const on = o.key === preference;
          return (
            <Pressable
              key={o.key}
              style={styles.seg}
              onPress={() => setPreference(o.key)}
              // The thumb carries the press feedback by moving, so the segment
              // itself does not also dim.
              android_ripple={null}
              hitSlop={4}
            >
              <Feather
                name={o.icon}
                size={14}
                color={on ? colors.foreground : colors.mutedForeground}
              />
              <Text
                style={[styles.segText, { color: on ? colors.foreground : colors.mutedForeground }]}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 14, paddingTop: 13, paddingBottom: 14 },
  head: { flexDirection: "row", alignItems: "center", gap: 13 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  // 18, the size the account rows draw their marks at.
  mark: { width: 18, height: 18 },
  headText: { flex: 1 },
  title: { fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  sub: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular", marginTop: 1 },

  track: { flexDirection: "row", height: TRACK_H, borderRadius: 14, padding: PAD, marginTop: 12 },
  thumb: {
    position: "absolute",
    top: PAD,
    left: 0,
    bottom: PAD,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
  seg: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  segText: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
});
