import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Platform, Modal,
  ActivityIndicator, Animated,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { Keypad } from "@/components/Keypad";
import { requestPhoneChange, verifyPhoneChange } from "@/services/user";
import { ts } from "@/constants/transfer";

type Step = "phone" | "verify";

interface Country {
  code: string;
  name: string;
  dial: string;
  flag: string;
  /** Digits after the dial code. */
  nsn: number;
}

/**
 * One country, until there is a second.
 *
 * The picker is here rather than a hardcoded "+234" label because adding a
 * country later should be a line in this list, not a redesign of the field.
 */
const COUNTRIES: Country[] = [
  { code: "NG", name: "Nigeria", dial: "+234", flag: "🇳🇬", nsn: 10 },
];

/** 801 234 5678 - the way a Nigerian number is read aloud. */
function formatNsn(digits: string) {
  const a = digits.slice(0, 3);
  const b = digits.slice(3, 6);
  const c = digits.slice(6, 10);
  return [a, b, c].filter(Boolean).join(" ");
}

/** Pulls the national digits out of whatever is already on file. */
function toNsn(stored: string | null | undefined, dial: string) {
  if (!stored) return "";
  let d = stored.replace(/[^0-9]/g, "");
  const dialDigits = dial.replace(/[^0-9]/g, "");
  if (d.startsWith(dialDigits)) d = d.slice(dialDigits.length);
  if (d.startsWith("0")) d = d.slice(1);
  return d.slice(0, 10);
}

