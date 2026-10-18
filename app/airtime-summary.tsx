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
import { Feather, Ionicons, MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { Keypad } from "@/components/Keypad";
import { useApp } from "@/context/AppContext";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { prepareBill, submitBill } from "@/services/bills";
import { PROVIDER_LOGOS } from "@/constants/bills";
import { DashedRule, SLIP_MONO } from "@/components/Slip";
import { StageTrack, STAGE_DONE, STAGE_PENDING } from "@/components/StageTrack";
import { assetLabel, fmtAsset, FONT_SCALE } from "@/constants/transfer";

const RECENT_AIRTIME_KEY = "@recentAirtimeNumbers";
const MAX_RECENT = 5;

async function saveRecentNumber(phone: string, network: string) {
  try {
    const raw = await AsyncStorage.getItem(RECENT_AIRTIME_KEY);
    let list: { phone: string; network: string }[] = raw ? JSON.parse(raw) : [];
    // Remove duplicate if exists
    list = list.filter((r) => r.phone !== phone);
    // Add to front
    list.unshift({ phone, network });
    // Keep only last MAX_RECENT
    if (list.length > MAX_RECENT) list = list.slice(0, MAX_RECENT);
    await AsyncStorage.setItem(RECENT_AIRTIME_KEY, JSON.stringify(list));
  } catch {}
}
import { signMovementTransaction, signSolanaTransaction, signTonTransaction, signEvmTransaction, getLocalAddresses } from "@/services/wallet-core";
import { signStellarTransaction } from "@/services/stellar";

import { SuccessMark, SUCCESS_HALO } from "@/components/SuccessMark";
type Step = "summary" | "pin" | "details";

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

export default function AirtimeSummaryScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { verifyPin, bioTx, walletBalances, refreshBalances, refreshTransactions, rates } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const params = useLocalSearchParams<{
    phone: string;
    amount: string;
    network: string;
    networkColor: string;
    type: string;
    planLabel: string;
    variationId: string;
    asset: string;
    chain: string;
  }>();

  const phone = params.phone || "";
  const amount = Number(params.amount || "0");
  const network = params.network || "MTN";
  const networkColor = params.networkColor || "#FFCC00";
  const type = params.type || "airtime";
  const planLabel = params.planLabel || "";
  const variationId = params.variationId || "";

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

  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  /**
   * 0 initiated, 1 processing, 2 delivered.
   *
   * Coarser than the five phases the purchase actually runs through, because
   * "Preparing", "Signing" and "Submitting" are our problem rather than
   * anything the person waiting can act on. They want to know it started, that
   * it is moving, and that it landed.
   */
  const [processingStep, setProcessingStep] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);
  const [txId, setTxId] = useState("");
  const [refId, setRefId] = useState("");
  const [pending, setPending] = useState(false);
  const [txDate, setTxDate] = useState("");
  const [txTime, setTxTime] = useState("");
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
        && ["USDC", "USDT", "MOVE", "USDCx"].includes(w.asset))
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
    if (eligibleWallets.length === 0 || selectedWallet) return;
    // What the user picked on the way here, if it is still payable.
    const chosen =
      params.asset && params.chain
        ? eligibleWallets.find((w) => w.asset === params.asset && w.chain === params.chain)
        : undefined;
    const best =
      chosen ||
      eligibleWallets.find((w) => {
        const ngnRate = rates?.[w.asset as keyof typeof rates] as any;
        const rate = ngnRate?.ngn || 1500;
        return w.balance >= amount / rate;
      }) ||
      eligibleWallets[0];
    setSelectedWallet(best);
  }, [eligibleWallets, rates, params.asset, params.chain]);

  const formattedAmount = `₦${amount.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
  const ngnPerUsd = rates?.USDC?.ngn || 1555;
  const usdEquiv = (amount / ngnPerUsd).toFixed(2);
  // Priced in the asset being spent, not in USDC: a MOVE balance pays for
  // this at the MOVE rate, and quoting the dollar alone hides how much of
  // the holding it takes.
  const payRate = Number((rates?.[selectedWallet?.asset as keyof typeof rates] as any)?.ngn) || 0;
  const tokenCost = selectedWallet && payRate > 0 ? amount / payRate : 0;
  const label = type === "airtime" ? "Airtime" : `${planLabel} Data`;

  /**
   * Our fee, mirroring ELECTRICITY_FEE in backend/src/routes/bills.ts.
   *
   * Airtime and data carry none, and this screen only sells those - but the
   * row is derived rather than hardcoded so it cannot quietly start lying if
   * that changes.
   */
  const feeNaira = type === "electricity" ? 100 : 0;
  const formattedFee = `₦${feeNaira.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

  /**
   * A transaction hash is 66 characters and wrapped onto two lines, which made
   * it the loudest thing on a screen nobody reads it from. Enough of both ends
   * to match against a receipt, on one line.
   */
  const shortRef =
    refId.length > 18 ? `${refId.slice(0, 8)}...${refId.slice(-6)}` : refId;

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

      // Phase 1: Prepare bill (backend validates + returns signing message)
      const prepareResult = await prepareBill({
        type: type as "airtime" | "data",
        phone,
        network,
        amount,
        variationId: variationId || undefined,
        planLabel: planLabel || undefined,
        asset,
        chain,
        senderAddress: localAddrs?.[chain] || undefined,
      });

      const { billId, signingMessage, txRequest } = prepareResult as any;
      setProcessingStep(2);

      // Phase 2: Sign with the appropriate chain key
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
      // Phase 3: Submit signed tx → on-chain transfer + VTU.ng purchase
      const submitResult = await submitBill({ billId, signature, publicKey, signedRaw });
      setProcessingStep(4);

      // Check if VTU delivery failed
      if (submitResult.status === "FAILED") {
        setProcessing(false);
        refreshBalances(true);
        refreshTransactions();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert("Purchase Failed", submitResult.message || "Airtime delivery failed. Please contact support.");
        return;
      }

      const now = new Date();
      const date = now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "2-digit" });
      const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

      setTxId(billId);
      setRefId(submitResult.txHash || billId);
      setPending(
        submitResult.status === "PENDING" || submitResult.status === "PROCESSING",
      );
      setTxDate(date);
      setTxTime(time);

      // Save to recent numbers
      saveRecentNumber(phone, network);

      refreshBalances(true);
      refreshTransactions();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      /**
       * Let Delivered land before the screen changes.
       *
       * The track just gained its last stage; cutting away in the same frame
       * throws that away and the purchase appears to finish without ever
       * having completed. A beat is enough to read it.
       */
      setTimeout(() => {
        setProcessing(false);
        setShowSuccess(true);
        sheetAnim.setValue(400);
        overlayAnim.setValue(1);
        checkAnim.setValue(0);
        Animated.spring(sheetAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }).start(() => {
          Animated.spring(checkAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 5 }).start();
        });
      }, 950);
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

  const copyRef = () => {
    try { Clipboard.setString(refId); } catch {}
    Alert.alert("Copied", "Reference ID copied");
  };

  /* ─── PIN BOTTOM SHEET (shared) ─── */
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

  /** The stages, with the last one only once it has actually landed. */
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
   * wait and the record are the same picture rather than two different ones.
   */
  if (processing) {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <View style={s.header}>
          <View style={{ width: 36 }} />
          <Text style={[s.headerTitle, { color: colors.foreground }]}>
            {type === "airtime" ? "Buying airtime" : "Buying data"}
          </Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={[s.rule, { backgroundColor: colors.border }]} />

        <View style={s.flight}>
          <View style={s.confirmAmountRow}>
            <Image
              source={require("@/assets/images/nairaiconnew.png")}
              style={[s.confirmNaira, { tintColor: colors.foreground }]}
            />
            <Text style={[s.confirmAmount, { color: colors.foreground }]}>
              {amount.toLocaleString("en-NG", { minimumFractionDigits: 2 })}
            </Text>
          </View>

          <Text style={[s.flightTo, { color: colors.mutedForeground }]}>
            {phone} · {network}
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

  /* ─── SUMMARY ─── */
  if (step === "summary" || step === "pin") {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} disabled={processing} style={[s.backBtn, { backgroundColor: colors.card }]}>
            <Feather name="chevron-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[s.headerTitle, { color: colors.foreground }]}>Confirm bill payment</Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={[s.rule, { backgroundColor: colors.border }]} />

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {/* ── The slip ──────────────────────────────────────────────────
              The same torn receipt the transfer summary uses, because it is
              the same question asked twice: who is this going to, and what
              does it cost me. Above the tear is what is being bought; below it
              is what leaves the wallet.

              The tear is painted, not cut - a View has no cut-out - so the two
              bites are circles in the screen's own background colour laid over
              the card's edges. Nothing may sit behind this card. */}
          <View style={[sl.slip, { backgroundColor: colors.card }]}>
            <View style={sl.head}>
              <View style={sl.headText}>
                <Text style={[sl.payTo, { color: colors.mutedForeground }]}>PAY TO</Text>
                <Text style={[sl.name, { color: colors.foreground }]} numberOfLines={1}>
                  {phone}
                </Text>
                <Text style={[sl.acct, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {network} · {label}
                </Text>
              </View>
              {/* The provider, as its own mark. A network is a brand people
                  recognise faster than they read, and it is the one detail on
                  here that is checked by glance rather than by reading. */}
              {!!PROVIDER_LOGOS[network] && (
                <Image source={PROVIDER_LOGOS[network]} style={sl.provider} resizeMode="cover" />
              )}
            </View>

            <View style={sl.heroRow}>
              <Image
                source={require("@/assets/images/nairaiconnew.png")}
                style={[sl.heroGlyph, { tintColor: colors.primary }]}
              />
              <Text
                style={[sl.hero, { color: colors.primary }]}
                numberOfLines={1}
              >
                {amount.toLocaleString("en-NG", { minimumFractionDigits: 2 })}
              </Text>
            </View>

            <View style={sl.waist}>
              <View style={[sl.notch, sl.notchLeft, { backgroundColor: colors.background }]} />
              <View style={sl.perf}>
                <DashedRule color={colors.border} dash={5} gap={4} thickness={1.5} />
              </View>
              <View style={[sl.notch, sl.notchRight, { backgroundColor: colors.background }]} />
            </View>

            {/* The stub is the wallet picker: what it costs and where it comes
                from are one fact, and they were two rows apart. */}
            <TouchableOpacity
              activeOpacity={eligibleWallets.length > 1 ? 0.7 : 1}
              onPress={() => eligibleWallets.length > 1 && setShowWalletPicker(true)}
              disabled={eligibleWallets.length <= 1}
            >
              <View style={sl.stub}>
                <Text style={[sl.stubLabel, { color: colors.foreground }]}>You pay</Text>
                <Text style={[sl.stubValue, { color: colors.foreground }]}>
                  {selectedWallet ? `$${usdEquiv}` : "—"}
                </Text>
              </View>
              {selectedWallet ? (
                <View style={sl.stubSubRow}>
                  <Image source={TOKEN_LOGOS[selectedWallet.asset]} style={sl.stubToken} />
                  <Text style={[sl.stubSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {tokenCost > 0 ? `${fmtAsset(tokenCost, selectedWallet.asset)} ` : ""}
                    {assetLabel(selectedWallet.asset)} ·{" "}
                    {CHAIN_NAMES[selectedWallet.chain] || selectedWallet.chain}
                  </Text>
                  {eligibleWallets.length > 1 && (
                    <Feather name="chevron-down" size={14} color={colors.mutedForeground} />
                  )}
                </View>
              ) : (
                <Text style={[sl.stubSub, { color: "#ef4444" }]}>Not enough balance</Text>
              )}
            </TouchableOpacity>
          </View>

          <Text style={[s.confirmNote, { color: colors.mutedForeground }]}>
            Once confirmed this cannot be reversed.
          </Text>
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
            <Text style={[s.ctaBtnText, { color: colors.primaryForeground }]}>Confirm payment</Text>
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
                        {isSel && (
                          <Ionicons
                            name="checkmark-circle-outline"
                            size={22}
                            color={colors.primary}
                            style={{ marginLeft: 8 }}
                          />
                        )}
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
                    <SuccessMark size={70} />
                  </Animated.View>

                  <Text style={[s.successHeading, { color: colors.foreground }]}>
                    {pending ? "Purchase in progress" : "Purchase completed"}
                  </Text>

                  <View style={[s.successPill, { backgroundColor: colors.card }]}>
                    <Image
                      source={
                        type === "data"
                          ? require("@/assets/images/wifi.png")
                          : require("@/assets/images/telephone-call.png")
                      }
                      style={[s.successPillIcon, { tintColor: colors.mutedForeground }]}
                    />
                    <Text style={[s.successPillText, { color: colors.foreground }]}>
                      {type === "data" ? "Data" : "Airtime"}
                    </Text>
                  </View>

                  {/* The same track, at rest. Ending on a tick alone discards
                      the one thing that was telling the story while they
                      waited. */}
                  <View style={[s.flightTrack, { backgroundColor: colors.card, marginTop: 22 }]}>
                    <StageTrack stages={stagesFor(!pending)} />
                  </View>

                  {/* The receipt, in the order it gets read: what, to whom, and
                      only then where it came from. */}
                  <View
                    style={[
                      s.confirmCard,
                      { backgroundColor: colors.card, marginTop: 14, marginHorizontal: 0, alignSelf: "stretch" },
                    ]}
                  >
                    <InfoRow label="Amount" value={formattedAmount} colors={colors} />
                    <InfoRow label="Phone Number" value={phone} colors={colors} />
                    <InfoRow label="Network" value={network} colors={colors} />
                    {!!refId && <InfoRow label="Reference" value={shortRef} colors={colors} />}

                    <View style={[s.confirmSep, { backgroundColor: colors.border }]} />

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
                      // Nothing to put on a receipt until it has delivered;
                      // while it is still moving the live detail sheet is the
                      // honest destination.
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

  /* ─── TRANSACTION DETAILS ─── */
  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.replace("/(tabs)")} style={[s.backBtn, { backgroundColor: colors.card }]}>
          <Feather name="chevron-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.foreground }]}>Receipt</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: bottomPad + 100 }} showsVerticalScrollIndicator={false}>
        {/* Status hero */}
        <View style={[s.receiptHero, { backgroundColor: colors.primary + "12" }]}>
          <View style={[s.receiptIcon, { backgroundColor: colors.primary + "22" }]}>
            <Feather name={type === "airtime" ? "phone" : "wifi"} size={24} color={colors.primary} />
          </View>
          <Text style={[s.receiptType, { color: colors.primary }]}>
            {type === "airtime" ? "Airtime" : "Data"} Purchase
          </Text>
          <Text style={[s.receiptAmount, { color: colors.foreground }]}>{formattedAmount}</Text>
          <View style={[s.statusPill, { backgroundColor: "#22c55e18" }]}>
            <View style={s.statusDot} />
            <Text style={s.statusText}>Successful</Text>
          </View>
        </View>

        {/* Details */}
        <View style={[s.infoCard, { backgroundColor: colors.card }]}>
          <InfoRow label="Recipient" value={phone} colors={colors} />
          <View style={[s.sep, { backgroundColor: colors.border }]} />
          <InfoRow label="Network" value={network} colors={colors} />
          <View style={[s.sep, { backgroundColor: colors.border }]} />
          <InfoRow label="Amount" value={formattedAmount} colors={colors} />
          <View style={[s.sep, { backgroundColor: colors.border }]} />
          <InfoRow label="Date" value={txDate} colors={colors} />
          <View style={[s.sep, { backgroundColor: colors.border }]} />
          <InfoRow label="Time" value={txTime} colors={colors} />
          <View style={[s.sep, { backgroundColor: colors.border }]} />
          <View style={s.row}>
            <Text style={[s.rowLabel, { color: colors.mutedForeground }]}>Reference</Text>
            <TouchableOpacity onPress={copyRef} style={s.refRow}>
              <Text style={[s.rowValue, { color: colors.foreground, fontSize: 12 }]} numberOfLines={1}>
                {refId}
              </Text>
              <Feather name="copy" size={13} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Bottom */}
      <View style={[s.ctaWrap, { paddingBottom: bottomPad + 16, backgroundColor: colors.background }]}>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <TouchableOpacity
            style={[s.successSecondary, { borderColor: colors.border, flex: 1 }]}
            onPress={() => Alert.alert("Report", "Report submitted")}
          >
            <Text style={[s.successSecondaryText, { color: colors.foreground }]}>Report Issue</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.successDone, { backgroundColor: colors.foreground, flex: 1 }]}
            onPress={() => router.replace("/(tabs)")}
          >
            <Text style={[s.successDoneText, { color: colors.background }]}>Go Home</Text>
          </TouchableOpacity>
        </View>
      </View>

      <LoadingOverlay visible={processing} label="Buying your airtime" />
    </View>
  );
}

