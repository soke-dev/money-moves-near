import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/context/ThemeContext";
import { useApp } from "@/context/AppContext";
import { MMInput } from "@/components/MMInput";
import { MMButton } from "@/components/MMButton";
import { LoadingOverlay } from "@/components/LoadingOverlay";

export default function LoginScreen() {
  const colors = useColors();
  const { isDark, toggleTheme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { login, isPinSet } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const handleLogin = async () => {
    if (!email || !password) {
      setFormError("Please fill in all fields");
      return;
    }
    setLoading(true);
    try {
      await login(email, password);
      // Login sends a verification code — go to verify-email
      router.replace("/auth/verify-email");
    } catch (e: any) {
      console.log("Login error:", JSON.stringify(e?.response?.data || e?.message));
      const data = e?.response?.data;
      const msg = data?.details?.length
        ? data.details.map((d: any) => d.message).join(". ")
        : data?.error || "Invalid credentials";
      setFormError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.container,
          { paddingTop: topPad + 16, paddingBottom: bottomPad + 16 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace("/auth/onboarding")} style={styles.backBtn}>
            <Feather name="arrow-left" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TouchableOpacity
              onPress={toggleTheme}
              style={[styles.helpBtn, { borderColor: colors.border }]}
            >
              <Feather name={isDark ? "sun" : "moon"} size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.helpBtn, { borderColor: colors.border }]} onPress={() => router.push("/account/support")}>
              <Feather name="headphones" size={16} color={colors.mutedForeground} />
              <Text style={[styles.helpText, { color: colors.mutedForeground }]}>Help</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.titleSection}>
          <View style={[styles.pill, { backgroundColor: colors.muted }]}>
            <Text style={[styles.pillText, { color: colors.primary }]}>Welcome Back</Text>
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Log into your account
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Enter your email and password to access your Money Moves account.
          </Text>
        </View>

        <View style={styles.form}>
          <MMInput
            label="Email Address"
            placeholder="Type your email address"
            value={email}
            onChangeText={(v) => { setEmail(v); if (formError) setFormError(""); }}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <MMInput
            label="Password"
            placeholder="Type your password"
            value={password}
            onChangeText={(v) => { setPassword(v); if (formError) setFormError(""); }}
            isPassword
          />
          {formError ? <Text style={{ color: "#ef4444", fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 6 }}>{formError}</Text> : null}
          <TouchableOpacity style={styles.forgotBtn} onPress={() => router.push("/auth/forgot-password")}>
            <Text style={[styles.forgotText, { color: colors.foreground }]}>
              Forgot Password?
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <MMButton
            title="Login"
            loadingTitle="Signing you in"
            onPress={handleLogin}
            loading={loading}
          />
          <TouchableOpacity
            style={styles.signupBtn}
            onPress={() => router.push("/auth/register")}
          >
            <Text style={[styles.signupText, { color: colors.mutedForeground }]}>
              Don't have an account?{" "}
              <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }}>
                Create Account
              </Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <LoadingOverlay visible={loading} label="Signing you in" />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    gap: 32,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  backBtn: {
    padding: 4,
  },
  helpBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  helpText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  titleSection: {
    gap: 12,
  },
  pill: {
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  pillText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  title: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    lineHeight: 34,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  form: {
    gap: 16,
  },
  forgotBtn: {
    alignSelf: "flex-end",
  },
  forgotText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  footer: {
    gap: 16,
    marginTop: "auto",
  },
  signupBtn: {
    alignItems: "center",
  },
  signupText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});