export default function EditPhoneScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, updateUser } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [step, setStep] = useState<Step>("phone");
  const [country, setCountry] = useState<Country>(COUNTRIES[0]);
  const [showCountries, setShowCountries] = useState(false);
  const [digits, setDigits] = useState(() => toNsn(user?.phone, COUNTRIES[0].dial));
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const e164 = country.dial + digits;
  const complete = digits.length === country.nsn;
  const hasChanged = e164 !== (user?.phone || "");
  const canContinue = complete && hasChanged && !loading;

  // A caret, because there is no system keyboard to imply one. It is the only
  // sign the field is live while the app pad is doing the typing.
  const caret = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(caret, { toValue: 0, duration: 480, delay: 380, useNativeDriver: true }),
        Animated.timing(caret, { toValue: 1, duration: 480, delay: 120, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [caret]);

  const startCountdown = useCallback(() => {
    setCountdown(60);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, []);

  const [toastVisible, setToastVisible] = useState(false);
  const toastAnim = useRef(new Animated.Value(-80)).current;

  const showToast = useCallback(() => {
    setToastVisible(true);
    Animated.timing(toastAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start();
    setTimeout(() => {
      Animated.timing(toastAnim, { toValue: -80, duration: 300, useNativeDriver: true }).start(() => {
        setToastVisible(false);
        router.back();
      });
    }, 1500);
  }, [toastAnim, router]);

  const handleRequestCode = async () => {
    if (!canContinue) return;
    setLoading(true);
    setError("");
    try {
      await requestPhoneChange(e164);
      startCountdown();
      setStep("verify");
    } catch (e: any) {
      setError(
        e?.response?.data?.details?.[0]?.message ||
        e?.response?.data?.error ||
        "Could not send the verification code",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (code.length !== 6 || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await verifyPhoneChange(code);
      await updateUser({ phone: res.phone });
      showToast();
    } catch (e: any) {
      setError(
        e?.response?.data?.details?.[0]?.message ||
        e?.response?.data?.error ||
        "That code did not work",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || resending) return;
    setResending(true);
    setError("");
    try {
      await requestPhoneChange(e164);
      startCountdown();
      setCode("");
    } catch (e: any) {
      setError(e?.response?.data?.error || "Could not resend the code");
    } finally {
      setResending(false);
    }
  };

  // One pad drives whichever step is on screen.
  const onKey = (d: string) => {
    setError("");
    if (step === "phone") {
      // The dial code already carries the trunk prefix, so a leading 0 is
      // noise rather than a digit.
      if (!digits && d === "0") return;
      setDigits((prev) => (prev + d).slice(0, country.nsn));
    } else {
      setCode((prev) => (prev + d).slice(0, 6));
    }
  };

  const onBackspace = () => {
    setError("");
    if (step === "phone") setDigits((prev) => prev.slice(0, -1));
    else setCode((prev) => prev.slice(0, -1));
  };

  return (
    <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {toastVisible && (
        <Animated.View style={[s.toast, { top: topPad + 8, transform: [{ translateY: toastAnim }] }]}>
          <Feather name="check" size={18} color="#fff" />
          <Text style={s.toastText}>Phone number updated</Text>
        </Animated.View>
      )}

      <View style={ts.header}>
        <TouchableOpacity
          onPress={() => (step === "verify" ? setStep("phone") : router.back())}
          hitSlop={10}
        >
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[ts.headerTitle, { color: colors.foreground }]}>
          {step === "phone" ? "Phone number" : "Confirm it is you"}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {step === "phone" ? (
        <>
          <View style={s.body}>
            <Text style={[s.lead, { color: colors.mutedForeground }]}>
              We will email a code to {user?.email} to confirm the change.
            </Text>

            {/* Country on the left of the number, not above it: a dial code
                without the number beside it is not a thing anyone reads. */}
            <View
              style={[
                s.field,
                {
                  backgroundColor: colors.card,
                  borderColor: error ? colors.destructive : complete ? colors.primary : colors.border,
                },
              ]}
            >
              <TouchableOpacity
                style={s.ccBtn}
                onPress={() => setShowCountries(true)}
                activeOpacity={0.7}
                hitSlop={6}
              >
                <Text style={s.flag}>{country.flag}</Text>
                <Text style={[s.dial, { color: colors.foreground }]}>{country.dial}</Text>
                <Feather name="chevron-down" size={15} color={colors.mutedForeground} />
              </TouchableOpacity>

              <View style={[s.divider, { backgroundColor: colors.border }]} />

              <Text
                style={[s.number, { color: digits ? colors.foreground : colors.mutedForeground }]}
                numberOfLines={1}
              >
                {digits ? formatNsn(digits) : "801 234 5678"}
              </Text>
              {!complete && (
                <Animated.View style={[s.caret, { backgroundColor: colors.primary, opacity: caret }]} />
              )}
            </View>

            <Text
              style={[s.note, { color: error ? colors.destructive : colors.mutedForeground }]}
              numberOfLines={2}
            >
              {error || `${country.nsn} digits, without the leading zero.`}
            </Text>
          </View>

          <Keypad style={s.pad} onKey={onKey} onBackspace={onBackspace} disabled={loading} />

          <View style={[s.bottom, { paddingBottom: bottomPad + 12 }]}>
            <TouchableOpacity
              style={[ts.primaryBtn, { backgroundColor: canContinue ? colors.primary : colors.muted }]}
              onPress={handleRequestCode}
              disabled={!canContinue}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Text
                  style={[
                    ts.primaryBtnText,
                    { color: canContinue ? colors.primaryForeground : colors.mutedForeground },
                  ]}
                >
                  Continue
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          <View style={s.body}>
            <Text style={[s.lead, { color: colors.mutedForeground }]}>
              Enter the 6-digit code we sent to {user?.email} to confirm{" "}
              <Text style={{ color: colors.foreground }}>
                {country.dial} {formatNsn(digits)}
              </Text>
              .
            </Text>

            <View style={s.boxRow}>
              {Array.from({ length: 6 }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    s.box,
                    {
                      backgroundColor: colors.card,
                      borderColor: error
                        ? colors.destructive
                        : code[i]
                          ? colors.primary
                          : colors.border,
                    },
                  ]}
                >
                  <Text style={[s.boxDigit, { color: colors.foreground }]}>{code[i] || ""}</Text>
                </View>
              ))}
            </View>

            {/* A fixed slot, so the pad below does not jump when this fills. */}
            <Text
              style={[s.note, { color: error ? colors.destructive : "transparent", textAlign: "center" }]}
              numberOfLines={1}
            >
              {error || " "}
            </Text>

            <TouchableOpacity
              onPress={handleResend}
              disabled={resending || countdown > 0}
              style={s.resendBtn}
              activeOpacity={0.7}
            >
              {resending ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : countdown > 0 ? (
                <Text style={[s.resendText, { color: colors.mutedForeground }]}>
                  Resend in {countdown}s
                </Text>
              ) : (
                <Text style={[s.resendText, { color: colors.primary }]}>Resend code</Text>
              )}
            </TouchableOpacity>
          </View>

          <Keypad style={s.pad} onKey={onKey} onBackspace={onBackspace} disabled={loading} />

          <View style={[s.bottom, { paddingBottom: bottomPad + 12 }]}>
            <TouchableOpacity
              style={[
                ts.primaryBtn,
                { backgroundColor: code.length === 6 && !loading ? colors.primary : colors.muted },
              ]}
              onPress={handleVerify}
              disabled={code.length !== 6 || loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Text
                  style={[
                    ts.primaryBtnText,
                    { color: code.length === 6 ? colors.primaryForeground : colors.mutedForeground },
                  ]}
                >
                  Verify and save
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}

      {showCountries && (
        <Modal transparent animationType="slide" visible>
          <TouchableOpacity
            style={ts.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowCountries(false)}
          >
            <View
              style={[ts.bankSheet, { backgroundColor: colors.card, paddingBottom: bottomPad + 20 }]}
              onStartShouldSetResponder={() => true}
            >
              <View style={[ts.handle, { alignSelf: "center", backgroundColor: colors.primary }]} />
              <Text style={[s.sheetTitle, { color: colors.foreground }]}>Select country</Text>

              <View style={s.ccList}>
                {COUNTRIES.map((c) => {
                  const active = c.code === country.code;
                  return (
                    <TouchableOpacity
                      key={c.code}
                      style={[s.ccRow, { backgroundColor: colors.background }]}
                      onPress={() => {
                        setCountry(c);
                        setShowCountries(false);
                      }}
                      activeOpacity={0.75}
                    >
                      <Text style={s.ccRowFlag}>{c.flag}</Text>
                      <Text style={[s.ccRowName, { color: colors.foreground }]}>{c.name}</Text>
                      <Text style={[s.ccRowDial, { color: colors.mutedForeground }]}>{c.dial}</Text>
                      {active && <Feather name="check" size={18} color={colors.primary} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[s.ccNote, { color: colors.mutedForeground }]}>
                More countries as we open them.
              </Text>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: 20, paddingTop: 6 },
  lead: { fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_400Regular", marginBottom: 22 },

  field: {
    flexDirection: "row",
    alignItems: "center",
    height: 62,
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 14,
  },
  ccBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  flag: { fontSize: 20 },
  dial: { fontSize: 16.5, lineHeight: 22, fontFamily: "Inter_600SemiBold" },
  divider: { width: StyleSheet.hairlineWidth, height: 26, marginHorizontal: 12 },
  number: { fontSize: 18, lineHeight: 24, fontFamily: "Inter_600SemiBold", letterSpacing: 0.4 },
  caret: { width: 2, height: 24, borderRadius: 1, marginLeft: 3 },

  note: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 10, marginLeft: 4 },

  boxRow: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  box: { flex: 1, height: 58, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  boxDigit: { fontSize: 21, lineHeight: 27, fontFamily: "Inter_700Bold" },
  resendBtn: { alignSelf: "center", paddingVertical: 10 },
  resendText: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold" },

  // Matched to the send and withdraw pads, which were narrowed to this.
  pad: { width: "100%", maxWidth: 380, alignSelf: "center", paddingHorizontal: 22, marginTop: 12 },
  bottom: { paddingHorizontal: 20, paddingTop: 12 },

  sheetTitle: { fontSize: 21, lineHeight: 27, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.5, marginBottom: 16 },
  ccList: { gap: 10 },
  ccRow: { flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: 14, height: 62, borderRadius: 16 },
  ccRowFlag: { fontSize: 24 },
  ccRowName: { flex: 1, fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  ccRowDial: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_500Medium" },
  ccNote: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 16 },

  toast: {
    position: "absolute", left: 20, right: 20, zIndex: 20,
    backgroundColor: "#22c55e", borderRadius: 30, paddingVertical: 12, paddingHorizontal: 20,
    flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 8,
    elevation: 6,
  },
  toastText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
