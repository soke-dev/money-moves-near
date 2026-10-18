import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";

const CODE_LENGTH = 6;

export default function VerifyEmailScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, verifyEmail, resendVerification, isPinSet } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [timer, setTimer] = useState(56);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const inputRefs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    if (timer <= 0) return;
    const interval = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(interval);
  }, [timer]);

  const maskedEmail = user?.email
    ? user.email.replace(/^(.{4}).*(@.*)$/, "$1***$2")
    : "****@gmail.com";

  const handleChange = (text: string, idx: number) => {
    // Handle paste — if multiple digits entered, distribute across boxes
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
      if (newCode.every((c) => c !== "")) {
        submitCode(newCode.join(""));
      }
      return;
    }

    const newCode = [...code];
    newCode[idx] = text.slice(-1);
    setCode(newCode);
    setError("");

    if (text && idx < CODE_LENGTH - 1) {
      inputRefs.current[idx + 1]?.focus();
    }

    if (newCode.every((c) => c !== "")) {
      submitCode(newCode.join(""));
    }
  };

  const submitCode = async (fullCode: string) => {
    setVerifying(true);
    try {
      await verifyEmail(fullCode);
      // Existing user with PIN → go to pin entry; new user → set pin
      router.replace(isPinSet ? "/auth/pin" : "/auth/set-pin");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Invalid code";
      setError(msg);
      setCode(Array(CODE_LENGTH).fill(""));
      inputRefs.current[0]?.focus();
    } finally {
      setVerifying(false);
    }
  };

  const handleKeyPress = (e: any, idx: number) => {
    if (e.nativeEvent.key === "Backspace" && !code[idx] && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    }
  };

  const formatTime = (s: number) => {
    const min = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${min}:${sec}`;
  };

  return (
    <View
      style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace("/auth/dynamic-onboarding")}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={[styles.helpBtn, { borderColor: colors.border }]} onPress={() => router.push("/account/support")}>
          <Feather name="headphones" size={16} color={colors.mutedForeground} />
          <Text style={[styles.helpText, { color: colors.mutedForeground }]}>Help</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {isPinSet
            ? <>We sent a code to <Text style={{ fontFamily: "Inter_700Bold", color: colors.foreground }}>{maskedEmail}</Text></>
            : <>Enter the code sent to <Text style={{ fontFamily: "Inter_700Bold", color: colors.foreground }}>{maskedEmail}</Text></>
          }
        </Text>

        {/* OTP Inputs */}
        <View style={styles.otpRow}>
          {Array.from({ length: CODE_LENGTH }).map((_, i) => (
            <TextInput
              key={i}
              ref={(ref) => { inputRefs.current[i] = ref; }}
              style={[
                styles.otpBox,
                {
                  borderColor: code[i] ? colors.foreground : colors.border,
                  color: colors.foreground,
                  backgroundColor: colors.card,
                },
              ]}
              value={code[i]}
              onChangeText={(t) => handleChange(t, i)}
              onKeyPress={(e) => handleKeyPress(e, i)}
              keyboardType="number-pad"
              maxLength={1}
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
            />
          ))}
        </View>

        {error ? (
          <Text style={{ color: "#ff4444", textAlign: "center", marginBottom: 12, fontFamily: "Inter_500Medium", fontSize: 14 }}>
            {error}
          </Text>
        ) : null}

        {/* Resend */}
        <TouchableOpacity
          disabled={timer > 0}
          onPress={async () => {
            try {
              await resendVerification();
              setTimer(60);
            } catch {
              setError("Failed to resend code");
            }
          }}
        >
          <Text style={[styles.resendText, { color: colors.mutedForeground }]}>
            {timer > 0 ? `Resend code in ${formatTime(timer)}` : "Resend code"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 16,
    paddingBottom: 32,
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
  helpText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  content: {
    alignItems: "center",
    gap: 16,
    paddingTop: 40,
    width: "100%",
  },
  title: { fontSize: 28, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  otpRow: { flexDirection: "row", alignSelf: "stretch", gap: 8, marginTop: 16 },
  otpBox: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    textAlign: "center",
    fontSize: 22,
    fontFamily: "Inter_600SemiBold",
  },
  resendText: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 16 },
});
