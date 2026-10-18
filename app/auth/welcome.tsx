import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform, Image } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/context/ThemeContext";

export default function WelcomeScreen() {
  const colors = useColors();
  const { isDark, toggleTheme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad + 20, paddingBottom: bottomPad + 24 }]}>

      {/* Theme toggle */}
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={toggleTheme}
          style={[styles.themeBtn, { borderColor: colors.border }]}
        >
          <Feather name={isDark ? "sun" : "moon"} size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      {/* Logo + name */}
      <View style={styles.logoArea}>
        <Image
          source={require("@/assets/images/logo-badge.png")}
          style={styles.logoImage}
          resizeMode="contain"
        />
        <Text style={[styles.appName, { color: colors.foreground }]}>Money Moves</Text>
        <Text style={[styles.tagline, { color: colors.mutedForeground }]}>
          Start Your <Text style={{ color: colors.primary, fontFamily: "Inter_700Bold" }}>Crypto</Text> Journey Today
        </Text>
        <Text style={[styles.subTagline, { color: colors.mutedForeground }]}>
          The fastest way to convert <Text style={{ color: colors.primary }}>crypto to cash</Text>.{"\n"}Wallet to bank & back in seconds.
        </Text>
      </View>

      {/* Feature list */}
      <View style={styles.features}>
        {[
          { icon: "zap" as const, text: "Instant crypto trading" },
          { icon: "lock" as const, text: "Secure savings plans" },
          { icon: "refresh-cw" as const, text: "Best exchange rates" },
        ].map((f, i) => (
          <View key={i} style={[styles.featureRow, { backgroundColor: colors.card }]}>
            <View style={[styles.featureIconWrap, { backgroundColor: colors.primary + "22" }]}>
              <Feather name={f.icon} size={18} color={colors.primary} />
            </View>
            <Text style={[styles.featureText, { color: colors.foreground }]}>{f.text}</Text>
          </View>
        ))}
      </View>

      {/* Buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.push("/auth/register")}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Create Account</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondaryBtn, { borderColor: colors.border }]}
          onPress={() => router.push("/auth/dynamic-onboarding")}
          activeOpacity={0.75}
        >
          <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Log In</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "space-between",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  themeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  logoArea: {
    alignItems: "center",
    paddingTop: 32,
    gap: 14,
  },
  logoImage: {
    width: 80,
    height: 80,
    borderRadius: 20,
  },
  appName: {
    fontSize: 30,
    fontFamily: "Inter_700Bold",
  },
  tagline: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
    lineHeight: 24,
  },
  subTagline: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  features: {
    gap: 10,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 14,
  },
  featureIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  actions: {
    gap: 12,
  },
  primaryBtn: {
    height: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  secondaryBtn: {
    height: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  secondaryBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});
