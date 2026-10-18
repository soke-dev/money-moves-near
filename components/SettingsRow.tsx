/**
 * The settings row, shared by the screens that list one.
 *
 * Security and Notifications had their own copies that drifted apart - one
 * with circular icon tiles, one with rounded squares, one animating its switch
 * and one snapping it. A settings list should look the same wherever it is.
 */
import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image, Animated } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

/** A switch that moves, rather than jumping between two positions. */
export function SettingToggle({
  on,
  onToggle,
  disabled,
}: {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  const x = useRef(new Animated.Value(on ? 20 : 2)).current;

  useEffect(() => {
    Animated.spring(x, { toValue: on ? 20 : 2, useNativeDriver: true, speed: 20, bounciness: 4 }).start();
  }, [on, x]);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onToggle}
      disabled={disabled}
      style={[s.toggle, { backgroundColor: on ? colors.primary : colors.muted }, disabled && s.toggleOff]}
    >
      <Animated.View style={[s.toggleThumb, { transform: [{ translateX: x }] }]} />
    </TouchableOpacity>
  );
}

export function SettingRow({
  img,
  mark,
  title,
  subtitle,
  onPress,
  right,
  last,
}: {
  /** A drawn mark, tinted to sit in one column with the others. */
  img?: any;
  /** For the few marks no PNG covers - a glyph, a letter. Replaces `img`. */
  mark?: React.ReactNode;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  /** A switch, a value, anything that is not a chevron. */
  right?: React.ReactNode;
  last?: boolean;
}) {
  const colors = useColors();

  const body = (
    <>
      {/* A rounded square, so the column keeps one width whatever the mark is. */}
      <View style={[s.icon, { backgroundColor: colors.muted }]}>
        {mark ?? (
          <Image
            source={img}
            style={[s.mark, { tintColor: colors.mutedForeground }]}
            resizeMode="contain"
          />
        )}
      </View>
      <View style={s.text}>
        <Text style={[s.title, { color: colors.foreground }]}>{title}</Text>
        {!!subtitle && (
          <Text style={[s.sub, { color: colors.mutedForeground }]} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {right ?? <Feather name="chevron-right" size={18} color={colors.mutedForeground} />}
    </>
  );

  const style = [
    s.row,
    !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  ];

  return onPress ? (
    <TouchableOpacity style={style} onPress={onPress} activeOpacity={0.7}>
      {body}
    </TouchableOpacity>
  ) : (
    <View style={style}>{body}</View>
  );
}

/** A labelled group of rows. */
export function SettingGroup({ label, children }: { label: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <>
      <Text style={[s.groupLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={[s.card, { backgroundColor: colors.card }]}>{children}</View>
    </>
  );
}

const s = StyleSheet.create({
  groupLabel: {
    fontSize: 10.5,
    lineHeight: 14,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.1,
    marginTop: 22,
    marginBottom: 8,
    marginLeft: 22,
  },
  card: { marginHorizontal: 16, borderRadius: 18, paddingHorizontal: 14 },

  row: { flexDirection: "row", alignItems: "center", gap: 13, paddingVertical: 13 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  mark: { width: 18, height: 18 },
  text: { flex: 1 },
  title: { fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  sub: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular", marginTop: 1 },

  toggle: { width: 44, height: 26, borderRadius: 13, justifyContent: "center" },
  toggleOff: { opacity: 0.5 },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" },
});
