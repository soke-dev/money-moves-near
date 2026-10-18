import React, { useState } from "react";
import {
  View,
  TextInput,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInputProps,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface MMInputProps extends TextInputProps {
  label?: string;
  error?: string;
  isPassword?: boolean;
}

export function MMInput({ label, error, isPassword, style, ...props }: MMInputProps) {
  const colors = useColors();
  const [showPassword, setShowPassword] = useState(false);

  return (
    <View style={styles.container}>
      {label && (
        <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      )}
      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: colors.input,
            borderColor: error ? colors.destructive : colors.border,
          },
        ]}
      >
        <TextInput
          style={[
            styles.input,
            { color: colors.foreground },
            style,
          ]}
          placeholderTextColor={colors.mutedForeground}
          secureTextEntry={isPassword && !showPassword}
          {...props}
        />
        {isPassword && (
          <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
            <Feather
              name={showPassword ? "eye" : "eye-off"}
              size={20}
              color={colors.mutedForeground}
            />
          </TouchableOpacity>
        )}
      </View>
      {error && (
        <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 54,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  error: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
});
