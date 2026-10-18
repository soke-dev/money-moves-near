import React from "react";
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  View,
  ViewStyle,
  TextStyle,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { WorkingDots } from "@/components/WorkingDots";

interface MMButtonProps {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "outline" | "ghost";
  loading?: boolean;
  /**
   * What to say while `loading`. Defaults to `title`, so a button that says
   * nothing new still says something - it never goes blank.
   */
  loadingTitle?: string;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export function MMButton({
  title,
  onPress,
  variant = "primary",
  loading = false,
  loadingTitle,
  disabled = false,
  style,
  textStyle,
}: MMButtonProps) {
  const colors = useColors();

  const getButtonStyle = () => {
    switch (variant) {
      case "primary":
        return {
          backgroundColor: colors.primary,
          borderWidth: 0,
        };
      case "secondary":
        return {
          backgroundColor: colors.secondary,
          borderWidth: 0,
        };
      case "outline":
        return {
          backgroundColor: "transparent",
          borderWidth: 1.5,
          borderColor: colors.border,
        };
      case "ghost":
        return {
          backgroundColor: "transparent",
          borderWidth: 0,
        };
    }
  };

  const getTextStyle = () => {
    switch (variant) {
      case "primary":
        return { color: colors.primaryForeground };
      case "secondary":
        return { color: colors.secondaryForeground };
      case "outline":
        return { color: colors.foreground };
      case "ghost":
        return { color: colors.foreground };
    }
  };

  // The dots have to match whatever the label ends up being, including a
  // colour a caller passed in through `textStyle`.
  const labelColor =
    (textStyle?.color as string | undefined) ?? getTextStyle()?.color ?? colors.foreground;

  return (
    <TouchableOpacity
      style={[
        styles.button,
        getButtonStyle(),
        // Dimmed for `disabled` but not for `loading`: a button that is working
        // is not a button that is unavailable, and fading it says the wrong
        // thing at the one moment the person is watching it.
        disabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
    >
      <View style={styles.inner}>
        <Text style={[styles.text, getTextStyle(), textStyle]}>
          {loading ? (loadingTitle ?? title) : title}
        </Text>
        {loading && <WorkingDots color={labelColor} />}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  text: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  disabled: {
    opacity: 0.5,
  },
});
