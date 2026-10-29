import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Platform,
  Keyboard,
  Clipboard,
  Alert,
  ScrollView,
  Animated,
  Image,
  Easing,
  PanResponder,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { useColors } from "@/hooks/useColors";
import { StageTrack, STAGE_DONE, STAGE_PENDING } from "@/components/StageTrack";
import { Keypad } from "@/components/Keypad";
import { useApp } from "@/context/AppContext";
import { prepareBill, submitBill } from "@/services/bills";
import { signMovementTransaction, signSolanaTransaction, signTonTransaction, signEvmTransaction, getLocalAddresses, ensureSigningSession } from "@/services/wallet-core";
import { signStellarTransaction } from "@/services/stellar";
import { assetLabel } from "@/constants/transfer";

import { SuccessMark, SUCCESS_HALO } from "@/components/SuccessMark";
type Step = "summary" | "pin";

const CHAIN_LOGOS: Record<string, any> = {
  MOVE: require("@/assets/images/movementnew.jpg"),
  BASE: require("@/assets/images/base logo.png"),
  SOL: require("@/assets/images/solana.png"),
  BEP20: require("@/assets/images/bsc logo.png"),
  ARC: require("@/assets/images/ARC.jpg"),
  TON: require("@/assets/images/toncoin.png"),
  STELLAR: require("@/assets/images/stellar.jpg"),
  MONAD: require("@/assets/images/monad.png"),
};
const CHAIN_NAMES: Record<string, string> = {
  MOVE: "Movement", BASE: "Base", SOL: "Solana", BEP20: "BSC", ARC: "Arc", TON: "TON", STELLAR: "Stellar", MONAD: "Monad",
};
const TOKEN_LOGOS: Record<string, any> = {
  USDC: require("@/assets/images/usdc-logo.png"),
  USDCx: require("@/assets/images/usdc-logo.png"),
  USDT: require("@/assets/images/usdt.png"),
  MOVE: require("@/assets/images/movementnew.jpg"),
  SOL: require("@/assets/images/solanatoken.png"),
};

