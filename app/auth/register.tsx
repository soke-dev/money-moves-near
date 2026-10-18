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
  Linking,
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

type Step = "profile" | "credentials";

export default function RegisterScreen() {
  const colors = useColors();
  const { isDark, toggleTheme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { register } = useApp();
  const [step, setStep] = useState<Step>("profile");
  const [loading, setLoading] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [referral, setReferral] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileError, setProfileError] = useState("");
  const [credError, setCredError] = useState("");

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const handleProfileNext = () => {
    if (!firstName || !lastName) {
      setProfileError("Please fill in required fields");
      return;
    }
    setProfileError("");
    setStep("credentials");
  };

  const handleRegister = async () => {
    if (!email || !password || !confirmPassword) {
      setCredError("Please fill in all fields");
      return;
    }
    if (password !== confirmPassword) {
      setCredError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await register({ firstName, lastName, email, password, referralCode: referral || undefined });
      router.replace("/auth/verify-email");
    } catch (e: any) {
      const data = e?.response?.data;
      const msg = data?.details?.length
        ? data.details.map((d: any) => d.message).join(". ")
        : data?.error || "Registration failed";
      setCredError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.container,
          { paddingTop: topPad + 16, paddingBottom: bottomPad + 100 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => (step === "credentials" ? setStep("profile") : router.back())}
            style={styles.backBtn}
          >
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
          <View style={[styles.pill, { backgroundColor: colors.primary + "22" }]}>
            <Text style={[styles.pillText, { color: colors.primary }]}>
              Create your profile
            </Text>
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {step === "profile" ? "Tell us about yourself" : "Create Login Details"}
          </Text>
          <TouchableOpacity onPress={() => router.push("/auth/dynamic-onboarding")}>
            <Text style={[styles.loginLink, { color: colors.mutedForeground }]}>
              I have an account?{" "}
              <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", textDecorationLine: "underline" }}>
                Login
              </Text>
            </Text>
          </TouchableOpacity>
        </View>

        {step === "profile" ? (
          <View style={styles.form}>
            <MMInput
              label="First Name"
              placeholder="Type your first name"
              value={firstName}
              onChangeText={(v) => { setFirstName(v); if (profileError) setProfileError(""); }}
            />
            <MMInput
              label="Last Name"
              placeholder="Type your last name"
              value={lastName}
              onChangeText={(v) => { setLastName(v); if (profileError) setProfileError(""); }}
            />

            <MMInput
              label="Referral code (Optional)"
              placeholder="Enter referral code"
              value={referral}
              onChangeText={setReferral}
            />
            {profileError ? <Text style={{ color: "#ef4444", fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 6 }}>{profileError}</Text> : null}
          </View>
        ) : (
          <View style={styles.form}>
            <MMInput
              label="Email Address"
              placeholder="Type your email address"
              value={email}
              onChangeText={(v) => { setEmail(v); if (credError) setCredError(""); }}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <MMInput
              label="Password"
              placeholder="Enter a password"
              value={password}
              onChangeText={(v) => { setPassword(v); if (credError) setCredError(""); }}
              isPassword
            />
            <MMInput
              label="Confirm Password"
              placeholder="Re-enter password"
              value={confirmPassword}
              onChangeText={(v) => { setConfirmPassword(v); if (credError) setCredError(""); }}
              isPassword
            />
            {credError ? <Text style={{ color: "#ef4444", fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 6 }}>{credError}</Text> : null}
            <Text style={[styles.terms, { color: colors.mutedForeground }]}>
              By clicking on continue you confirm that you agree to Money Moves'{" "}
              <Text
                style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", textDecorationLine: "underline" }}
                onPress={() => Linking.openURL("https://app.usemoneymoves.xyz/terms")}
              >
                Terms and conditions
              </Text>{" "}
              and{" "}
              <Text
                style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", textDecorationLine: "underline" }}
                onPress={() => Linking.openURL("https://app.usemoneymoves.xyz/terms")}
              >
                Privacy Policy
              </Text>
            </Text>
          </View>
        )}

        <View style={{ marginTop: "auto" }}>
          <MMButton
            title="Continue"
            loadingTitle="Creating your account"
            onPress={step === "profile" ? handleProfileNext : handleRegister}
            loading={loading}
          />
        </View>
      </ScrollView>
      <LoadingOverlay visible={loading} label="Creating your account" />
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
  backBtn: { padding: 4 },
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
  titleSection: { gap: 10 },
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
  },
  loginLink: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  form: { gap: 16 },
  terms: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
});
