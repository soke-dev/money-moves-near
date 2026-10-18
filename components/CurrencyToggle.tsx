import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";

export type AmountCurrency = "NGN" | "USD";

/**
 * Compact two-segment toggle to switch an amount input between Naira and its
 * USD equivalent. Presentational only — conversion lives in the parent screen.
 */
export function CurrencyToggle({
  value,
  onChange,
  disabled,
}: {
  value: AmountCurrency;
  onChange: (c: AmountCurrency) => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={[styles.wrap, { backgroundColor: colors.background, borderColor: colors.border, opacity: disabled ? 0.5 : 1 }]}>
      {(["NGN", "USD"] as const).map((c) => {
        const active = value === c;
        return (
          <TouchableOpacity
            key={c}
            onPress={() => !disabled && onChange(c)}
            disabled={disabled}
            style={[styles.seg, active && { backgroundColor: colors.primary }]}
            activeOpacity={0.8}
          >
            <Text style={[styles.segText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>{c}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", borderRadius: 8, borderWidth: 1, padding: 2 },
  seg: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 },
  segText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
