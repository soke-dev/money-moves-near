import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

/**
 * The parts of the torn receipt the confirm screens are built from.
 *
 * Four screens ask the same two questions - who is this going to, and what
 * does it cost me - and they answered with four different arrangements of
 * label-and-value rows. They share one shape now, and these are the pieces of
 * it that are worth not writing twice.
 */

/** Figures on a slip are monospaced, the way a printed receipt sets them. */
export const SLIP_MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});

/**
 * A dotted or dashed rule, laid down segment by segment.
 *
 * `borderStyle: "dotted"` and `"dashed"` are not dependable in React Native. A
 * border that is thick on one side only - which is what a horizontal rule is -
 * renders solid on some platforms and, on iOS, not at all. Both rules on the
 * first slip were simply absent until this replaced them.
 *
 * So the segments are Views. Enough of them to overrun any phone are laid down
 * and the row clips the remainder, which means the rule fills whatever width
 * it is given without anyone having to measure it first.
 */
export function DashedRule({
  color,
  dash,
  gap,
  thickness,
  round,
}: {
  color: string;
  dash: number;
  gap: number;
  thickness: number;
  /** Round caps, for a dotted leader rather than a dashed tear. */
  round?: boolean;
}) {
  return (
    <View style={s.rule}>
      {Array.from({ length: 80 }).map((_, i) => (
        <View
          key={i}
          style={{
            width: dash,
            height: thickness,
            marginRight: gap,
            backgroundColor: color,
            borderRadius: round ? thickness / 2 : 0,
          }}
        />
      ))}
    </View>
  );
}

/**
 * A label run out to its figure on a line of dots.
 *
 * The rule is its own View rather than a dotted underline on the label,
 * because an underline stops where the words stop - it has to span whatever is
 * left between them, which only a flexed element can do.
 */
export function LeaderRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: any;
}) {
  return (
    <View style={s.leader}>
      <Text style={[s.leaderLabel, { color: colors.mutedForeground }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={s.leaderDots}>
        <DashedRule color={colors.border} dash={2} gap={3} thickness={2} round />
      </View>
      <Text style={[s.leaderValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  // Clipped, because the rule always lays down more segments than it needs.
  rule: { flexDirection: "row", alignItems: "center", overflow: "hidden" },

  leader: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  leaderLabel: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", flexShrink: 1 },
  leaderDots: { flex: 1, minWidth: 12 },
  leaderValue: { fontSize: 12.5, lineHeight: 17, fontFamily: SLIP_MONO },
});
