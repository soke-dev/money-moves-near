import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
  Modal,
  Image,
  Keyboard,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as LocalAuthentication from "expo-local-authentication";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { Keypad } from "@/components/Keypad";
import { requestPinReset, confirmPinReset } from "@/services/auth";
import { sessionJustEnded } from "@/services/session";

export default function PinScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { verifyPin, logout, isPinSet, bioLogin, user, setUnlocked } = useApp();
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [biometricType, setBiometricType] = useState<"face" | "fingerprint" | null>(null);
  const [resetSheet, setResetSheet] = useState(false);
  const [resetStep, setResetStep] = useState<"code" | "pin">("code");
  const [resetCode, setResetCode] = useState("");
  const [resetNewPin, setResetNewPin] = useState("");
  const [resetConfirmPin, setResetConfirmPin] = useState("");
  const [resetError, setResetError] = useState("");

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  // Returning users are greeted by their username, not the name on their ID.
  //
  // This used to prefer the first name and fall back to the username, so a
  // verified account was addressed by its document name. That meant the same
  // person was greeted differently before and after verifying, and it put a
  // legal name on a screen that draws before anyone has authenticated.
  //
  // Cased exactly as it was set, because @username is how a person is
  // addressed everywhere else in the app. Clipped to 10 so the line does not
  // run past the edge at 22pt bold.
  const rawName = user?.username || "";
  const displayName = rawName.length > 10 ? rawName.slice(0, 10) + "…" : rawName;

  // Redirect if email not verified, new-device login not verified, or PIN not set
  useEffect(() => {
    if (user && (!user.emailVerified || !user.loginVerified)) {
      router.replace("/auth/verify-email");
    } else if (user && !isPinSet) {
      router.replace("/auth/set-pin");
    }
  }, [user, isPinSet]);

  useEffect(() => {
    if (Platform.OS === "web") return;

    // Auto-prompt immediately — bioLogin being true implies the user already
    // enrolled when enabling, so skip the preflight checks that delay the
    // native prompt by 100–500ms. authenticateAsync fails gracefully if the
    // device state has since changed.
    if (bioLogin) {
      triggerBiometric();
    }

    // Detect biometric type for the icon — cosmetic, runs in parallel.
    LocalAuthentication.supportedAuthenticationTypesAsync()
      .then((types) => {
        if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
          setBiometricType("face");
        } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
          setBiometricType("fingerprint");
        }
      })
      .catch(() => {});
  }, [bioLogin]);

  const triggerBiometric = async () => {
    if (Platform.OS === "web") return;
    // Don't raise the full-screen LoadingOverlay here — the native biometric
    // prompt already gives feedback, and our overlay would block the PIN keypad
    // until the prompt resolves. Leaving the keypad live lets the user start
    // typing their PIN immediately instead of cancelling biometric first.
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Money Moves",
        fallbackLabel: "Use PIN",
        cancelLabel: "Cancel",
        disableDeviceFallback: false,
      });
      if (result.success) {
        setUnlocked(true);
        router.replace("/(tabs)");
      }
    } catch {
      // User cancelled or failed — fall back to PIN
    }
  };

  /**
   * Within the "pin" step, which of the two entries is active.
   *
   * Same reason as every other PIN surface in the app: two focusable fields
   * need the system keyboard, and a keyboard inside a Modal either gets
   * double-counted by a KeyboardAvoidingView or sits on top of the sheet.
   */
  const [resetPinStep, setResetPinStep] = useState<"new" | "confirm">("new");

  const handleForgotPin = async () => {
    setLoading(true);
    try {
      await requestPinReset();
      setResetCode("");
      setResetNewPin("");
      setResetConfirmPin("");
      setResetError("");
      setResetStep("code");
      setResetPinStep("new");
      setResetSheet(true);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not send reset code");
    } finally {
      setLoading(false);
    }
  };

  const handleResetSubmit = async (confirmValue?: string) => {
    if (resetStep === "code") {
      if (resetCode.length !== 6) {
        setResetError("Enter the 6-digit code from your email");
        return;
      }
      setResetError("");
      setResetStep("pin");
      setResetPinStep("new");
      return;
    }
    // pin step. The confirmed value is passed in because setState is queued:
    // reading it back here would see the digit before last.
    const confirm = confirmValue ?? resetConfirmPin;
    if (resetNewPin.length !== 4) {
      setResetError("PIN must be 4 digits"); return;
    }
    if (resetNewPin !== confirm) {
      setResetError("PINs do not match"); return;
    }
    setLoading(true);
    try {
      await confirmPinReset(resetCode, resetNewPin);

      /**
       * Dismiss, settle, then speak.
       *
       * Alerting in the same tick as setResetSheet(false) raises it while the
       * Modal is still presented, and on iOS the modal's view controller owns
       * the presentation - the alert can end up stranded somewhere unreachable
       * instead of on screen.
       */
      setResetSheet(false);
      setResetCode("");
      setResetNewPin("");
      setResetConfirmPin("");
      setResetError("");
      setResetPinStep("new");
      setPin("");
      setError(false);
      setErrorMsg("");
      setTimeout(() => Alert.alert("PIN reset", "Enter your new PIN to continue."), 350);
    } catch (e: any) {
      setResetError(e?.message || "Failed to reset PIN");
    } finally {
      setLoading(false);
    }
  };

  const handleDigit = (digit: string) => {
    if (pin.length >= 4) return;
    const newPin = pin + digit;
    setPin(newPin);
    setError(false);
    setErrorMsg("");
    if (newPin.length === 4) {
      setLoading(true);
      (async () => {
        try {
          const valid = await verifyPin(newPin);
          if (valid) {
            setUnlocked(true);
            router.replace("/(tabs)");
          } else {
            setError(true);
            setErrorMsg("Incorrect PIN");
            setPin("");
          }
        } catch (e: any) {
          if (e?.message === "WRONG_PIN") {
            setError(true);
            const remaining = e.attemptsRemaining;
            setErrorMsg(
              remaining === 1
                ? "Incorrect PIN, 1 attempt remaining"
                : `Incorrect PIN, ${remaining} attempts remaining`
            );
            setPin("");
          } else if (e?.message === "PIN_LOCKED") {
            setError(true);
            setErrorMsg(e.errorMessage || "Too many failed attempts. PIN locked for 15 minutes");
            setPin("");
          } else if (e?.message === "PIN_NOT_SET") {
            // Nothing to verify against: send them to create one rather than
            // insisting the PIN they typed was wrong.
            Alert.alert(
              "No PIN set",
              "This account has no PIN yet. Let's set one now.",
              [{ text: "Set PIN", onPress: () => router.replace("/auth/set-pin" as any) }]
            );
          } else if (e?.message === "PIN_ERROR") {
            setError(true);
            setErrorMsg(e.errorMessage || "Could not verify PIN");
            setPin("");
          } else if (e?.message === "SESSION_EXPIRED") {
            // Already signed out and on sign-in, which says why.
            if (sessionJustEnded()) return;
            Alert.alert(
              "Session Expired",
              "Please log in again to continue.",
              [{ text: "OK", onPress: () => { logout(); router.replace("/auth/dynamic-onboarding"); } }]
            );
          } else {
            setError(true);
            setErrorMsg("Incorrect PIN");
            setPin("");
          }
        } finally {
          setLoading(false);
        }
      })();
    }
  };

  const handleDelete = () => {
    setPin((p) => p.slice(0, -1));
    setError(false);
    setErrorMsg("");
  };

  const biometricIcon = biometricType === "face" ? "smile" : "activity";
  const biometricLabel = biometricType === "face" ? "Face ID" : "Fingerprint";

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: topPad,
          paddingBottom: bottomPad + 16,
        },
      ]}
    >
      <View style={styles.content}>
        {/* Their own face if we have one. The picture costs nothing extra
            here: it is a data URI on the cached user object, which is read and
            parsed at launch whether or not anything draws it. */}
        <View style={[styles.avatarCircle, { backgroundColor: colors.primary }]}>
          {user?.avatarUrl ? (
            <Image source={{ uri: user.avatarUrl }} style={styles.avatarPhoto} resizeMode="cover" />
          ) : (
            <Image
              source={require("@/assets/images/user.png")}
              style={styles.avatarImg}
              resizeMode="contain"
            />
          )}
        </View>
        <Text
          numberOfLines={1}
          style={[styles.welcomeTitle, { color: colors.foreground }]}
        >
          Welcome back{displayName ? `, ${displayName}` : ""}
        </Text>
        <Text
          style={[styles.subtitle, { color: error ? colors.destructive : colors.mutedForeground }]}
        >
          {error ? (errorMsg || "Incorrect PIN") : "Enter your PIN to login"}
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Not you?{" "}
          <Text
            style={[styles.logoutInline, { color: colors.foreground }]}
            onPress={() => { logout(); router.replace("/auth/dynamic-onboarding" as any); }}
          >
            Logout
          </Text>
        </Text>

        <View style={styles.dotsRow}>
          {[0, 1, 2, 3].map((i) => {
            const filled = i < pin.length;
            return (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    backgroundColor: filled
                      ? error
                        ? colors.destructive
                        : colors.primary
                      : "transparent",
                    borderColor: error
                      ? colors.destructive
                      : filled
                      ? colors.primary
                      : colors.border,
                  },
                ]}
              />
            );
          })}
        </View>
      </View>

      <View style={styles.keypad}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <TouchableOpacity
            key={d}
            style={styles.key}
            onPress={() => handleDigit(d)}
            activeOpacity={0.6}
          >
            <Text style={[styles.keyText, { color: colors.foreground }]}>{d}</Text>
          </TouchableOpacity>
        ))}

        {/* Bottom row: biometric | 0 | delete */}
        {biometricType && bioLogin ? (
          <TouchableOpacity
            style={styles.key}
            onPress={triggerBiometric}
            activeOpacity={0.6}
          >
            <View style={[styles.biometricBtn, { backgroundColor: colors.muted }]}>
              {biometricType === "face" ? (
                <Image
                  source={require("@/assets/images/face-id.png")}
                  style={[styles.biometricImg, { tintColor: colors.primary }]}
                  resizeMode="contain"
                />
              ) : (
                <Feather name={biometricIcon as any} size={22} color={colors.primary} />
              )}
            </View>
          </TouchableOpacity>
        ) : (
          <View style={styles.key} />
        )}

        <TouchableOpacity style={styles.key} onPress={() => handleDigit("0")} activeOpacity={0.6}>
          <Text style={[styles.keyText, { color: colors.foreground }]}>0</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.key} onPress={handleDelete} activeOpacity={0.6}>
          <Feather name="delete" size={22} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.forgotBtn} onPress={handleForgotPin}>
        <Text style={[styles.forgotText, { color: colors.primary }]}>I forgot my pin</Text>
      </TouchableOpacity>

      {/* ── Reset PIN Modal ── */}
      <Modal visible={resetSheet} animationType="slide" transparent>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheetCard, { backgroundColor: colors.background, paddingBottom: bottomPad + 16 }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
                {resetStep === "code"
                  ? "Enter Reset Code"
                  : resetPinStep === "new"
                    ? "Choose a new PIN"
                    : "Confirm your new PIN"}
              </Text>
              <TouchableOpacity onPress={() => setResetSheet(false)}>
                <Feather name="x" size={22} color={colors.foreground} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.sheetSubtitle, { color: colors.mutedForeground, textAlign: "center" }]}>
              {resetStep === "code"
                ? "Enter the 6-digit code sent to your email"
                : resetPinStep === "new"
                  ? "Pick four digits you will remember"
                  : "Type it once more"}
            </Text>

            {/* Boxes for the emailed code, dots for the PIN - one is meant to
                be read back, the other is not. */}
            {resetStep === "code" ? (
              <View style={styles.resetBoxRow}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.resetBox,
                      { borderColor: resetCode[i] ? colors.primary : colors.border, backgroundColor: colors.card },
                    ]}
                  >
                    <Text style={[styles.resetBoxDigit, { color: colors.foreground }]}>{resetCode[i] || ""}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.resetDotRow}>
                {[0, 1, 2, 3].map((i) => {
                  const value = resetPinStep === "new" ? resetNewPin : resetConfirmPin;
                  const filled = i < value.length;
                  return (
                    <View
                      key={i}
                      style={[
                        styles.dot,
                        filled
                          ? { backgroundColor: resetError ? colors.destructive : colors.primary, borderColor: resetError ? colors.destructive : colors.primary }
                          : { backgroundColor: "transparent", borderColor: resetError ? colors.destructive : colors.border },
                      ]}
                    />
                  );
                })}
              </View>
            )}

            {/* Fixed slot, so the keypad does not jump when an error appears. */}
            <Text style={[styles.resetError, { color: resetError ? colors.destructive : "transparent" }]} numberOfLines={1}>
              {resetError || " "}
            </Text>

            <Keypad
              style={styles.resetPad}
              disabled={loading}
              onKey={(d) => {
                setResetError("");
                if (resetStep === "code") {
                  const next = (resetCode + d).slice(0, 6);
                  setResetCode(next);
                  // Advance here rather than calling handleResetSubmit: that
                  // reads resetCode from state, and this render still holds the
                  // five digits from before the one just pressed - so it
                  // rejected the very code it had been handed. Nothing is sent
                  // at this step anyway; the code is checked by the server when
                  // the new PIN is submitted.
                  if (next.length === 6) {
                    setResetError("");
                    setResetStep("pin");
                    setResetPinStep("new");
                  }
                  return;
                }
                if (resetPinStep === "new") {
                  const next = (resetNewPin + d).slice(0, 4);
                  setResetNewPin(next);
                  if (next.length === 4) setResetPinStep("confirm");
                  return;
                }
                const next = (resetConfirmPin + d).slice(0, 4);
                setResetConfirmPin(next);
                if (next.length < 4) return;
                if (next !== resetNewPin) {
                  setResetError("PINs do not match");
                  setTimeout(() => setResetConfirmPin(""), 600);
                  return;
                }
                handleResetSubmit(next);
              }}
              onBackspace={() => {
                setResetError("");
                if (resetStep === "code") { setResetCode(resetCode.slice(0, -1)); return; }
                if (resetPinStep === "confirm") {
                  // Backing off an empty confirm returns to the first entry.
                  if (!resetConfirmPin) { setResetPinStep("new"); setResetNewPin(resetNewPin.slice(0, -1)); return; }
                  setResetConfirmPin(resetConfirmPin.slice(0, -1));
                  return;
                }
                setResetNewPin(resetNewPin.slice(0, -1));
              }}
            />
          </View>
        </View>
      </Modal>

      <LoadingOverlay visible={loading} label="Unlocking your wallet" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
  },
  content: {
    flex: 1,
    alignItems: "center",
    // Top-aligned so the avatar + greeting sit just under the Help row rather
    // than floating in the middle; the keypad stays anchored at the bottom.
    justifyContent: "flex-start",
    paddingTop: 12,
    gap: 6,
  },
  avatarCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
    overflow: "hidden",
  },
  avatarPhoto: { width: "100%", height: "100%" },
  welcomeTitle: {
    fontSize: 22, lineHeight: 30,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.4,
    marginBottom: 4,
    textAlign: "center",
  },
  subtitle: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_400Regular", textAlign: "center" },
  logoutInline: { fontFamily: "Inter_600SemiBold" },
  avatarImg: { width: 42, height: 42 },
  biometricImg: { width: 24, height: 24 },
  dotsRow: {
    flexDirection: "row",
    gap: 18,
    marginTop: 36,
  },
  // Matched to the dots in the other PIN sheets, and given a heavier ring:
  // at 12pt with a 1.5pt border an empty dot was a faint outline on black,
  // which reads as disabled rather than as waiting for input.
  resetBoxRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 18 },
  resetBox: {
    width: 42, height: 52, borderRadius: 12, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
  },
  resetBoxDigit: { fontSize: 20, fontFamily: "Inter_600SemiBold" },
  resetDotRow: { flexDirection: "row", justifyContent: "center", gap: 18, marginTop: 26 },
  resetPad: { alignSelf: "stretch", marginTop: 6 },

  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2.5,
  },
  keypad: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 16,
  },
  key: {
    width: "33.33%",
    height: 66,
    alignItems: "center",
    justifyContent: "center",
  },
  keyText: { fontSize: 25, lineHeight: 34, fontFamily: "Inter_400Regular" },
  biometricBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  forgotBtn: {
    alignItems: "center",
    paddingVertical: 16,
  },
  forgotText: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold" },

  /* Reset PIN modal */
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheetCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#666", alignSelf: "center", marginBottom: 16 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  sheetBody: { marginBottom: 12 },
  sheetSubtitle: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_400Regular", marginBottom: 12 },
  resetError: { color: "#ef4444", fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 8 },
  resetBtn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  resetBtnText: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
});