export default function ElectricitySummaryScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { verifyPin, bioTx, walletBalances, refreshBalances, refreshTransactions, rates } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const params = useLocalSearchParams<{
    meterNumber: string;
    customerName: string;
    disco: string;
    discoLabel: string;
    meterType: string;
    amount: string;
    fee: string;
  }>();

  const meterNumber = params.meterNumber || "";
  const customerName = params.customerName || "";
  const disco = params.disco || "";
  const discoLabel = params.discoLabel || disco;
  const meterType = (params.meterType || "prepaid") as "prepaid" | "postpaid";
  const amount = Number(params.amount || "0");
  const fee = Number(params.fee || "200");
  const totalDebit = amount + fee;

  const [step, setStep] = useState<Step>("summary");
  const [pin, setPin] = useState("");

  const [pinError, setPinError] = useState(false);
  /**
   * A shake on a wrong PIN.
   *
   * JS-driven on purpose: a native-driver animation inside a Modal lives in a
   * different window and can silently do nothing, which this screen has already
   * been bitten by once. Four steps over a quarter of a second is nothing for
   * the JS thread.
   */
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!pinError) return;
    Animated.sequence(
      [12, -12, 7, 0].map((toValue) =>
        Animated.timing(shake, { toValue, duration: 55, useNativeDriver: false }),
      ),
    ).start();
  }, [pinError, shake]);

  const [processing, setProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);
  // Delivered, or merely accepted. A meter that has not vended yet has no
  // token to show, and saying "completed" over an empty space is a lie.
  const [pending, setPending] = useState(false);
  const [txId, setTxId] = useState("");
  const [refId, setRefId] = useState("");
  const [electricityToken, setElectricityToken] = useState("");
  const [selectedWallet, setSelectedWallet] = useState<{ asset: string; chain: string; balance: number } | null>(null);
  const [showWalletPicker, setShowWalletPicker] = useState(false);


  const sheetAnim = useRef(new Animated.Value(400)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const checkAnim = useRef(new Animated.Value(0)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!processing) return;
    const spin = Animated.loop(Animated.timing(spinAnim, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }));
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.08, duration: 800, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
    ]));
    spin.start(); pulse.start();
    return () => { spin.stop(); pulse.stop(); };
  }, [processing]);

  const spinInterpolate = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  const eligibleWallets = useMemo(() =>
    walletBalances
      // Native Movement USDC is the USDCx asset (shown as USDC). The legacy
      // bridged USDC.e on Movement is withdrawal-only, so exclude it here.
      .filter((w) => w.balance >= 0.0001
        && !(w.asset === "USDC" && w.chain === "MOVE")
        && ["USDC", "USDT", "MOVE", "SOL", "USDCx"].includes(w.asset))
      .sort((a, b) => {
        const aUsd = a.balance * ((rates?.[a.asset as keyof typeof rates] as any)?.usd || 0);
        const bUsd = b.balance * ((rates?.[b.asset as keyof typeof rates] as any)?.usd || 0);
        return bUsd - aUsd;
      }),
    [walletBalances, rates]
  );

  const walletPickerPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderRelease: (_, { dy }) => { if (dy > 40) setShowWalletPicker(false); },
    })
  ).current;

  useEffect(() => {
    if (eligibleWallets.length > 0 && !selectedWallet) {
      const best = eligibleWallets.find((w) => {
        const ngnRate = rates?.[w.asset as keyof typeof rates] as any;
        const rate = ngnRate?.ngn || 1500;
        const neededCrypto = totalDebit / rate;
        return w.balance >= neededCrypto;
      }) || eligibleWallets[0];
      setSelectedWallet(best);
    }
  }, [eligibleWallets, rates]);

  const formattedAmount = `₦${amount.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
  const formattedFee = `₦${fee.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
  const formattedTotal = `₦${totalDebit.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
  const usdEquiv = (totalDebit / (rates?.USDC?.ngn || 1555)).toFixed(2);

  /**
   * Takes the whole PIN so far rather than one box at a time.
   *
   * With a keypad instead of four inputs there is no per-box focus to shuffle;
   * the string is the state, and reaching four characters is what submits.
   */
  const handlePinInput = (next: string) => {
    setPinError(false);
    if (next.length > 4) return;
    setPin(next);
    if (next.length < 4) return;

    setStep("summary");
    setPin("");
    setProcessing(true);
    (async () => {
      const reject = () => {
        setProcessing(false);
        setStep("pin");
        setPinError(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setTimeout(() => setPin(""), 600);
      };
      try {
        if (await verifyPin(next)) handlePurchase();
        else reject();
      } catch {
        reject();
      }
    })();
  };

  const handlePurchase = async () => {
    // Show the processing overlay immediately (covers both PIN and biometric paths)
    setProcessing(true);
    try {
      if (!selectedWallet) {
        throw new Error("Insufficient balance. Deposit or buy crypto to continue.");
      }

      const asset = selectedWallet.asset as "USDC" | "USDT" | "USDCx" | "MOVE" | "SOL";
      const chain = selectedWallet.chain as "MOVE" | "BASE" | "SOL" | "BEP20" | "ARC" | "TON" | "STELLAR" | "MONAD";
      setProcessingStep(0);
      const localAddrs = await getLocalAddresses().catch(() => null);
      setProcessingStep(1);

      // Phase 1: Prepare
      // A lapsed wallet session signs out here, before the server opens a row it couldn't then close.
      await ensureSigningSession();
      const prepareResult = await prepareBill({
        type: "electricity",
        phone: meterNumber,
        network: disco,
        amount,
        asset,
        chain,
        senderAddress: localAddrs?.[chain] || undefined,
        meterType,
        customerName,
        disco,
      });

      const { billId, signingMessage, txRequest } = prepareResult as any;
      setProcessingStep(2);

      // Phase 2: Sign
      let signature: string;
      let publicKey: string;
      let signedRaw: string | undefined;
      if (chain === "MOVE") {
        ({ signature, publicKey } = await signMovementTransaction(signingMessage));
      } else if (chain === "SOL") {
        ({ signature, publicKey } = await signSolanaTransaction(signingMessage));
      } else if (chain === "TON") {
        // Ed25519, same key as Solana. The hash is of a cell rather than a
        // transaction message, which changes nothing here.
        ({ signature, publicKey } = await signTonTransaction(signingMessage));
      } else if (chain === "STELLAR") {
        // Ed25519, same key as Solana, over the transaction hash. The treasury
        // pays the fee, so the user needs no XLM.
        ({ signature, publicKey } = await signStellarTransaction(signingMessage));
      } else {
        // An MPC wallet cannot sign a bare hash, so it signs the whole
        // transaction and returns the raw signed bytes instead of a signature.
        ({ signature, publicKey, signedRaw } = await signEvmTransaction(
          signingMessage,
          txRequest
        ));
      }

      setProcessingStep(3);
      // Phase 3: Submit
      const submitResult = await submitBill({ billId, signature, publicKey, signedRaw });
      setProcessingStep(4);

      if (submitResult.status === "FAILED") {
        setProcessing(false);
        refreshBalances(true);
        refreshTransactions();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert("Purchase Failed", submitResult.message || "Electricity purchase failed. Please contact support.");
        return;
      }

      // Extract electricity token if present. Backend also surfaces this at
      // the top level, but check vtuResult fallbacks for older responses.
      const vResult = submitResult.vtuResult;
      const token =
        submitResult.electricityToken ||
        // What Flutterwave actually calls it. Leaving it out of this chain is
        // what lost a paid-for token once already.
        vResult?.recharge_token ||
        vResult?.data?.recharge_token ||
        vResult?.data?.token ||
        vResult?.token ||
        vResult?.data?.purchased_code ||
        vResult?.purchased_code ||
        vResult?.data?.data?.token ||
        vResult?.data?.data?.purchased_code;
      if (token) setElectricityToken(String(token));

      // Accepted is not the same as vended. A meter that has not returned a
      // token yet is still in progress, and saying "completed" over an empty
      // space is a promise the screen cannot keep.
      setPending(submitResult.status !== "COMPLETED" && !token);

      setTxId(billId);
      setRefId(submitResult.txHash || billId);

      refreshBalances(true);
      refreshTransactions();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setProcessing(false);
      setShowSuccess(true);
      sheetAnim.setValue(400);
      overlayAnim.setValue(1);
      checkAnim.setValue(0);
      Animated.spring(sheetAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }).start(() => {
        Animated.spring(checkAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 5 }).start();
      });
    } catch (err: any) {
      setProcessing(false);
      setProcessingStep(0);
      /**
       * Say what went wrong, somewhere it can be read.
       *
       * This caught everything and showed a sentence, so a bill that failed
       * left no trace at all: the server has no record either, because the
       * row is created before the signing message is built and a throw after
       * that point writes nothing to it. Four failures in twenty minutes were
       * diagnosable only down to "somewhere after prepare".
       *
       * response.data alone is not enough - a signing timeout, an unsupported
       * wallet or an RPC failure carries no response body, and keying off it
       * collapses every one of them to the generic line.
       */
      console.error("[BILLS] failed:", err?.response?.status, err?.response?.data || err);
      const msg = err?.response?.data?.error || err?.message || "Purchase failed. Please try again.";
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (!err?.maintenanceHandled) Alert.alert("Purchase Failed", msg);
    }
  };

  const copyToken = () => {
    try { Clipboard.setString(electricityToken); } catch {}
    Alert.alert("Copied", "Electricity token copied");
  };

  const copyRef = () => {
    try { Clipboard.setString(refId); } catch {}
    Alert.alert("Copied", "Reference ID copied");
  };

  /* ─── PIN BOTTOM SHEET ─── */
  const renderPinSheet = () =>
    step === "pin" ? (
      <Modal transparent animationType="slide" visible>
        <TouchableOpacity
          style={s.overlay}
          activeOpacity={1}
          onPress={() => { setStep("summary"); setPin(""); }}
        >
          <View
            style={[s.sheet, { backgroundColor: colors.card, paddingBottom: bottomPad + 16 }]}
            onStartShouldSetResponder={() => true}
            {...(Platform.OS === "web" ? { onClick: (e: any) => e.stopPropagation() } : {})}
          >
            <View style={[s.handle, { backgroundColor: colors.border }]} />

            <Text style={[s.pinHeading, { color: colors.foreground }]}>Confirm with PIN</Text>
            <Text style={[s.pinSub, { color: colors.mutedForeground }]}>
              Enter your 4-digit PIN to authorise this purchase
            </Text>

            {/* Dots rather than boxes. Four empty rounded squares read as
                fields waiting to be tapped, which these are not - there is
                nothing to focus, only somewhere to look while you press keys. */}
            <Animated.View style={[s.pinRow, { transform: [{ translateX: shake }] }]}>
              {[0, 1, 2, 3].map((i) => {
                const filled = i < pin.length;
                return (
                  <View
                    key={i}
                    style={[
                      s.pinDot,
                      filled
                        ? { backgroundColor: pinError ? colors.destructive : colors.primary }
                        : { borderWidth: 2, borderColor: pinError ? colors.destructive + "66" : colors.border },
                    ]}
                  />
                );
              })}
            </Animated.View>

            {/* Fixed slot, so the keypad does not jump when the error appears. */}
            <Text
              style={[s.pinErr, { color: pinError ? colors.destructive : "transparent" }]}
              numberOfLines={1}
            >
              Incorrect PIN, try again
            </Text>

            <Keypad
              style={s.pinPad}
              disabled={pin.length >= 4}
              onKey={(d) => handlePinInput(pin + d)}
              onBackspace={() => { setPinError(false); setPin(pin.slice(0, -1)); }}
            />

            <TouchableOpacity style={s.forgotWrap} hitSlop={10}>
              <Text style={[s.forgotPin, { color: colors.mutedForeground }]}>Forgot PIN?</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    ) : null;

  /* ─── SUMMARY ─── */
  const stagesFor = (delivered: boolean) => [
    { label: "Initiated", kind: "sent" as const, color: colors.foreground + "B3" },
    { label: "Processing", kind: "dot" as const, color: STAGE_PENDING },
    ...(delivered ? [{ label: "Delivered", kind: "badge" as const, color: STAGE_DONE }] : []),
  ];

  /* ─── IN FLIGHT ─── */
  /**
   * The same track the transaction sheet shows afterwards, live.
   *
   * A spinner tells you to wait; this tells you where it has got to, in the
   * shape you will see again the next time you open the transaction - so the
   * wait and the record are one picture rather than two.
   */
  if (processing) {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <View style={s.header}>
          <View style={{ width: 36 }} />
          <Text style={[s.headerTitle, { color: colors.foreground }]}>Paying your bill</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={[s.rule, { backgroundColor: colors.border }]} />

        <View style={s.flight}>
          <View style={s.flightAmountRow}>
            <Image
              source={require("@/assets/images/nairaiconnew.png")}
              style={[s.flightNaira, { tintColor: colors.foreground }]}
            />
            <Text style={[s.flightAmount, { color: colors.foreground }]}>
              {Number(amount).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
            </Text>
          </View>

          <Text style={[s.flightTo, { color: colors.mutedForeground }]}>
            {meterNumber} · {discoLabel}
          </Text>

          <View style={[s.flightTrack, { backgroundColor: colors.card }]}>
            <StageTrack stages={stagesFor(processingStep >= 4)} />
          </View>

          <Text style={[s.flightNote, { color: colors.mutedForeground }]}>
            Keep this screen open while it goes through. It usually takes a few seconds.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} disabled={processing} style={[s.backBtn, { backgroundColor: colors.card }]}>
          <Feather name="chevron-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.foreground }]}>Confirm Purchase</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
        {/* Badge row */}
        <View style={s.badgeRow}>
          <View style={[s.typeBadge, { backgroundColor: colors.primary + "18" }]}>
            <Feather name="zap" size={14} color={colors.primary} style={{ marginRight: 4 }} />
            <Text style={[s.typeBadgeText, { color: colors.primary }]}>Electricity</Text>
          </View>
        </View>

        {/* Amount */}
        <View style={s.amountBlock}>
          <Text style={[s.amountBig, { color: colors.foreground }]}>{formattedTotal}</Text>
          <Text style={[s.amountUsd, { color: colors.mutedForeground }]}>≈ ${usdEquiv} USD</Text>
        </View>

        {/* Pay from wallet selector */}
        {selectedWallet ? (
          <TouchableOpacity
            style={[s.payFromCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => eligibleWallets.length > 1 && setShowWalletPicker(true)}
            activeOpacity={eligibleWallets.length > 1 ? 0.7 : 1}
          >
            <Image source={TOKEN_LOGOS[selectedWallet.asset]} style={s.payFromTokenLogo} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={[s.payFromLabel, { color: colors.mutedForeground }]}>Pay from</Text>
              <Text style={[s.payFromValue, { color: colors.foreground }]}>
                {assetLabel(selectedWallet.asset)} on {CHAIN_NAMES[selectedWallet.chain] || selectedWallet.chain}
              </Text>
            </View>
            <Text style={[s.payFromBal, { color: colors.mutedForeground }]}>
              {selectedWallet.balance.toFixed(4)} {assetLabel(selectedWallet.asset)}
              {rates?.[selectedWallet.asset as keyof typeof rates] ? (
                `\n≈ $${(selectedWallet.balance * ((rates[selectedWallet.asset as keyof typeof rates] as any)?.usd || 0)).toFixed(2)}`
              ) : ""}
            </Text>
            <Image source={CHAIN_LOGOS[selectedWallet.chain]} style={s.payFromChainLogo} />
            {eligibleWallets.length > 1 && (
              <Feather name="chevron-down" size={18} color={colors.mutedForeground} style={{ marginLeft: 4 }} />
            )}
          </TouchableOpacity>
        ) : (
          <View style={[s.payFromCard, { backgroundColor: "#ef444415", borderColor: "#ef444440" }]}>
            <Feather name="alert-circle" size={22} color="#ef4444" />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#ef4444" }}>Insufficient Balance</Text>
              <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 }}>
                You don't have enough crypto to cover ₦{totalDebit.toLocaleString()}. Deposit or buy crypto first.
              </Text>
            </View>
          </View>
        )}

        {/* Info card */}
        <View style={[s.infoCard, { backgroundColor: colors.card }]}>
          <InfoRow label="Meter Number" value={meterNumber} colors={colors} />
          <View style={[s.sep, { backgroundColor: colors.border }]} />
          <InfoRow label="Customer Name" value={customerName} colors={colors} />
          <View style={[s.sep, { backgroundColor: colors.border }]} />
          <InfoRow label="Biller" value={discoLabel} colors={colors} />
          <View style={[s.sep, { backgroundColor: colors.border }]} />
          <InfoRow label="Type" value={meterType === "prepaid" ? "Prepaid" : "Postpaid"} colors={colors} />
          <View style={[s.sep, { backgroundColor: colors.border }]} />
          <InfoRow label="Amount" value={formattedAmount} colors={colors} />
          <View style={[s.sep, { backgroundColor: colors.border }]} />
          <InfoRow label="Fee" value={formattedFee} colors={colors} />
          <View style={[s.sepThick, { backgroundColor: colors.border }]} />
          <View style={s.totalRow}>
            <Text style={[s.totalLabel, { color: colors.foreground }]}>Total Debit</Text>
            <Text style={[s.totalValue, { color: colors.foreground }]}>{formattedTotal}</Text>
          </View>
        </View>
      </ScrollView>

      {/* CTA */}
      <View style={[s.ctaWrap, { paddingBottom: bottomPad + 16, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[s.ctaBtn, { backgroundColor: selectedWallet ? colors.primary : colors.card, opacity: selectedWallet ? 1 : 0.5 }]}
          disabled={!selectedWallet}
          onPress={() => {
            if (bioTx && Platform.OS !== "web") {
              LocalAuthentication.authenticateAsync({
                promptMessage: "Confirm Transaction",
                fallbackLabel: "Use PIN",
                cancelLabel: "Cancel",
              }).then((result) => {
                if (result.success) { handlePurchase(); return; }
                setStep("pin");
              }).catch(() => {
                setStep("pin");
              });
            } else {
              setStep("pin");
            }
          }}
        >
          <Feather name="shield" size={18} color={colors.primaryForeground} style={{ marginRight: 8 }} />
          <Text style={[s.ctaBtnText, { color: colors.primaryForeground }]}>Pay for Electricity</Text>
        </TouchableOpacity>
      </View>

      {renderPinSheet()}

      {/* Wallet Picker Modal */}
      {showWalletPicker && (
        <Modal transparent animationType="slide" visible>
          <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setShowWalletPicker(false)}>
            <View
              {...walletPickerPan.panHandlers}
              style={[s.walletSheet, { backgroundColor: colors.card, paddingBottom: bottomPad + 24 }]}
            >
              <View style={s.handle} />
              <Text style={[s.walletSheetTitle, { color: colors.foreground }]}>Pay from</Text>
              <ScrollView style={{ width: "100%" }} showsVerticalScrollIndicator={false}>
                {eligibleWallets.map((w) => {
                  const isSel = selectedWallet?.asset === w.asset && selectedWallet?.chain === w.chain;
                  return (
                    <TouchableOpacity
                      key={`${w.asset}-${w.chain}`}
                      style={[s.walletRow, { borderColor: isSel ? colors.primary : colors.border, backgroundColor: isSel ? colors.primary + "08" : "transparent" }]}
                      onPress={() => { setSelectedWallet(w); setShowWalletPicker(false); }}
                    >
                      <Image source={TOKEN_LOGOS[w.asset]} style={s.walletTokenLogo} />
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={[s.walletAssetText, { color: colors.foreground }]}>
                          {assetLabel(w.asset)} on {CHAIN_NAMES[w.chain] || w.chain}
                        </Text>
                        <Text style={[s.walletBalText, { color: colors.mutedForeground }]}>
                          {w.balance.toFixed(4)} {assetLabel(w.asset)}
                          {rates?.[w.asset as keyof typeof rates] ? (
                            ` ≈ $${(w.balance * ((rates[w.asset as keyof typeof rates] as any)?.usd || 0)).toFixed(2)}`
                          ) : ""}
                        </Text>
                      </View>
                      <Image source={CHAIN_LOGOS[w.chain]} style={s.walletChainLogo} />
                      {isSel && <Ionicons name="checkmark-circle-outline" size={20} color={colors.primary} style={{ marginLeft: 8 }} />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Processing Overlay */}

      {/* Success Bottom Sheet */}
      {showSuccess && (
        <Modal transparent animationType="none" visible>
          <View style={s.successOverlay}>
            <Animated.View style={[s.dimBg, { opacity: overlayAnim }]} />
            <Animated.View
              style={[
                s.successScreen,
                { backgroundColor: colors.background, paddingTop: topPad + 40, paddingBottom: bottomPad + 20 },
              ]}
            >
              <ScrollView contentContainerStyle={s.successBody} showsVerticalScrollIndicator={false}>
                <Animated.View
                  style={[
                    s.checkOuter,
                    { backgroundColor: SUCCESS_HALO, borderWidth: 0, transform: [{ scale: checkAnim }] },
                  ]}
                >
                  <SuccessMark size={52} />
                </Animated.View>

                <Text style={[s.successHeading, { color: colors.foreground }]}>
                  {pending ? "Payment in progress" : "Payment completed"}
                </Text>

                <View style={[s.successPill, { backgroundColor: colors.card }]}>
                  <Image
                    source={require("@/assets/images/flash.png")}
                    style={[s.successPillIcon, { tintColor: colors.mutedForeground }]}
                  />
                  <Text style={[s.successPillText, { color: colors.foreground }]}>Electricity</Text>
                </View>

                {/* The token first, above the receipt.
                    It is the only part of this screen anybody has to act on -
                    twenty digits typed into a keypad on a wall, off a phone
                    held in the other hand - so it is grouped in fours, set
                    large, and tappable across its whole width. */}
                {!!electricityToken && (
                  <TouchableOpacity
                    onPress={copyToken}
                    activeOpacity={0.7}
                    style={[
                      s.tokenCard,
                      { backgroundColor: colors.primary + "12", borderColor: colors.primary + "2E" },
                    ]}
                  >
                    <View style={s.tokenHead}>
                      <Text style={[s.tokenLabel, { color: colors.mutedForeground }]}>
                        Electricity token
                      </Text>
                      <View style={s.tokenCopyWrap}>
                        <Feather name="copy" size={13} color={colors.mutedForeground} />
                        <Text style={[s.tokenCopyText, { color: colors.mutedForeground }]}>Copy</Text>
                      </View>
                    </View>
                    <Text
                      style={[s.tokenValue, { color: colors.foreground }]}
                      selectable
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.75}
                    >
                      {groupToken(electricityToken)}
                    </Text>
                  </TouchableOpacity>
                )}

                {/* The same track, at rest. Ending on a tick alone discards
                    the thing that was telling the story while they waited. */}
                <View style={[s.flightTrack, { backgroundColor: colors.card, marginTop: 18 }]}>
                  <StageTrack stages={stagesFor(!pending)} />
                </View>

                <View style={[s.receiptCard, { backgroundColor: colors.card }]}>
                  <InfoRow label="Amount" value={formattedAmount} colors={colors} />
                  <InfoRow label="Meter Number" value={meterNumber} colors={colors} />
                  {!!customerName && <InfoRow label="Customer" value={customerName} colors={colors} />}
                  <InfoRow label="Biller" value={discoLabel} colors={colors} />

                  <View style={[s.receiptSep, { backgroundColor: colors.border }]} />

                  <InfoRow
                    label="Source"
                    value={
                      selectedWallet
                        ? `${assetLabel(selectedWallet.asset)} on ${CHAIN_NAMES[selectedWallet.chain] || selectedWallet.chain}`
                        : "-"
                    }
                    colors={colors}
                  />
                  <InfoRow label="Fee" value={formattedFee} colors={colors} />
                </View>
              </ScrollView>

              <View style={s.doneActions}>
                <TouchableOpacity
                  style={[s.doneBtn, { backgroundColor: colors.primary }]}
                  onPress={() => router.replace("/(tabs)")}
                  activeOpacity={0.85}
                >
                  <Text style={[s.doneBtnText, { color: colors.primaryForeground }]}>Done</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.successLink}
                  onPress={() => {
                    setShowSuccess(false);
                    // Nothing to put on a receipt until it has vended; while it
                    // is still moving the live detail sheet is the honest one.
                    router.replace(
                      pending
                        ? ({ pathname: "/transactions/detail", params: { id: txId } } as any)
                        : ({ pathname: "/transactions/receipt", params: { id: txId, done: "1" } } as any),
                    );
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[s.successLinkText, { color: colors.primary }]}>
                    {pending ? "View details" : "View receipt"}
                  </Text>
                </TouchableOpacity>
              </View>
            </Animated.View>
          </View>
        </Modal>
      )}
    </View>
  );
}

/**
 * A meter token in fours.
 *
 * Twenty digits in one run is a number nobody can keep their place in while
 * typing it into a keypad on a wall. Grouped only when it is all digits - some
 * discos return a reference with letters in it, and chopping that up would be
 * inventing structure that is not there.
 */
function groupToken(token: string): string {
  const bare = String(token).replace(/\s+/g, "");
  if (!/^\d{12,}$/.test(bare)) return token;
  return bare.replace(/(\d{4})(?=\d)/g, "$1 ");
}

function InfoRow({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={s.row}>
      <Text style={[s.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[s.rowValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  handle: { width: 40, height: 4, borderRadius: 2, marginBottom: 26 },
  pinHeading: {
    fontSize: 23,
    lineHeight: 29,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.6,
    textAlign: "center",
  },
  pinSub: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 6,
  },
  pinRow: { flexDirection: "row", gap: 16, marginTop: 26 },
  // Big enough to read at a glance from across the sheet, small enough that
  // four of them still read as one group.
  pinDot: { width: 16, height: 16, borderRadius: 8 },
  pinErr: {
    fontSize: 12.5,
    lineHeight: 17,
    fontFamily: "Inter_600SemiBold",
    marginTop: 14,
    marginBottom: 2,
  },
  pinPad: { alignSelf: "stretch", marginTop: 10 },
  forgotWrap: { paddingTop: 16, paddingBottom: 4 },
  forgotPin: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold" },

  container: { flex: 1 },
  rule: { height: StyleSheet.hairlineWidth },

  // ── in flight ──
  flight: { flex: 1, alignItems: "center", paddingTop: 54, paddingHorizontal: 20 },
  flightAmountRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  flightNaira: { width: 26, height: 26, resizeMode: "contain" },
  flightAmount: { fontSize: 40, lineHeight: 48, fontFamily: "Inter_700Bold", letterSpacing: -1.2 },
  flightTo: { fontSize: 13.5, fontFamily: "Inter_400Regular", marginTop: 6 },
  flightTrack: { alignSelf: "stretch", borderRadius: 18, padding: 16, marginTop: 30 },
  flightNote: {
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 22,
    paddingHorizontal: 20,
  },

  // ── success ──
  successScreen: { flex: 1, paddingHorizontal: 20 },
  successBody: { alignItems: "center", paddingBottom: 24 },
  successPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    marginTop: 10,
  },
  successPillIcon: { width: 14, height: 14, resizeMode: "contain" },
  successPillText: { fontSize: 12.5, fontFamily: "Inter_600SemiBold" },
  receiptCard: { alignSelf: "stretch", borderRadius: 18, paddingHorizontal: 16, paddingVertical: 6, marginTop: 14 },
  receiptSep: { height: StyleSheet.hairlineWidth, marginVertical: 6 },
  doneActions: { paddingTop: 6 },
  doneBtn: { height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  doneBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },
  successLink: { height: 46, alignItems: "center", justifyContent: "center", marginTop: 2 },
  successLinkText: { fontSize: 14.5, fontFamily: "Inter_600SemiBold" },

  // ── the token ──
  tokenHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tokenLabel: {
    fontSize: 11.5,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  tokenCopyWrap: { flexDirection: "row", alignItems: "center", gap: 5 },
  tokenCopyText: { fontSize: 11.5, fontFamily: "Inter_600SemiBold" },
  tokenValue: {
    fontSize: 19,
    lineHeight: 26,
    marginTop: 8,
    fontFamily: "Inter_700Bold",
    // Groups of four already do the separating; extra tracking on top of that
    // is what pushed twenty digits into the edges of the card.
    letterSpacing: 0,
    fontVariant: ["tabular-nums"],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 8,
  },
  typeBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
  },
  typeBadgeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  amountBlock: { alignItems: "center", marginTop: 16, marginBottom: 24 },
  amountBig: { fontSize: 38, fontFamily: "Inter_700Bold", letterSpacing: -1 },
  amountUsd: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 4 },
  infoCard: {
    marginHorizontal: 20,
    borderRadius: 20,
    padding: 20,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 2,
  },
  rowLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  rowValue: { fontSize: 14, fontFamily: "Inter_500Medium", textAlign: "right", flexShrink: 1 },
  sep: { height: StyleSheet.hairlineWidth, marginVertical: 14 },
  sepThick: { height: 1, marginVertical: 14 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalLabel: { fontSize: 15, fontFamily: "Inter_700Bold" },
  totalValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  ctaWrap: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  ctaBtn: {
    height: 54,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  ctaBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  /**
   * Centred in the space the keypad leaves, rather than pinned to the top.
   *
   * Reserving a keypad's worth of height at the bottom and centring in what is
   * left puts the sheet in the middle of the space you can actually see. It
   * also scales: on a shorter phone the reserved strip is proportionally
   * larger, so the sheet rises with it instead of running into the keys.
   */
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    alignItems: "center",
  },
  successOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  dimBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.85)",
  },
  successSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  sheetHandle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#ccc",
    marginBottom: 32,
  },
  checkOuter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  successHeading: { fontSize: 24, fontFamily: "Inter_700Bold", marginBottom: 6 },
  successSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 20 },
  // A column, not a row.
  //
  // This was left over from the previous design, where an icon, a label and a
  // copy glyph sat side by side on one line. The card stacks a head above the
  // token now, and the inherited `flexDirection: "row"` laid those two out
  // beside each other instead - which put the label, the copy button and
  // twenty digits on a single line and pushed the digits off the card.
  tokenCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 13,
    paddingBottom: 17,
    width: "100%",
    marginTop: 18,
    marginBottom: 20,
  },
  successActions: { flexDirection: "row" as const, gap: 12, width: "100%" as any },
  successSecondary: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  successSecondaryText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  successDone: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  successDoneText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  procOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center", paddingHorizontal: 40 },
  procLogoWrap: { marginBottom: 28 },
  procRing: { width: 100, height: 100, alignItems: "center", justifyContent: "center" },
  procSpinner: { position: "absolute", width: 100, height: 100, alignItems: "center", justifyContent: "center" },
  procArc: { width: 100, height: 100, borderRadius: 50, borderWidth: 3, borderColor: "transparent" },
  procLogo: { width: 48, height: 48, borderRadius: 12 },
  procTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 8 },
  procSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },

  /* Wallet selector */
  payFromCard: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  payFromTokenLogo: { width: 32, height: 32, borderRadius: 16 },
  payFromLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  payFromValue: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 1 },
  payFromBal: { fontSize: 12, fontFamily: "Inter_500Medium", marginRight: 8 },
  payFromChainLogo: { width: 20, height: 20, borderRadius: 10 },
  walletSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  walletSheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 16, textAlign: "center" },
  walletRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: 10,
  },
  walletTokenLogo: { width: 36, height: 36, borderRadius: 18 },
  walletAssetText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  walletBalText: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  walletChainLogo: { width: 22, height: 22, borderRadius: 11 },
});
