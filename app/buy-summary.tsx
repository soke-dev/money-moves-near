import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, Platform, Modal,
  Animated, StyleSheet, Image, Easing, Alert, ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { useColors } from "@/hooks/useColors";
import { ts, fmtNaira, CRYPTO_FEE_RATE } from "@/constants/transfer";
import { TokenLogo } from "@/components/TokenLogo";
import { useApp } from "@/context/AppContext";
import { initializeFunding, verifyFunding, type FundingInitResult } from "@/services/funding";
import { getLocalAddresses } from "@/services/wallet-core";
import TransactionProcessingOverlay from "@/components/TransactionProcessingOverlay";
import NinPrompt from "@/components/NinPrompt";

import { SuccessMark, SUCCESS_RING } from "@/components/SuccessMark";
export default function BuySummaryScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const { walletAddresses, refreshBalances, refreshTransactions } = useApp();

  const params = useLocalSearchParams<{
    asset: string;
    network: string;
    chain: string;
    ngnAmount: string;
    cryptoAmount: string;
    usdValue: string;
    fee: string;
    assetName: string;
    liveRate: string;
  }>();

  const asset = params.asset || "USDC";
  const network = params.network || "";
  const chain = params.chain || "MOVE";
  const ngnAmount = Number(params.ngnAmount) || 0;
  const cryptoAmount = Number(params.cryptoAmount) || 0;
  const usdValue = Number(params.usdValue) || 0;
  const feeNgn = Number(params.fee) || 0;
  const assetName = params.assetName || asset;
  const liveRate = Number(params.liveRate) || 0;
  const total = ngnAmount;

  const [loading, setLoading] = useState(false);
  /** Set when the bank needs a NIN we do not hold. Not an error - a question. */
  const [needNin, setNeedNin] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState(0);
  const [showFeeInfo, setShowFeeInfo] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [txId, setTxId] = useState("");
  const [txPending, setTxPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The account the user is transferring into, while they are doing it.
  const [transfer, setTransfer] = useState<FundingInitResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const pendingRef = useRef<string | null>(null);
  const verifyingRef = useRef(false);
  const sheetAnim = useRef(new Animated.Value(400)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const checkAnim = useRef(new Animated.Value(0)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const animateSuccess = () => {
    sheetAnim.setValue(400);
    overlayAnim.setValue(1);
    checkAnim.setValue(0);
    setShowSuccess(true);
    Animated.spring(sheetAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }).start(() => {
      Animated.spring(checkAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 5 }).start();
    });
  };

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

  // Resolve the wallet address for the chosen chain
  const getWalletAddress = (): string => {
    // EVM chains share one address
    if (["BASE", "BEP20", "ARB"].includes(chain)) {
      return walletAddresses.BASE || walletAddresses.BEP20 || walletAddresses.ARB || "";
    }
    return walletAddresses[chain] || "";
  };

  /**
   * Check whether the transfer landed, and if so finish the purchase.
   *
   * `silent` is the polling case: it must not show the processing overlay or
   * surface an error, because "not yet" is the expected answer while the user
   * is still in their banking app.
   */
  const verifyPayment = async (reference: string, silent = false) => {
    // Prevent concurrent verification of the same reference
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    if (!silent) {
      setTransfer(null);
      setProcessing(true);
    }
    if (!silent) setProcessingStep(0);
    setError(null);
    try {
      // Send locally-derived address so backend can cross-check against DB
      const localAddrs = await getLocalAddresses().catch(() => null);
      if (!silent) setProcessingStep(1);
      const localAddr = localAddrs?.[chain] || undefined;
      const result = await verifyFunding(reference, localAddr);

      // Still waiting. Leave the transfer sheet up and say nothing.
      if (silent && result.status !== "success") {
        if (result.status === "expired") {
          setTransfer(null);
          setLoading(false);
          pendingRef.current = null;
          setError("That payment account expired. Start again to get a new one.");
        }
        return;
      }

      // The money landed during a poll - switch to the processing overlay.
      if (silent) {
        setTransfer(null);
        setProcessing(true);
      }

      setProcessingStep(2);
      if (result.status === "success" && result.transaction) {
        setTxId(result.transaction.id);
        const isPending = result.transaction.status !== "COMPLETED";
        setTxPending(isPending);
        setProcessingStep(3);
        // Refresh data silently before showing success so receipt & lists are ready
        await Promise.all([refreshBalances(true), refreshTransactions()]);
        Haptics.notificationAsync(
          isPending
            ? Haptics.NotificationFeedbackType.Warning
            : Haptics.NotificationFeedbackType.Success
        );
        setProcessing(false);
        setLoading(false);
        animateSuccess();
      } else if (result.status === "failed" || result.status === "abandoned") {
        setProcessing(false);
        setLoading(false);
        pendingRef.current = null;
        setError("Payment was cancelled or failed. Please try again.");
      } else {
        setProcessing(false);
        setLoading(false);
        setError(result.message || "Payment not confirmed yet. Please try again.");
      }
    } catch (err: any) {
      setProcessing(false);
      setProcessingStep(0);
      setLoading(false);
      setError(err?.response?.data?.error || err.message || "Verification failed");
    } finally {
      verifyingRef.current = false;
    }
  };

  // Poll while the user is at their bank. The webhook is what actually credits
  // them; this just lets the screen move on promptly instead of waiting for a
  // push notification to arrive.
  useEffect(() => {
    if (!transfer) return;
    const id = setInterval(() => {
      verifyPayment(transfer.reference, true).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transfer?.reference]);

  // Countdown to the account's expiry, so the user can see the clock rather
  // than discovering it lapsed after they have already sent the money.
  useEffect(() => {
    if (!transfer) {
      setSecondsLeft(0);
      return;
    }
    const tick = () => {
      const ms = new Date(transfer.expiresAt).getTime() - Date.now();
      setSecondsLeft(Math.max(0, Math.floor(ms / 1000)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [transfer?.expiresAt]);

  const copyAccountNumber = async () => {
    if (!transfer) return;
    await Clipboard.setStringAsync(transfer.accountNumber);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  // Leaving the sheet does NOT cancel the payment: if the user has already
  // transferred, the webhook still credits them. Say so rather than implying
  // their money is lost.
  const handleCloseTransfer = () => {
    const ref = pendingRef.current;
    setTransfer(null);
    setLoading(false);
    if (ref) verifyPayment(ref, true).catch(() => {});
  };

  // The web popup that drove the Paystack checkout is gone with it: the
  // account number is shown in-app on every platform, so there is no second
  // window to open, navigate, or listen to.

  const handlePay = async () => {
    // Prevent double-tap / concurrent initializations
    if (loading || transfer || processing) return;

    const walletAddress = getWalletAddress();
    if (!walletAddress) {
      Alert.alert("No Wallet", "Wallet address not found. Please ensure your wallet is set up.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await initializeFunding({
        amountNaira: ngnAmount,
        token: asset,
        chain,
        walletAddress,
        convertedAmount: cryptoAmount,
      });

      pendingRef.current = result.reference;
      setTransfer(result);
    } catch (err: any) {
      setLoading(false);
      const data = err?.response?.data;

      /**
       * A question, not a payment error.
       *
       * Somebody who verified with a passport has no NIN on file and never
       * will - the number is not printed on the document. An alert saying
       * "Payment Error" with no field to answer it left them with nothing to
       * do but try again and fail again.
       */
      if (data?.code === "NIN_REQUIRED" && data?.canDeclare) {
        setNeedNin(data.error || "Your bank needs your National Identity Number.");
        return;
      }

      const msg = data?.error || err.message || "Failed to start payment";
      if (!err?.maintenanceHandled) Alert.alert("Payment Error", msg);
    }
  };

  return (
    <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* Answer it and the payment starts itself; decline and nothing moves. */}
      <NinPrompt
        visible={!!needNin}
        message={needNin}
        onCancel={() => setNeedNin(null)}
        onSaved={() => { setNeedNin(null); handlePay(); }}
      />

      <View style={ts.header}>
        <TouchableOpacity onPress={() => router.back()} disabled={processing}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[ts.headerTitle, { color: colors.foreground }]}>Order Summary</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: bottomPad + 90 }}>
        {/* Asset Info */}
        <View style={{ alignItems: "center", marginTop: 24, marginBottom: 28 }}>
          <TokenLogo symbol={asset} size={56} />
          <Text style={[loc.assetTitle, { color: colors.foreground }]}>
            Buy {assetName}
          </Text>
          <Text style={[loc.networkText, { color: colors.mutedForeground }]}>
            on {network}
          </Text>
        </View>

        {/* Breakdown Card */}
        <View style={{ paddingHorizontal: 20 }}>
          <View style={[ts.breakdownCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={ts.breakdownRow}>
              <Text style={[ts.breakdownLabel, { color: colors.mutedForeground }]}>You pay</Text>
              <Text style={[ts.breakdownValue, { color: colors.foreground }]}>{fmtNaira(ngnAmount)}</Text>
            </View>
            <View style={ts.breakdownRow}>
              <Text style={[ts.breakdownLabel, { color: colors.mutedForeground }]}>You receive</Text>
              <Text style={[ts.breakdownValue, { color: colors.foreground }]}>
                {cryptoAmount.toFixed(asset === "ETH" ? 8 : 4)} {asset}
              </Text>
            </View>
            <View style={ts.breakdownRow}>
              <Text style={[ts.breakdownLabel, { color: colors.mutedForeground }]}>Network</Text>
              <Text style={[ts.breakdownValue, { color: colors.foreground }]}>{network}</Text>
            </View>
            <View style={ts.breakdownRow}>
              <Text style={[ts.breakdownLabel, { color: colors.mutedForeground }]}>Rate</Text>
              <Text style={[ts.breakdownValue, { color: colors.foreground }]}>
                1 {asset} = {liveRate > 0 ? fmtNaira(liveRate) : fmtNaira(ngnAmount / cryptoAmount)}
              </Text>
            </View>
            <View style={ts.breakdownRow}>
              <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", gap: 4 }} onPress={() => setShowFeeInfo(true)}>
                <Text style={[ts.breakdownLabel, { color: colors.mutedForeground }]}>Fee</Text>
                <Feather name="info" size={14} color={colors.primary} />
              </TouchableOpacity>
              <Text style={[ts.breakdownValue, { color: colors.foreground }]}>{fmtNaira(feeNgn)}</Text>
            </View>
            <View style={[ts.breakdownDivider, { backgroundColor: colors.border }]} />
            <View style={ts.breakdownRow}>
              <Text style={[ts.breakdownLabelBold, { color: colors.foreground }]}>Total</Text>
              <Text style={[ts.breakdownValueBold, { color: colors.foreground }]}>{fmtNaira(total)}</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Error Message */}
      {error && (
        <View style={{ paddingHorizontal: 20, marginBottom: 8 }}>
          <Text style={{ color: "#ef4444", fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center" }}>
            {error}
          </Text>
        </View>
      )}

      {/* Pay / Verify Button */}
      <View style={[ts.bottomBar, { paddingBottom: bottomPad + 16, backgroundColor: colors.background }]}>
        {pendingRef.current && !processing ? (
          <TouchableOpacity
            style={[ts.primaryBtn, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
            onPress={() => pendingRef.current && verifyPayment(pendingRef.current)}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Text style={[ts.primaryBtnText, { color: colors.primaryForeground }]}>
                Verify Payment
              </Text>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[ts.primaryBtn, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
            onPress={handlePay}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Text style={[ts.primaryBtnText, { color: colors.primaryForeground }]}>
                Pay {fmtNaira(total)}
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Fee Info Modal */}
      {showFeeInfo && (
        <Modal transparent animationType="fade" visible>
          <TouchableOpacity style={loc.feeOverlay} activeOpacity={1} onPress={() => setShowFeeInfo(false)}>
            <View style={[loc.feeCard, { backgroundColor: colors.card }]} onStartShouldSetResponder={() => true}>
              <View style={[loc.feeIconWrap, { backgroundColor: colors.primary + "18" }]}>
                <Feather name="info" size={24} color={colors.primary} />
              </View>
              <Text style={[loc.feeTitle, { color: colors.foreground }]}>Processing Fee</Text>
              <Text style={[loc.feeDesc, { color: colors.mutedForeground }]}>
                Money Moves charges a fee of 1% on crypto purchases. This covers network and processing costs.
              </Text>
              <TouchableOpacity
                style={[loc.feeBtn, { backgroundColor: colors.foreground }]}
                onPress={() => setShowFeeInfo(false)}
              >
                <Text style={[loc.feeBtnText, { color: colors.background }]}>Okay</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Transfer sheet — where the user actually pays. */}
      {transfer && (
        <Modal animationType="slide" transparent visible onRequestClose={handleCloseTransfer}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
            <View
              style={{
                backgroundColor: colors.card,
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                paddingHorizontal: 24,
                paddingTop: 12,
                paddingBottom: 32,
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: "rgba(150,150,150,0.4)",
                  alignSelf: "center",
                  marginBottom: 18,
                }}
              />

              <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 21, lineHeight: 28, fontFamily: "Inter_700Bold", color: colors.foreground }}>
                    Transfer ₦{Number(transfer.amountNaira).toLocaleString()}
                  </Text>
                  <Text style={{ fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 4 }}>
                    Send the exact amount from your bank app. We'll credit you the moment it lands.
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={handleCloseTransfer}
                  hitSlop={8}
                  style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }}
                >
                  <Feather name="x" size={17} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>

              <View
                style={{
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  borderWidth: 1,
                  borderRadius: 18,
                  padding: 18,
                  marginTop: 20,
                }}
              >
                <Text style={{ fontSize: 12, lineHeight: 16, fontFamily: "Inter_500Medium", color: colors.mutedForeground }}>
                  {transfer.bankName}
                </Text>
                <TouchableOpacity
                  onPress={copyAccountNumber}
                  activeOpacity={0.7}
                  style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}
                >
                  <Text style={{ flex: 1, fontSize: 28, lineHeight: 36, fontFamily: "Inter_700Bold", color: colors.foreground, letterSpacing: 1 }}>
                    {transfer.accountNumber}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Feather name={copied ? "check" : "copy"} size={16} color={colors.primary} />
                    <Text style={{ fontSize: 13, lineHeight: 18, fontFamily: "Inter_600SemiBold", color: colors.primary }}>
                      {copied ? "Copied" : "Copy"}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>

              {/* An expiry the user cannot see is one they find out about after
                  they have already sent the money. */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 16 }}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={{ fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium", color: colors.mutedForeground }}>
                  {secondsLeft > 0
                    ? `Waiting for your transfer · expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`
                    : "This account has expired"}
                </Text>
              </View>

              <Text style={{ fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center", marginTop: 14 }}>
                This account is for this purchase only. You can close this screen — we'll notify you when it's done.
              </Text>
            </View>
          </View>
        </Modal>
      )}


      {/* Processing Overlay — old one removed, only the custom modal above */}

      {/* Success Bottom Sheet */}
      {showSuccess && (
        <Modal transparent animationType="none" visible>
          <View style={loc.overlay}>
            <Animated.View style={[loc.dimBg, { opacity: overlayAnim }]} />
            <Animated.View
              style={[loc.sheet, { backgroundColor: colors.card, paddingBottom: bottomPad + 24, transform: [{ translateY: sheetAnim }] }]}
            >
              <View style={loc.handle} />
              <Animated.View style={[loc.checkOuter, { borderColor: txPending ? "#f59e0b44" : SUCCESS_RING, transform: [{ scale: checkAnim }] }]}>
                {/* Only the finished state gets the artwork. Money taken and
                    coins not yet sent is not a success, and a green tick over
                    it would say it was. */}
                {txPending ? (
                  <View style={[loc.checkInner, { backgroundColor: "#f59e0b" }]}>
                    <Feather name="clock" size={32} color="#fff" />
                  </View>
                ) : (
                  <SuccessMark size={52} />
                )}
              </Animated.View>

              <Text style={[loc.successTitle, { color: colors.foreground }]}>
                {txPending ? "Payment Received" : "Purchase Successful!"}
              </Text>
              <Text style={[loc.successSub, { color: colors.mutedForeground }]}>
                {txPending
                  ? `Your ₦${ngnAmount.toLocaleString()} payment was received.\n${cryptoAmount.toFixed(asset === "ETH" ? 8 : 4)} ${asset} delivery is being processed.`
                  : `You bought ${cryptoAmount.toFixed(asset === "ETH" ? 8 : 4)} ${asset}`}
              </Text>

              <View style={loc.actions}>
                <TouchableOpacity
                  style={[loc.secondaryBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                  onPress={() => {
                    setShowSuccess(false);
                    router.replace({ pathname: "/transactions/receipt", params: { id: txId, done: "1" } } as any);
                  }}
                >
                  <Feather name="file-text" size={15} color={colors.foreground} style={{ marginRight: 6 }} />
                  <Text style={[loc.secondaryText, { color: colors.foreground }]}>View Receipt</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[loc.doneBtn, { backgroundColor: colors.foreground }]}
                  onPress={() => { setShowSuccess(false); router.replace("/(tabs)"); }}
                >
                  <Text style={[loc.doneText, { color: colors.background }]}>Done</Text>
                </TouchableOpacity>
              </View>
            </Animated.View>
          </View>
        </Modal>
      )}

      {/* Processing Overlay — verifying & sending crypto */}
      <TransactionProcessingOverlay visible={processing} variant="buy" asset={asset} chain={chain} amount={String(cryptoAmount)} currentStep={processingStep} />
    </View>
  );
}

const loc = StyleSheet.create({
  assetTitle: { fontSize: 22, fontFamily: "Inter_700Bold", marginTop: 12 },
  networkText: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 4 },

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
  procTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 8 },
  procSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },

  /* Success */
  overlay: { flex: 1, justifyContent: "flex-end" },
  dimBg: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.85)" },
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 12, paddingHorizontal: 24, alignItems: "center",
  },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: "#ccc", marginBottom: 32 },
  checkOuter: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 3,
    alignItems: "center", justifyContent: "center", marginBottom: 20,
  },
  checkInner: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: "#22c55e",
    alignItems: "center", justifyContent: "center",
  },
  successTitle: { fontSize: 24, fontFamily: "Inter_700Bold", marginBottom: 6 },
  successSub: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 36 },
  actions: { flexDirection: "row", gap: 12, width: "100%" },
  secondaryBtn: {
    flex: 1, height: 50, borderRadius: 14, borderWidth: 1,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
  },
  secondaryText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  doneBtn: { flex: 1, height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  doneText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
