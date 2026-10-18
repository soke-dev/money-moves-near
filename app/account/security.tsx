import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  Modal,
  ActivityIndicator,
  Image,
  Animated,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Keypad } from "@/components/Keypad";
import { SettingRow as Row, SettingGroup as Group, SettingToggle as Toggle } from "@/components/SettingsRow";
import * as LocalAuthentication from "expo-local-authentication";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { requestPinReset, confirmPinReset } from "@/services/auth";
import { setAnonMode as setAnonModeApi } from "@/services/user";
import { getBusinessLinks } from "@/services/business-links";

/**
 * Sign-in is an emailed code now, so there is no password to change - only the
 * payment PIN, and the emailed code that authorises changing it.
 */
type Sheet = null | "verify-pin" | "pin" | "anon-info";
const CODE_LENGTH = 6;

export default function SecurityScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { bioLogin, setBioLogin, bioTx, setBioTx, user, refreshUser } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [anonMode, setAnonMode] = useState(!!user?.anonMode);
  // The profile is refreshed on focus elsewhere, so the switch follows it
  // rather than keeping a stale copy from first mount.
  useEffect(() => { setAnonMode(!!user?.anonMode); }, [user?.anonMode]);

  // Requests still waiting for an answer, read again whenever the screen comes back into view.
  const [linksWaiting, setLinksWaiting] = useState(0);
  useFocusEffect(
    useCallback(() => {
      getBusinessLinks()
        .then((l) => setLinksWaiting(l.filter((x) => x.status === "PENDING").length))
        .catch(() => {});
    }, [])
  );

  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const biometricLabel = "Biometrics";
  const [sheet, setSheet] = useState<Sheet>(null);
  const [submitting, setSubmitting] = useState(false);

  // email verification state
  /**
   * The whole code, not one box per digit.
   *
   * Six TextInputs existed to be focused, and focus is what raised the system
   * keyboard over the sheet. With the app's keypad there is no focus to move,
   * so the boxes become what they always looked like: somewhere to read the
   * digits back.
   */
  const [emailCode, setEmailCode] = useState("");
  const [verifyTimer, setVerifyTimer] = useState(60);

  // pin change state
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinError, setPinError] = useState("");
  /**
   * Two entries, one at a time.
   *
   * Two text fields needed the system keyboard, and a keyboard inside a Modal
   * is what has broken this sheet three times: a KeyboardAvoidingView
   * double-counts its height, and without one the field sits under it. The
   * app's own keypad is part of the sheet, so there is nothing left to avoid.
   */
  const [pinStep, setPinStep] = useState<"new" | "confirm">("new");
  const [pinResetCode, setPinResetCode] = useState(""); // stores code received via email for pin reset

  useEffect(() => {
    (async () => {
      if (Platform.OS === "web") return;
      const hasHw = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHw || !enrolled) return;
      setBiometricAvailable(true);
    })();
  }, []);

  // email verification countdown
  useEffect(() => {
    if (sheet !== "verify-pin" || verifyTimer <= 0) return;
    const id = setInterval(() => setVerifyTimer((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [sheet, verifyTimer]);

  const maskedEmail = user?.email
    ? user.email.replace(/^(.{4}).*(@.*)$/, "$1***$2")
    : "****@gmail.com";

  // Changing the PIN is authorised by an emailed code, so that comes first.
  const openPinSheet = async () => {
    setEmailCode("");
    setVerifyTimer(60);
    setPinResetCode("");
    setSubmitting(true);
    try {
      await requestPinReset();
      setSheet("verify-pin");
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Could not send verification code");
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Takes the whole code rather than one box at a time, and moves on by itself
   * once the last digit lands - there was never anything to press afterwards.
   */
  const handleCodeInput = (next: string) => {
    setEmailCode(next);
    if (next.length < CODE_LENGTH) return;

    setPinResetCode(next);
    // Straight into choosing the new PIN, with the code carried across.
    setTimeout(() => {
      setNewPin("");
      setConfirmPin("");
      setPinError("");
      setPinStep("new");
      setSheet("pin");
    }, 200);
  };

  const resendCode = async () => {
    if (verifyTimer > 0) return;
    try {
      await requestPinReset();
      setVerifyTimer(60);
      setEmailCode("");
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Could not resend code");
    }
  };

  /**
   * A sheet, not an Alert.
   *
   * Alert.alert on this screen rendered as a stray fragment in the top-left
   * corner rather than a dialog. The rest of the screen already explains
   * itself in sheets that come up from the bottom, so the hint uses the same
   * ones - which is also where a thumb already is.
   */
  const explainAnon = () => setSheet("anon-info");

  /**
   * Flipped locally first, then confirmed.
   *
   * A switch that waits on a round trip before it moves reads as broken on a
   * slow connection, and people tap it again. So it moves at once and rolls
   * back if the server refuses - the setting is cosmetic enough that showing
   * it optimistically costs nothing, and `refreshUser` settles the truth.
   */
  const toggleAnon = async () => {
    const next = !anonMode;
    setAnonMode(next);
    try {
      await setAnonModeApi(next);
      refreshUser();
    } catch (err: any) {
      setAnonMode(!next);
      Alert.alert(
        "Could not change that",
        err?.response?.data?.error || "Check your connection and try again.",
      );
    }
  };

  const toggleBio = async (kind: "login" | "tx") => {
    const current = kind === "login" ? bioLogin : bioTx;
    if (!current) {
      // Enabling — verify identity first
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: `Enable ${biometricLabel}`,
        fallbackLabel: "Cancel",
        cancelLabel: "Cancel",
      });
      if (!result.success) return;
    }
    if (kind === "login") await setBioLogin(!current);
    else await setBioTx(!current);
  };

  const handleChangePin = async (confirmValue?: string) => {
    const confirm = confirmValue ?? confirmPin;
    if (!newPin || !confirm) {
      setPinError("Please fill all fields"); return;
    }
    if (newPin.length !== 4 || confirm.length !== 4) {
      setPinError("PIN must be 4 digits"); return;
    }
    if (newPin !== confirm) {
      setPinError("PINs do not match"); return;
    }
    if (!pinResetCode) {
      setPinError("Verification code missing. Please try again."); return;
    }
    setSubmitting(true);
    try {
      await confirmPinReset(pinResetCode, newPin);

      /**
       * Close the sheet first, then say so.
       *
       * An Alert raised from inside a Modal on iOS is presented by the modal's
       * own view controller and can end up behind it - the PIN changes, the
       * confirmation is somewhere unreachable, and the sheet just sits there
       * looking hung. Dismissing first means the alert has the screen to
       * itself.
       */
      setNewPin("");
      setConfirmPin("");
      setPinError("");
      setPinResetCode("");
      setPinStep("new");
      setSheet(null);
      setTimeout(() => Alert.alert("PIN updated", "Use your new PIN from now on."), 350);
    } catch (err: any) {
      // Stay on the confirm step with the digits cleared, so a retry is one
      // entry rather than starting the whole flow again.
      setPinError(err?.message || "Failed to change PIN");
      setConfirmPin("");
      setPinStep("confirm");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.foreground }]}>Security</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomPad + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Grouped by what each control protects, rather than by whether it
            happens to be a switch or a link. */}
        {biometricAvailable && (
          <Group label="SIGNING IN">
            <Row
              img={require("@/assets/images/face-id.png")}
              title={`${biometricLabel} for login`}
              subtitle="Unlock the app with your face or fingerprint"
              right={<Toggle on={bioLogin} onToggle={() => toggleBio("login")} />}
              last
            />
          </Group>
        )}

        <Group label="APPROVING PAYMENTS">
          {biometricAvailable && (
            <Row
              img={require("@/assets/images/transaction.png")}
              title={`${biometricLabel} for transactions`}
              subtitle="Approve payments without typing your PIN"
              right={<Toggle on={bioTx} onToggle={() => toggleBio("tx")} />}
            />
          )}
          <Row
            img={require("@/assets/images/lock (1).png")}
            title="Change PIN"
            subtitle="Four digits, asked for on every payment"
            onPress={openPinSheet}
            last
          />
        </Group>

        {/* Privacy sits with security because it is the same question asked
            the other way round: who can see you, rather than who can act as
            you. */}
        <Group label="PRIVACY">
          <Row
            mark={<Feather name="eye-off" size={17} color={colors.mutedForeground} />}
            title="Anonymous mode"
            subtitle="Hide your username from other people"
            // The detail sits behind the mark rather than under the group.
            // Three sentences of standing explanation is three sentences
            // nobody reads on the ninth visit to this screen; asked for, it
            // is the answer to a question they actually had.
            right={
              <View style={s.rowRight}>
                <TouchableOpacity
                  onPress={explainAnon}
                  hitSlop={12}
                  accessibilityLabel="What anonymous mode does"
                >
                  <Feather name="info" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
                <Toggle on={anonMode} onToggle={toggleAnon} />
              </View>
            }
            last
          />
        </Group>

        {/* Who can pay in. A business only ever sends money to the account,
            and only once its owner has said yes - the same question as who
            can act as you, asked about money arriving. */}
        <Group label="BUSINESSES">
          <Row
            mark={<Feather name="briefcase" size={17} color={colors.mutedForeground} />}
            title="Linked businesses"
            subtitle={linksWaiting ? `${linksWaiting} waiting for your answer` : "Businesses whose payments land in your account"}
            onPress={() => router.push("/account/linked-businesses" as any)}
            right={
              linksWaiting ? (
                <View style={[s.rowRight, { gap: 8 }]}>
                  <View style={[s.waiting, { backgroundColor: colors.primary }]}>
                    <Text style={[s.waitingText, { color: colors.primaryForeground }]}>{linksWaiting}</Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </View>
              ) : undefined
            }
            last
          />
        </Group>

        {/* Moved here from the account list: backing up a key is a security
            action, and it belongs with the PIN. */}
        <Group label="WALLET">
          <Row
            img={require("@/assets/images/wallet-filled-money-tool.png")}
            title="Export wallet"
            subtitle="Save your recovery phrase somewhere safe"
            onPress={() => router.push("/account/export-wallet" as any)}
            last
          />
        </Group>
      </ScrollView>

      {/* ── What anonymous mode does ── */}
      <Modal visible={sheet === "anon-info"} animationType="slide" transparent statusBarTranslucent>
        <TouchableOpacity
          style={s.sheetOverlay}
          activeOpacity={1}
          onPress={() => setSheet(null)}
        >
          <View
            style={[s.sheetCard, { backgroundColor: colors.background, paddingBottom: bottomPad + 20 }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={s.sheetHandle} />
            <View style={s.sheetHeader}>
              <Text style={[s.sheetTitle, { color: colors.foreground }]}>Anonymous mode</Text>
              <TouchableOpacity onPress={() => setSheet(null)} hitSlop={10}>
                <Feather name="x" size={22} color={colors.foreground} />
              </TouchableOpacity>
            </View>

            {/* What stays, then what goes, then the one thing people get
                wrong: that the handle still works if you hand it over. */}
            <Text style={[s.anonLine, { color: colors.mutedForeground }]}>
              Your points, rank and picture stay on the leaderboard. Only your
              username is hidden.
            </Text>
            <Text style={[s.anonLine, { color: colors.mutedForeground }]}>
              People you send money to will not see your username or your full
              name. Your transfer shows as coming from User.
            </Text>
            <Text style={[s.anonLine, { color: colors.mutedForeground }]}>
              Anyone looking you up to send money sees your username and your
              picture, never your full name.
            </Text>
            <Text style={[s.anonLine, { color: colors.mutedForeground }]}>
              Anyone you give your username to can still use it to send you
              money, and anyone who signs up with your referral code will see
              who invited them. Turning this on does not stop either.
            </Text>

            <TouchableOpacity
              style={[s.anonDone, { backgroundColor: colors.primary }]}
              onPress={() => setSheet(null)}
              activeOpacity={0.85}
            >
              <Text style={[s.anonDoneText, { color: colors.primaryForeground }]}>Got it</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Email Verification Sheet (PIN change) ── */}
      <Modal visible={sheet === "verify-pin"} animationType="slide" transparent statusBarTranslucent>
        <View style={s.sheetOverlay}>
          <View style={[s.sheetCard, { backgroundColor: colors.background, paddingBottom: bottomPad + 20 }]}>
            <View style={s.sheetHandle} />
            <View style={s.sheetHeader}>
              <Text style={[s.sheetTitle, { color: colors.foreground }]}>Verify Email</Text>
              <TouchableOpacity onPress={() => { setSheet(null); setEmailCode(""); }}>
                <Feather name="x" size={22} color={colors.foreground} />
              </TouchableOpacity>
            </View>

            <Text style={[s.verifySubtitle, { color: colors.mutedForeground }]}>
              Enter the {CODE_LENGTH}-digit code sent to{"\n"}
              <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>{maskedEmail}</Text>
            </Text>

            {/* Boxes to read the code back in, filled by the keypad below. */}
            <View style={s.codeRow}>
              {Array.from({ length: CODE_LENGTH }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    s.codeBox,
                    {
                      borderColor: emailCode[i] ? colors.primary : colors.border,
                      backgroundColor: colors.card,
                    },
                  ]}
                >
                  <Text style={[s.codeDigit, { color: colors.foreground }]}>{emailCode[i] || ""}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity style={s.resendRow} onPress={resendCode} disabled={verifyTimer > 0}>
              <Text style={[s.resendText, { color: colors.mutedForeground }]}>
                {verifyTimer > 0 ? `Resend code in ${verifyTimer}s` : "Resend code"}
              </Text>
            </TouchableOpacity>

            <Keypad
              style={s.pinPad}
              disabled={submitting || emailCode.length >= CODE_LENGTH}
              onKey={(d) => handleCodeInput((emailCode + d).slice(0, CODE_LENGTH))}
              onBackspace={() => setEmailCode(emailCode.slice(0, -1))}
            />
          </View>
        </View>
      </Modal>

      {/* ── Change PIN Sheet ── */}
      <Modal visible={sheet === "pin"} animationType="slide" transparent statusBarTranslucent>
        <View style={s.sheetOverlay}>
          <View style={[s.sheetCard, { backgroundColor: colors.background, paddingBottom: bottomPad + 16 }]}>
            <View style={s.sheetHandle} />
            <View style={s.sheetHeader}>
              <Text style={[s.sheetTitle, { color: colors.foreground }]}>
                {pinStep === "new" ? "Choose a new PIN" : "Confirm your new PIN"}
              </Text>
              <TouchableOpacity
                onPress={() => { setSheet(null); setNewPin(""); setConfirmPin(""); setPinError(""); setPinStep("new"); }}
              >
                <Feather name="x" size={22} color={colors.foreground} />
              </TouchableOpacity>
            </View>

            {/* Dots, not fields: there is nothing to focus, only somewhere to
                look while the keypad is pressed. */}
            <View style={s.pinDots}>
              {[0, 1, 2, 3].map((i) => {
                const value = pinStep === "new" ? newPin : confirmPin;
                const filled = i < value.length;
                return (
                  <View
                    key={i}
                    style={[
                      s.pinDot,
                      filled
                        ? { backgroundColor: pinError ? "#ef4444" : colors.primary }
                        : { borderWidth: 2, borderColor: pinError ? "#ef444466" : colors.border },
                    ]}
                  />
                );
              })}
            </View>

            {/* Fixed slot, so the keypad does not jump when an error appears. */}
            <Text style={[s.pinErr, { color: pinError ? "#ef4444" : "transparent" }]} numberOfLines={1}>
              {pinError || " "}
            </Text>

            <Keypad
              style={s.pinPad}
              disabled={submitting}
              onKey={(d) => {
                if (pinError) setPinError("");
                if (pinStep === "new") {
                  const next = (newPin + d).slice(0, 4);
                  setNewPin(next);
                  // Moving on by itself: a "next" button would be one more tap
                  // for something the fourth digit already decided.
                  if (next.length === 4) setPinStep("confirm");
                  return;
                }
                const next = (confirmPin + d).slice(0, 4);
                setConfirmPin(next);
                if (next.length < 4) return;
                if (next !== newPin) {
                  setPinError("PINs do not match");
                  setTimeout(() => setConfirmPin(""), 600);
                  return;
                }
                handleChangePin(next);
              }}
              onBackspace={() => {
                if (pinError) setPinError("");
                if (pinStep === "confirm") {
                  // Backing off an empty confirm returns to the first entry,
                  // which is the only way back that does not need a button.
                  if (!confirmPin) { setPinStep("new"); setNewPin(newPin.slice(0, -1)); return; }
                  setConfirmPin(confirmPin.slice(0, -1));
                  return;
                }
                setNewPin(newPin.slice(0, -1));
              }}
            />
          </View>
        </View>
      </Modal>

      {submitting && (
        <View style={s.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  // The mark and the switch share the right-hand slot, so they need a row of
  // their own to sit in.
  rowRight: { flexDirection: "row", alignItems: "center", gap: 14 },
  waiting: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  waitingText: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },

  anonLine: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "Inter_400Regular",
    marginBottom: 14,
  },
  anonDone: {
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  anonDoneText: { fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16,
  },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  /* Bottom sheet */
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheetCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12, maxHeight: "85%" },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#666", alignSelf: "center", marginBottom: 16 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  sheetBody: { flexGrow: 0 },

  pinDots: { flexDirection: "row", gap: 16, justifyContent: "center", marginTop: 10 },
  pinDot: { width: 16, height: 16, borderRadius: 8 },
  pinErr: {
    fontSize: 12.5,
    lineHeight: 17,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
    marginTop: 14,
    marginBottom: 2,
  },
  pinPad: { alignSelf: "stretch", marginTop: 6 },

  sheetBtn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  sheetBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  /* Email verification */
  verifySubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22, textAlign: "center", marginBottom: 24 },
  codeRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 20 },
  codeBox: {
    width: 42, height: 52, borderRadius: 12, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
  },
  codeDigit: { fontSize: 20, fontFamily: "Inter_600SemiBold" },
  resendRow: { alignItems: "center", marginBottom: 8 },
  resendText: { fontSize: 13, fontFamily: "Inter_500Medium" },

  /* Loading overlay */
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
});
