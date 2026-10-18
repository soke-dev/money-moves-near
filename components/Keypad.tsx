import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
  StyleProp,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";

interface KeypadProps {
  /** A digit, or "." when `decimal` is on. */
  onKey: (key: string) => void;
  onBackspace: () => void;
  /** Adds a decimal point in the bottom-left. Off for whole-naira amounts. */
  decimal?: boolean;
  /** Greys the keys out without unmounting, so the layout does not jump. */
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The app's own number pad.
 *
 * The system keypad is a separate window the app does not control, which is
 * why every screen that raised one ended up fighting it - covering a sheet,
 * resisting measurement inside a Modal, behaving differently on each platform.
 * This is just views, so it sits in the layout like anything else and can never
 * cover what it belongs to.
 *
 * It also means a PIN is never typed into a TextInput, so nothing offers to
 * autofill, autocorrect or remember it.
 */
export function Keypad({ onKey, onBackspace, decimal = false, disabled = false, style }: KeypadProps) {
  const colors = useColors();

  const press = (fn: () => void) => () => {
    if (disabled) return;
    Haptics.selectionAsync();
    fn();
  };

  const Key = ({ label, onPress }: { label: React.ReactNode; onPress: () => void }) => (
    <TouchableOpacity
      style={[s.key, { backgroundColor: colors.muted }, disabled && s.keyOff]}
      onPress={press(onPress)}
      activeOpacity={0.6}
      disabled={disabled}
    >
      {typeof label === "string" ? (
        <Text style={[s.keyText, { color: colors.foreground }]}>{label}</Text>
      ) : (
        label
      )}
    </TouchableOpacity>
  );

  return (
    <View style={[s.pad, style]}>
      {[
        ["1", "2", "3"],
        ["4", "5", "6"],
        ["7", "8", "9"],
      ].map((row) => (
        <View key={row[0]} style={s.row}>
          {row.map((d) => (
            <Key key={d} label={d} onPress={() => onKey(d)} />
          ))}
        </View>
      ))}

      <View style={s.row}>
        {decimal ? (
          <Key label="." onPress={() => onKey(".")} />
        ) : (
          // An empty cell rather than a missing one, so 0 stays centred.
          <View style={s.key} />
        )}
        <Key label="0" onPress={() => onKey("0")} />
        <Key
          label={<Feather name="delete" size={22} color={colors.foreground} />}
          onPress={onBackspace}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  pad: { gap: 10 },
  row: { flexDirection: "row", gap: 10 },
  key: {
    flex: 1,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  keyOff: { opacity: 0.4 },
  // Tabular figures would be ideal here; at this size the difference between
  // Inter's proportional digits is small enough not to shift the grid.
  keyText: { fontSize: 24, lineHeight: 30, fontFamily: "Inter_600SemiBold" },
});
