import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, TextInput, Platform, Modal, Switch,
  Animated, StyleSheet, Image, Easing, Keyboard,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { BlurView } from "expo-blur";
import { useColors } from "@/hooks/useColors";
import { useKeyboardHeight } from "@/hooks/useKeyboardHeight";
import { ts, BANK_FEE_RATE, fmtNaira } from "@/constants/transfer";
import { useApp } from "@/context/AppContext";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { saveBeneficiary as saveBeneficiaryApi } from "@/services/beneficiaries";
import { createBankTransfer } from "@/services/transactions";
import TransactionProcessingOverlay from "@/components/TransactionProcessingOverlay";
import { showError } from "@/components/PausedSheet";

import { SuccessMark, SUCCESS_RING } from "@/components/SuccessMark";
export default function BankSummaryScreen() {
  const colors = useColors();
  const kbHeight = useKeyboardHeight();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { ngnBalance, verifyPin, bioTx, refreshBalances, refreshTransactions } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const params = useLocalSearchParams<{ bank: string; accountNumber: string; accountName: string; amount: string; narration: string }>();
  const { bank, accountNumber, accountName, narration } = params;
  const amount = Number(params.amount);

  const [saveBeneficiary, setSaveBeneficiary] = useState(false);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState(0);
  const [showPin, setShowPin] = useState(false);
  const [showFeeInfo, setShowFeeInfo] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [txId, setTxId] = useState("");
  const [pin, setPin] = useState(["", "", "", ""]);
  const [pinError, setPinError] = useState(false);
  const pinRefs = useRef<(TextInput | null)[]>([]);
  const pendingAction = useRef<() => void>(() => {});
  const sheetAnim = useRef(new Animated.Value(400)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const checkAnim = useRef(new Animated.Value(0)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const bankFee = Math.round(amount * BANK_FEE_RATE);
  const bankTotal = amount + bankFee;

  const requestPin = (action: () => void) => {
    if (bioTx && Platform.OS !== "web") {
      LocalAuthentication.authenticateAsync({
        promptMessage: "Confirm Transaction",
        fallbackLabel: "Use PIN",
        cancelLabel: "Cancel",
      }).then((result) => {
        if (result.success) { action(); return; }
        // Fall back to PIN
        pendingAction.current = action;
        setPin(["", "", "", ""]);
        setPinError(false);
        setShowPin(true);
        setTimeout(() => pinRefs.current[0]?.focus(), 300);
      }).catch(() => {
        pendingAction.current = action;
        setPin(["", "", "", ""]);
        setPinError(false);
        setShowPin(true);
        setTimeout(() => pinRefs.current[0]?.focus(), 300);
      });
      return;
    }
    pendingAction.current = action;
    setPin(["", "", "", ""]);
    setPinError(false);
    setShowPin(true);
    setTimeout(() => pinRefs.current[0]?.focus(), 300);
  };

  const handlePinInput = (value: string, index: number) => {
    setPinError(false);
    const newPin = [...pin];
    newPin[index] = value;
    setPin(newPin);
    if (value && index < 3) pinRefs.current[index + 1]?.focus();
    if (index === 3 && value) {
      const fullPin = newPin.join("");
      (async () => {
        try {
          const valid = await verifyPin(fullPin);
          if (valid) {
            Keyboard.dismiss();
            pendingAction.current();
          } else {
            setPinError(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            setTimeout(() => { setPin(["", "", "", ""]); pinRefs.current[0]?.focus(); }, 600);
          }
        } catch {
          setPinError(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setTimeout(() => { setPin(["", "", "", ""]); pinRefs.current[0]?.focus(); }, 600);
        }
      })();
    }
  };

  const animateSuccess = () => {
    sheetAnim.setValue(400);
    overlayAnim.setValue(1);
    checkAnim.setValue(0);
    setShowSuccess(true);
    Animated.spring(sheetAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }).start(() => {
      Animated.spring(checkAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 5 }).start();
    });
  };

  /* Processing spinner */
  useEffect(() => {
    if (!processing) return;
    const spin = Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }),
    );
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    spin.start();
    pulse.start();
    return () => { spin.stop(); pulse.stop(); };
  }, [processing]);

  const spinInterpolate = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  const handleSend = async () => {
    setProcessing(true);
    setProcessingStep(0);
    try {
      setProcessingStep(1);
      const { transaction } = await createBankTransfer({
        amount,
        bankName: bank,
        accountNumber,
        accountName,
        narration: narration || undefined,
        saveBeneficiary,
      });
      setTxId(transaction.id);
      setProcessingStep(2);
      refreshBalances(true);
      refreshTransactions();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setProcessing(false);
      setShowPin(false);
      animateSuccess();
    } catch (err: any) {
      setProcessing(false);
      setProcessingStep(0);
      setShowPin(false);
      // Client-side throws - a signing timeout, an unsupported wallet, an RPC
      // failure - carry no response body, so keying only off response.data
      // collapsed every one of them to this generic line and lost the cause.
      console.error("[BANK-TRANSFER] failed:", err?.response?.data || err);
      const msg = err?.response?.data?.error || err?.message || "Transfer failed";
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (!err?.maintenanceHandled) showError(msg);
    }
  };

  return (
    <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={ts.header}>
        <TouchableOpacity onPress={() => router.back()} disabled={processing}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[ts.headerTitle, { color: colors.foreground }]}>Summary</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: bottomPad + 90 }}>
        <View style={{ alignItems: "center", marginTop: 16, marginBottom: 8 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: "Inter_400Regular" }}>Current Balance</Text>
          <Text style={{ color: colors.foreground, fontSize: 26, fontFamily: "Inter_700Bold", marginTop: 4 }}>{fmtNaira(ngnBalance)}</Text>
        </View>
        <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
          <View style={[ts.breakdownCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={ts.breakdownRow}>
              <Text style={[ts.breakdownLabel, { color: colors.mutedForeground }]}>Amount</Text>
              <Text style={[ts.breakdownValue, { color: colors.foreground }]}>{fmtNaira(amount)}</Text>
            </View>
            <View style={ts.breakdownRow}>
              <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", gap: 4 }} onPress={() => setShowFeeInfo(true)}>
                <Text style={[ts.breakdownLabel, { color: colors.mutedForeground }]}>Fee (0.5%)</Text>
                <Feather name="info" size={14} color={colors.primary} />
              </TouchableOpacity>
              <Text style={[ts.breakdownValue, { color: colors.foreground }]}>{fmtNaira(bankFee)}</Text>
            </View>
            <View style={[ts.breakdownDivider, { backgroundColor: colors.border }]} />
            <View style={ts.breakdownRow}>
              <Text style={[ts.breakdownLabelBold, { color: colors.foreground }]}>Total Debit</Text>
              <Text style={[ts.breakdownValueBold, { color: colors.foreground }]}>{fmtNaira(bankTotal)}</Text>
            </View>
          </View>
        </View>
        <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
          <View style={[ts.bankDetailsCard, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
            <View style={ts.bankDetailRow}>
              <Text style={[ts.bankDetailLabel, { color: colors.mutedForeground }]}>Bank Name</Text>
              <Text style={[ts.bankDetailValue, { color: colors.foreground }]}>{bank}</Text>
            </View>
            <View style={ts.bankDetailRow}>
              <Text style={[ts.bankDetailLabel, { color: colors.mutedForeground }]}>Account Name</Text>
              <Text style={[ts.bankDetailValue, { color: colors.foreground }]}>{accountName}</Text>
            </View>
            <View style={ts.bankDetailRow}>
              <Text style={[ts.bankDetailLabel, { color: colors.mutedForeground }]}>Account Number</Text>
              <Text style={[ts.bankDetailValue, { color: colors.primary }]}>{accountNumber}</Text>
            </View>
          </View>
        </View>
        <View style={[ts.saveBenRow, { paddingHorizontal: 20 }]}>
          <Text style={[ts.saveBenText, { color: colors.foreground }]}>Save Beneficiary</Text>
          <Switch
            value={saveBeneficiary} onValueChange={setSaveBeneficiary}
            trackColor={{ false: colors.muted, true: colors.primary + "66" }}
            thumbColor={saveBeneficiary ? colors.primary : colors.mutedForeground}
          />
        </View>
      </ScrollView>
      <View style={[ts.bottomBar, { paddingBottom: bottomPad + 16, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[ts.primaryBtn, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
          onPress={() => requestPin(handleSend)}
          disabled={loading}
        >
          <Text style={[ts.primaryBtnText, { color: colors.primaryForeground }]}>
            {loading ? "Sending..." : "Send Funds"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Fee Info Modal */}
      {showFeeInfo && (
        <Modal transparent animationType="fade" visible>
          <TouchableOpacity style={bsm.feeOverlay} activeOpacity={1} onPress={() => setShowFeeInfo(false)}>
            <View style={[bsm.feeCard, { backgroundColor: colors.card }]} onStartShouldSetResponder={() => true}>
              <View style={[bsm.feeIconWrap, { backgroundColor: colors.primary + "18" }]}>
                <Feather name="info" size={24} color={colors.primary} />
              </View>
              <Text style={[bsm.feeTitle, { color: colors.foreground }]}>Processing Fee</Text>
              <Text style={[bsm.feeDesc, { color: colors.mutedForeground }]}>
                Money Moves charges a fee of 0.5% on bank transfers. This covers processing and banking costs.
              </Text>
              <TouchableOpacity
                style={[bsm.feeBtn, { backgroundColor: colors.foreground }]}
                onPress={() => setShowFeeInfo(false)}
              >
                <Text style={[bsm.feeBtnText, { color: colors.background }]}>Okay</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* PIN Modal */}
      {showPin && (
        <Modal transparent animationType="slide" visible>
          {/* No KeyboardAvoidingView: inside a Modal on iOS the window is
              already resized for the keyboard, so a KAV adds that height a
              second time and pushes the sheet off-screen - which looks like it
              went blank. The sheet pads itself by the measured height instead. */}
          <View style={{ flex: 1 }}>
            <TouchableOpacity style={ts.modalOverlay} activeOpacity={1} onPress={() => !processing && setShowPin(false)}>
              {processing && (
                <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
              )}
              <View
                style={[
                  ts.pinSheet,
                  {
                    backgroundColor: colors.card,
                    paddingBottom: kbHeight > 0 ? kbHeight + 16 : bottomPad + 24,
                  },
                ]}
                onStartShouldSetResponder={() => true}
                {...(Platform.OS === "web" ? { onClick: (e: any) => e.stopPropagation() } : {})}
              >
                <View style={ts.handle} />
                <View style={[ts.pinIconWrap, { backgroundColor: colors.primary + "18" }]}>
                  <Feather name="lock" size={22} color={colors.primary} />
                </View>
                <Text style={[ts.pinHeading, { color: colors.foreground }]}>{processing ? "Processing" : "Confirm with PIN"}</Text>
                <Text style={[ts.pinSub, { color: colors.mutedForeground }]}>
                  {processing ? "Please wait while we process your transaction" : "Enter your 4-digit PIN to authorise this transfer"}
                </Text>
                <View style={{ opacity: processing ? 0.3 : 1 }} pointerEvents={processing ? "none" : "auto"}>
                <View style={ts.pinRow}>
                  {pin.map((d, i) => (
                    <View key={i} style={{ position: "relative" }}>
                      <TextInput
                        ref={(r) => { pinRefs.current[i] = r; }}
                        style={[
                          ts.pinBox,
                          {
                            borderColor: pinError ? colors.destructive : d ? colors.primary : colors.border,
                            backgroundColor: d ? colors.primary + "10" : "transparent",
                            color: "transparent",
                          },
                        ]}
                        value={d}
                        onChangeText={(v) => handlePinInput(v.slice(-1), i)}
                        keyboardType="number-pad"
                        maxLength={1}
                        caretHidden={Platform.OS !== "web"}
                        onKeyPress={({ nativeEvent }) => {
                          if (nativeEvent.key === "Backspace" && !d && i > 0) pinRefs.current[i - 1]?.focus();
                        }}
                      />
                      {d ? <Text style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, textAlign: "center", textAlignVertical: "center", lineHeight: 52, fontSize: 22, color: colors.foreground, fontFamily: "Inter_700Bold" }} pointerEvents="none">{"●"}</Text> : null}
                    </View>
                  ))}
                </View>
                {pinError && (
                  <Text style={{ color: colors.destructive, fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 8 }}>
                    Incorrect PIN, try again
                  </Text>
                )}
                </View>
                {processing && (
                  <View style={{ alignItems: "center", marginTop: 12 }}>
                    <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                      <View style={{ width: 56, height: 56, alignItems: "center", justifyContent: "center" }}>
                        <Animated.View style={{ position: "absolute", width: 56, height: 56, alignItems: "center", justifyContent: "center", transform: [{ rotate: spinInterpolate }] }}>
                          <View style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 2.5, borderColor: "transparent", borderTopColor: colors.primary }} />
                        </Animated.View>
                        <Image source={require("@/assets/images/logo-badge.png")} style={{ width: 28, height: 28, borderRadius: 6 }} />
                      </View>
                    </Animated.View>
                    <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 10 }}>Processing...</Text>
                  </View>
                )}
                <TouchableOpacity style={{ marginTop: 12, opacity: processing ? 0.3 : 1 }} onPress={() => !processing && router.push("/auth/pin" as any)} disabled={processing}>
                  <Text style={{ color: colors.primary, fontSize: 14, fontFamily: "Inter_600SemiBold" }}>Forgot PIN?</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </View>
        </Modal>
      )}

      {/* Processing Overlay */}
      <TransactionProcessingOverlay visible={processing && !showPin} variant="send" amount={`₦${Number(amount).toLocaleString()}`} label={`To ${accountName}`} currentStep={processingStep} />

      {/* Success Bottom Sheet */}
      {showSuccess && (
        <Modal transparent animationType="none" visible>
          <View style={bsm.overlay}>
            <Animated.View style={[bsm.dimBg, { opacity: overlayAnim }]} />
            <Animated.View
              style={[bsm.sheet, { backgroundColor: colors.card, paddingBottom: bottomPad + 24, transform: [{ translateY: sheetAnim }] }]}
            >
              <View style={bsm.handle} />

              <Animated.View style={[bsm.checkOuter, { borderColor: SUCCESS_RING, transform: [{ scale: checkAnim }] }]}>
                <SuccessMark size={52} />
              </Animated.View>

              <Text style={[bsm.title, { color: colors.foreground }]}>Success!</Text>
              <Text style={[bsm.subtitle, { color: colors.mutedForeground }]}>Transaction Processed</Text>

              <View style={bsm.actions}>
                <TouchableOpacity
                  style={[bsm.secondaryBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                  onPress={() => {
                    setShowSuccess(false);
                    router.replace({ pathname: "/transactions/detail", params: { id: txId } } as any);
                  }}
                >
                  <Feather name="file-text" size={15} color={colors.foreground} style={{ marginRight: 6 }} />
                  <Text style={[bsm.secondaryText, { color: colors.foreground }]}>View Receipt</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[bsm.doneBtn, { backgroundColor: colors.foreground }]}
                  onPress={() => router.replace("/(tabs)")}
                >
                  <Text style={[bsm.doneText, { color: colors.background }]}>Done</Text>
                </TouchableOpacity>
              </View>
            </Animated.View>
          </View>
        </Modal>
      )}

      <LoadingOverlay visible={processing} label="Sending your transfer" />
    </View>
  );
}

const bsm = StyleSheet.create({
  /* Processing */
  procOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.85)",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 40,
  },
  procLogoWrap: { marginBottom: 28 },
  procRing: { width: 100, height: 100, alignItems: "center", justifyContent: "center" },
  procSpinner: {
    position: "absolute", width: 100, height: 100,
    alignItems: "center", justifyContent: "center",
  },
  procArc: {
    width: 100, height: 100, borderRadius: 50,
    borderWidth: 3, borderColor: "transparent",
  },
  procLogo: { width: 48, height: 48, borderRadius: 12 },
  procTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff", marginBottom: 8 },
  procSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },

  /* Success */
  overlay: { flex: 1, justifyContent: "flex-end" },
  dimBg: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.85)" },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: "#ccc", marginBottom: 32 },
  checkOuter: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 3,
    alignItems: "center", justifyContent: "center", marginBottom: 20,
  },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", marginBottom: 6 },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 36 },
  actions: { flexDirection: "row", gap: 12, width: "100%" },
  secondaryBtn: {
    flex: 1, height: 50, borderRadius: 14, borderWidth: 1,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
  },
  secondaryText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  doneBtn: { flex: 1, height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  doneText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  /* Fee info modal */
  feeOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 32,
  },
  feeCard: {
    borderRadius: 20, padding: 28, alignItems: "center", width: "100%",
  },
  feeIconWrap: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  feeTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 10 },
  feeDesc: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20, marginBottom: 24 },
  feeBtn: { width: "100%", height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  feeBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