/* ─── Small reusable row ─── */
function InfoRow({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={s.row}>
      <Text style={[s.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[s.rowValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const NOTCH = 20;

const sl = StyleSheet.create({
  slip: {
    marginHorizontal: 16,
    marginTop: 22,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 20,
    // The notches are painted over the card's own edges, so nothing may
    // overflow past it and nothing may sit behind it.
    overflow: "hidden",
  },

  head: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headText: { flex: 1, minWidth: 0 },
  payTo: { fontSize: 10, lineHeight: 14, fontFamily: "Inter_700Bold", letterSpacing: 1.6 },
  name: { fontSize: 19, lineHeight: 25, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.4, marginTop: 7 },
  acct: { fontSize: 12.5, lineHeight: 17, fontFamily: SLIP_MONO, marginTop: 5 },
  // Squared off rather than round: these are logos, and a circle crops the
  // wordmarks in three of the four network marks.
  provider: { width: 38, height: 38, borderRadius: 10 },

  heroRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 18 },
  // Box, not glyph: `contain` scales the mark's transparent margin too, so it
  // fills about two thirds of what is set. 34 sits it under the 42pt figure.
  // Box, not glyph: `contain` scales the mark's transparent margin too, so
  // it fills about two thirds of what is set here. 45 lands it on the cap
  // height of the 42pt figure; the lift puts it on their baseline.
  heroGlyph: { width: 45 * FONT_SCALE, height: 45 * FONT_SCALE, resizeMode: "contain", marginRight: -5 * FONT_SCALE, marginBottom: 4 * FONT_SCALE },
  hero: { fontSize: 42, lineHeight: 50, fontFamily: "Inter_800ExtraBold", letterSpacing: -1.8, flexShrink: 1 },

  // The tear. Height is the notch, so the circles sit centred on the line.
  waist: { height: NOTCH, marginTop: 18, marginHorizontal: -18, justifyContent: "center" },
  perf: { marginHorizontal: 14 },
  notch: { position: "absolute", top: 0, width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2 },
  notchLeft: { left: -NOTCH / 2 },
  notchRight: { right: -NOTCH / 2 },

  stub: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 16 },
  stubLabel: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_700Bold" },
  stubValue: { fontSize: 17, lineHeight: 23, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  stubSubRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6, marginTop: 6 },
  stubToken: { width: 15, height: 15, borderRadius: 7.5 },
  stubSub: { fontSize: 11, lineHeight: 15, fontFamily: SLIP_MONO, textAlign: "right", flexShrink: 1 },
});

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

  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: 20 },

  // ── Confirm ───────────────────────────────────────────────
  confirmAmountSpacing: { marginTop: 46, marginBottom: 24 },
  flight: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 70 },
  flightTo: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_500Medium", marginTop: 4 },
  flightTrack: { alignSelf: "stretch", borderRadius: 18, padding: 16, marginTop: 34 },
  flightNote: {
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 22,
    paddingHorizontal: 20,
  },
  confirmAmountRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
  },
  /**
   * Sized against the digits, not its own canvas.
   *
   * The glyph's ink fills 448 of its 512px box, so 31 lands the mark a shade
   * under the cap height of the 43pt figures - which is where a currency sign
   * belongs. Nudged down, never up.
   */
  // Box, not glyph: `contain` scales the mark's transparent margin too, so
  // it fills about two thirds of what is set here. 46 lands it on the cap
  // height of the 43pt figure; the lift puts it on their baseline.
  confirmNaira: { width: 46, height: 46, resizeMode: "contain", marginRight: -5, marginBottom: 4 },
  confirmAmount: {
    fontSize: 43,
    lineHeight: 52,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -1.6,
  },
  confirmCard: { marginHorizontal: 16, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 10 },
  // Heavier and inset, so it separates the two halves of the card without
  // looking like another row.
  confirmSep: { height: 1, marginVertical: 12, opacity: 0.7 },
  sourceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 9 },
  sourceValue: { flexDirection: "row", alignItems: "center", gap: 7 },
  sourceLogo: { width: 18, height: 18, borderRadius: 9 },
  confirmNote: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 44,
    paddingHorizontal: 30,
  },

  // ── Completed ─────────────────────────────────────────────
  successScreen: { flex: 1 },
  successBody: { alignItems: "center", paddingHorizontal: 16 },
  successPill: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, marginTop: 14 },
  successPillIcon: { width: 13, height: 13, resizeMode: "contain" },
  successPillText: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_600SemiBold" },
  doneActions: { paddingHorizontal: 16, paddingTop: 8 },
  doneBtn: { height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  doneBtnText: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },
  successLink: { alignItems: "center", paddingVertical: 14 },
  successLinkText: { fontSize: 14.5, lineHeight: 19, fontFamily: "Inter_700Bold" },

  container: { flex: 1 },

  /* Header */
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
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 17, lineHeight: 22, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },

  /* Badge row */
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 8,
  },
  networkDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  networkDotText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#000" },
  typeBadge: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
  },
  typeBadgeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  /* Amount */
  amountBlock: { alignItems: "center", marginTop: 16, marginBottom: 24 },
  amountBig: { fontSize: 38, fontFamily: "Inter_700Bold", letterSpacing: -1 },
  amountUsd: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 4 },

  /* Info card */
  infoCard: {
    marginHorizontal: 20,
    borderRadius: 20,
    padding: 20,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    paddingVertical: 9,
  },
  rowLabel: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_400Regular", flexShrink: 0 },
  rowValue: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_600SemiBold", textAlign: "right", flexShrink: 1 },
  sep: { height: StyleSheet.hairlineWidth, marginVertical: 14 },
  sepThick: { height: 1, marginVertical: 14 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalLabel: { fontSize: 15, fontFamily: "Inter_700Bold" },
  totalValue: { fontSize: 18, fontFamily: "Inter_700Bold" },

  /* CTA */
  ctaWrap: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  ctaBtn: {
    height: 56,
    borderRadius: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  ctaBtnText: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },

  /* Overlay / sheet */
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

  /* PIN */

  /* Success */
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
    width: 98,
    height: 98,
    borderRadius: 49,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  successHeading: { fontSize: 24, lineHeight: 30, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.6, textAlign: "center" },
  successSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 36 },
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

  /* Receipt */
  receiptHero: {
    marginHorizontal: 20,
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    marginBottom: 16,
  },
  receiptIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  receiptType: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  receiptAmount: { fontSize: 30, fontFamily: "Inter_700Bold", marginBottom: 12 },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#22c55e" },
  statusText: { color: "#22c55e", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  refRow: { flexDirection: "row", alignItems: "center", flexShrink: 1 },

  /* Processing */
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
