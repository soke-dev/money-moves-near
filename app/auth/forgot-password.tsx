import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { MMInput } from "@/components/MMInput";
import { MMButton } from "@/components/MMButton";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { requestPasswordReset, confirmPasswordReset } from "@/services/auth";

type Step = "email" | "code" | "newPassword" | "done";
const CODE_LENGTH = 6;

export default function ForgotPasswordScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState(params.email || "");
  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [newPassword, setNewPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [timer, setTimer] = useState(0);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    if (timer <= 0) return;
    const interval = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(interval);
  }, [timer]);

  const handleRequestReset = async () => {
    if (!email) { setError("Enter your email address"); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) { setError("Please enter a valid email address"); return; }
    setLoading(true);
    setError("");
    try {
      await requestPasswordReset(email.trim().toLowerCase());
      setStep("code");
      setTimer(60);
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Something went wrong";
      if (e?.response?.data?.details?.length) {
        setError("Please enter a valid email address");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (timer > 0) return;
    setLoading(true);
    try {
      await requestPasswordReset(email.trim().toLowerCase());
      setTimer(60);
    } catch {}
    setLoading(false);
  };

  const handleCodeChange = (text: string, idx: number) => {
    const digits = text.replace(/[^0-9]/g, "");
    if (digits.length > 1) {
      const newCode = [...code];
      for (let i = 0; i < digits.length && i < CODE_LENGTH; i++) {
        newCode[i] = digits[i];
      }
      setCode(newCode);
      setError("");
      const nextIdx = Math.min(digits.length, CODE_LENGTH - 1);
      inputRefs.current[nextIdx]?.focus();
      return;
    }
    const newCode = [...code];
    newCode[idx] = text.slice(-1);
    setCode(newCode);
    setError("");
    if (text && idx < CODE_LENGTH - 1) {
      inputRefs.current[idx + 1]?.focus();
    }
  };

  const handleCodeKeyPress = (e: any, idx: number) => {
    if (e.nativeEvent.key === "Backspace" && !code[idx] && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    }
  };

  const handleVerifyCode = () => {
    const fullCode = code.join("");
    if (fullCode.length < CODE_LENGTH) { setError("Enter the full 6-digit code"); return; }
    setError("");
    setStep("newPassword");
  };

  const handleResetPassword = async () => {
    if (!newPassword) { setError("Enter a new password"); return; }
    if (newPassword.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (newPassword !== confirmPw) { setError("Passwords do not match"); return; }
    setLoading(true);
    setError("");
    try {
      await confirmPasswordReset(email.trim().toLowerCase(), code.join(""), newPassword);
      setStep("done");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Reset failed. Please try again.";
      if (msg.toLowerCase().includes("code") || msg.toLowerCase().includes("expired")) {
        setError(msg);
        setStep("code");
        setCode(Array(CODE_LENGTH).fill(""));
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const maskedEmail = email
    ? email.replace(/^(.{3}).*(@.*)$/, "$1***$2")
    : "";

  const formatTime = (s: number) => {
    const min = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${min}:${sec}`;
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.container, { paddingTop: topPad + 16, paddingBottom: bottomPad + 16 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => step === "email" || step === "done" ? router.back() : setStep("email")} style={styles.backBtn}>
            <Feather name="arrow-left" size={24} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        {/* ─── Step 1: Email ──────────────────────────── */}
        {step === "email" && (
          <>
            <View style={styles.titleSection}>
              <Text style={[styles.title, { color: colors.foreground }]}>Reset Password</Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                Enter the email address linked to your account. We'll send a 6-digit code.
              </Text>
            </View>
            <View style={styles.form}>
              <MMInput
                label="Email Address"
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={(v) => { setEmail(v); if (error) setError(""); }}
              />
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </View>
            <View style={styles.footer}>
              <MMButton
                title="Send Reset Code"
                loadingTitle="Sending your code"
                onPress={handleRequestReset}
                loading={loading}
              />
            </View>
          </>
        )}

        {/* ─── Step 2: Code ───────────────────────────── */}
        {step === "code" && (
          <>
            <View style={styles.titleSection}>
              <Text style={[styles.title, { color: colors.foreground }]}>Enter Code</Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                We sent a code to <Text style={{ fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{maskedEmail}</Text>
              </Text>
            </View>
            <View style={styles.codeRow}>
              {code.map((c, i) => (
                <TextInput
                  key={i}
                  ref={(r) => (inputRefs.current[i] = r)}
                  style={[
                    styles.codeInput,
                    {
                      backgroundColor: colors.muted,
                      color: colors.foreground,
                      borderColor: c ? colors.primary : colors.border,
                    },
                  ]}
                  value={c}
                  onChangeText={(t) => handleCodeChange(t, i)}
                  onKeyPress={(e) => handleCodeKeyPress(e, i)}
                  keyboardType="number-pad"
                  maxLength={i === 0 ? 6 : 1}
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                />
              ))}
            </View>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <TouchableOpacity onPress={handleResend} disabled={timer > 0} style={{ alignSelf: "center", marginTop: 8 }}>
              <Text style={[styles.resendText, { color: timer > 0 ? colors.mutedForeground : colors.primary }]}>
                {timer > 0 ? `Resend code in ${formatTime(timer)}` : "Resend code"}
              </Text>
            </TouchableOpacity>
            <View style={styles.footer}>
              <MMButton title="Continue" onPress={handleVerifyCode} />
            </View>
          </>
        )}

        {/* ─── Step 3: New Password ───────────────────── */}
        {step === "newPassword" && (
          <>
            <View style={styles.titleSection}>
              <Text style={[styles.title, { color: colors.foreground }]}>New Password</Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                Create a strong new password for your account.
              </Text>
            </View>
            <View style={styles.form}>
              <MMInput
                label="New Password"
                placeholder="At least 8 characters"
                isPassword
                value={newPassword}
                onChangeText={(v) => { setNewPassword(v); if (error) setError(""); }}
              />
              <MMInput
                label="Confirm Password"
                placeholder="Re-enter your password"
                isPassword
                value={confirmPw}
                onChangeText={(v) => { setConfirmPw(v); if (error) setError(""); }}
              />
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </View>
            <View style={styles.footer}>
              <MMButton
                title="Reset Password"
                loadingTitle="Resetting your password"
                onPress={handleResetPassword}
                loading={loading}
              />
            </View>
          </>
        )}

        {/* ─── Step 4: Done ──────────────────────────── */}
        {step === "done" && (
          <>
            <View style={[styles.titleSection, { alignItems: "center", marginTop: 40 }]}>
              <View style={[styles.successCircle, { backgroundColor: colors.primary + "20" }]}>
                <Feather name="check" size={40} color={colors.primary} />
              </View>
              <Text style={[styles.title, { color: colors.foreground, textAlign: "center" }]}>Password Reset!</Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground, textAlign: "center" }]}>
                Your password has been updated. You can now log in with your new password.
              </Text>
            </View>
            <View style={styles.footer}>
              <MMButton title="Back to Login" onPress={() => router.replace("/auth/dynamic-onboarding")} />
            </View>
          </>
        )}
      </ScrollView>
      <LoadingOverlay visible={loading} label={step === "email" ? "Sending your code" : "Resetting your password"} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 24, gap: 24 },
  header: { flexDirection: "row", alignItems: "center" },
  backBtn: { padding: 4 },
  titleSection: { gap: 12 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", lineHeight: 34 },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 22 },
  form: { gap: 16 },
  footer: { gap: 16, marginTop: "auto" },
  errorText: { color: "#ef4444", fontSize: 13, fontFamily: "Inter_400Regular" },
  codeRow: { flexDirection: "row", alignSelf: "stretch", justifyContent: "space-between", gap: 8 },
  codeInput: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    textAlign: "center",
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  resendText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  successCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
});
