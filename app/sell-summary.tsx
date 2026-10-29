import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, Platform, Modal,
  Animated, StyleSheet, Image, Easing, Switch,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { ts, assetLabel, fmtAsset, SELL_FEE_RATE as FEE_RATE, SELL_PROCESSING_FEE as PROCESSING_FEE, splitSellFee, FONT_SCALE } from "@/constants/transfer";
import { prepareSell, submitSell, getSellQuote, checkSellStatus, abandonSell, SellQuote } from "@/services/transactions";
import { signMovementTransaction, signSolanaTransaction, signTonTransaction, signEvmTransaction, getLocalAddresses, ensureSigningSession } from "@/services/wallet-core";
import { signStellarTransaction } from "@/services/stellar";
import { StageTrack, STAGE_DONE, STAGE_PENDING, STAGE_FAILED } from "@/components/StageTrack";
import { Keypad } from "@/components/Keypad";
import { DashedRule, LeaderRow, SLIP_MONO } from "@/components/Slip";
import { showError } from "@/components/PausedSheet";


import { SuccessMark, SUCCESS_HALO } from "@/components/SuccessMark";
export default function SellSummaryScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { walletBalances, verifyPin, bioTx, refreshBalances, refreshTransactions, rates } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const params = useLocalSearchParams<{
    sellToken: string;
    sellChain: string;
    sellAmount: string;
    targetNetNgn?: string;
    bank: string;
    accountNumber: string;
    accountName: string;
    bankCode?: string;
    isBeneficiary?: string;
    /** The sender's own note. Shown back to them; not sent to the bank yet. */
    narration?: string;
    saveBeneficiary?: string;
  }>();

  const narration = (params.narration || "").trim();
  const token = params.sellToken || "USDC";
  const chain = params.sellChain || "MOVE";
  const fallbackAmount = Number(params.sellAmount) || 0;
  const targetNetNgn = Number(params.targetNetNgn) || 0;
  const bankName = params.bank || "";
  const accountNumber = params.accountNumber || "";
  const accountName = params.accountName || "";
  const bankCode = params.bankCode || "";
  const alreadyBeneficiary = params.isBeneficiary === "1";

  const fallbackRate = useMemo(() => {
    if (!rates) return 0;
    const r = (rates as any)[token];
    return r?.ngn || 0;
  }, [rates, token]);

  // Signed quote from the backend — source of truth for the displayed numbers
  // and for the eventual Paystack payout. Falls back to a client-side preview
  // when the quote hasn't loaded yet (or if the backend doesn't support quotes).
  const [quote, setQuote] = useState<SellQuote | null>(null);
  const [quoteSig, setQuoteSig] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quotePaused, setQuotePaused] = useState(false);

  const fetchQuote = async () => {
    if (!targetNetNgn || targetNetNgn <= 0) {
      setQuoteLoading(false);
      return;
    }
    setQuoteLoading(true);
    setQuoteError(null);
    setQuotePaused(false);
    try {
      const { quote: q, signature } = await getSellQuote({
        asset: token,
        chain,
        desiredNetNgn: Math.round(targetNetNgn),
      });
      setQuote(q);
      setQuoteSig(signature);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Could not lock a rate. Tap to retry.";
      setQuoteError(msg);
      // A pause is not a failure to retry. The sheet has already said why, so
      // the bar below stops offering a tap that cannot succeed.
      setQuotePaused(err?.response?.data?.paused === true || !!err?.maintenanceHandled);
    } finally {
      setQuoteLoading(false);
    }
  };

  useEffect(() => { fetchQuote(); }, [token, chain, targetNetNgn]);

  const ngnRate = quote?.ngnRate ?? fallbackRate;
  const amount = quote?.amount ?? fallbackAmount;
  const grossNgn = quote?.ngnGross ?? Math.round(fallbackAmount * fallbackRate);
  const ngnFee = quote?.ngnFee ?? (Math.round(fallbackAmount * fallbackRate * FEE_RATE) + (fallbackAmount > 0 ? PROCESSING_FEE : 0));
  const netNgn = quote?.ngnNet ?? Math.round(fallbackAmount * fallbackRate - ngnFee);
  const totalDebitNgn = grossNgn;

  /**
   * The fee, itemised.
   *
   * The server returns one number, so the flat part is subtracted back out to
   * name both - FEE_RATE and PROCESSING_FEE here mirror SELL_FEE_RATE and
   * SELL_PROCESSING_FEE on the backend. Clamped at zero so a future change to
   * either constant shows as a smaller platform fee rather than a negative one.
   */
  const { platform: platformFee, processing: processingFee } = splitSellFee(ngnFee);

  /**
   * What leaves the wallet, in dollars.
   *
   * The card priced everything in naira, which is the side they receive - not
   * the side they are spending. The debit is the gross, fee included, because
   * the fee comes out of the crypto sold rather than being charged separately.
   */
  const usdRate = (rates as any)?.[token]?.usd || 0;
  const totalDebitUsd = usdRate > 0 ? amount * usdRate : 0;
  const dec = token === "MOVE" ? 2 : token === "SOL" ? 4 : 4;

  const saveBeneficiary = params.saveBeneficiary === "1";
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState(0);
  const [showPin, setShowPin] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  /**
   * Whether the bank leg finished before we got the response.
   *
   * A payout often comes back still PROCESSING, and claiming "sent" then would
   * be a lie the detail sheet corrects a minute later.
   */
  const [settled, setSettled] = useState(false);
  /** Set when the payout came back rejected, so the screen stops promising. */
  const [payoutFailed, setPayoutFailed] = useState(false);
  const [txId, setTxId] = useState("");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const pendingAction = useRef<() => void>(() => {});
  const checkAnim = useRef(new Animated.Value(0)).current;
  /**
   * A wrong PIN shakes the dots.
   *
   * useNativeDriver is false on purpose: translateX here is laid out with the
   * sheet, and the native driver would detach it from the rest of the row.
   */
  const shake = useRef(new Animated.Value(0)).current;
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

  useEffect(() => {
    if (!pinError) return;
    Animated.sequence(
      [12, -12, 7, 0].map((toValue) =>
        Animated.timing(shake, { toValue, duration: 55, useNativeDriver: false }),
      ),
    ).start();
  }, [pinError, shake]);

  /**
   * Watch the payout while the sent screen is up.
   *
   * The submit response is written before the bank leg runs, so `settled` is
   * almost always false at that moment - yet a transfer usually disburses
   * within seconds. Without this the track sat on "Processing" while the money
   * was already in the recipient's account, which is exactly backwards: the
   * screen looked stuck precisely when everything had gone right.
   */
  useEffect(() => {
    if (!showSuccess || settled || payoutFailed || !txId) return;
    let cancelled = false;
    const poll = setInterval(async () => {
      try {
        const { status } = await checkSellStatus(txId);
        if (cancelled || status === "PROCESSING" || status === "PENDING") return;
        if (status === "COMPLETED") setSettled(true);
        else setPayoutFailed(true);
        refreshTransactions();
      } catch {
        // A dropped poll is normal on mobile data; the next tick retries.
      }
    }, 4000);
    return () => { cancelled = true; clearInterval(poll); };
  }, [showSuccess, settled, payoutFailed, txId]);

  const requestPin = (action: () => void) => {
    if (bioTx && Platform.OS !== "web") {
      LocalAuthentication.authenticateAsync({
        promptMessage: "Confirm Sell",
        fallbackLabel: "Use PIN",
        cancelLabel: "Cancel",
      }).then((result) => {
        if (result.success) { action(); return; }
        pendingAction.current = action;
        setPin("");
        setPinError(false);
        setShowPin(true);
      }).catch(() => {
        pendingAction.current = action;
        setPin("");
        setPinError(false);
        setShowPin(true);
      });
      return;
    }
        pendingAction.current = action;
        setPin("");
        setPinError(false);
        setShowPin(true);
  };

  /**
   * Takes the whole PIN so far rather than one box at a time.
   *
   * With a keypad instead of four inputs there is no per-box focus to shuffle:
   * the string is the state, and reaching four characters is what submits.
   */
  const handlePinInput = (next: string) => {
    setPinError(false);
    if (next.length > 4) return;
    setPin(next);
    if (next.length < 4) return;

    (async () => {
      const reject = () => {
        setPinError(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setTimeout(() => setPin(""), 600);
      };
      try {
        if (await verifyPin(next)) {
          setShowPin(false);
          setPin("");
          pendingAction.current();
        } else reject();
      } catch {
        reject();
      }
    })();
  };

  const animateSuccess = () => {
    checkAnim.setValue(0);
    setShowSuccess(true);
    Animated.spring(checkAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 5 }).start();
  };

  const handleSell = async () => {
    setProcessing(true);
    setProcessingStep(0);
    // Named out here so the catch can close the row it opened.
    let preparedId: string | undefined;
    try {
      // A lapsed wallet session signs out here, before the server opens a sell it couldn't then close.
      await ensureSigningSession();
      const localAddrs = await getLocalAddresses().catch(() => null);
      setProcessingStep(1);

      // Phase 1: Prepare sell. Prefer the signed quote (server is source of
      // truth for rate + payout). Fall back to legacy fields if the quote
      // never loaded — keeps the flow usable even on a degraded network.
      const prepareResult = await prepareSell({
        ...(quote && quoteSig
          ? { quote, signature: quoteSig }
          : {
              asset: token,
              chain,
              amount,
              quotedRate: ngnRate > 0 ? ngnRate : undefined,
            }),
        bankName,
        accountNumber,
        accountName,
        bankCode: bankCode || undefined,
        saveBeneficiary,
        narration: narration || undefined,
        senderAddress: localAddrs?.[chain] || undefined,
      });

      const { sellId, signingMessage, txRequest } = prepareResult as any;
      preparedId = sellId;
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
        // Ed25519, same key as Solana - what differs is that the hash is of a
        // cell rather than a transaction message, which changes nothing here.
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
      // Phase 3: Submit signed tx → on-chain transfer + Paystack payout
      const submitResult = await submitSell({ sellId, signature, publicKey, signedRaw });
      setProcessingStep(4);

      setTxId(submitResult.transaction.id);
      setSettled(submitResult.transaction?.status === "COMPLETED");
      setProcessingStep(5);
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
      const msg = err?.response?.data?.error || err?.message || "Sell failed. Please try again.";
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      /**
       * Close the row we opened, and say why.
       *
       * A sell that was prepared and then failed to sign used to be left
       * PENDING - so it read as "Processing" for ten minutes for something
       * that never left the phone, and the reason died with the alert. The
       * server ignores this for anything already submitted.
       */
      if (preparedId) {
        abandonSell(preparedId, msg, `sign:${chain}`);
        refreshTransactions();
      }
      // 409 = quote expired or rate drift — refresh the quote so the user sees the new numbers
      if (err?.response?.status === 409) {
        fetchQuote();
      }
      if (!err?.maintenanceHandled) showError(msg);
    }
  };

  // A map, not a chain of ternaries. The old one ended in a bare "Movement",
  // so every chain it had not been taught about was labelled Movement on a
  // screen confirming where real money is going.
  const CHAIN_LABELS: Record<string, string> = {
    MOVE: "Movement", BASE: "Base", BEP20: "BNB Smart Chain",
    SOL: "Solana", ARC: "Arc", ARB: "Arbitrum", TON: "TON", STELLAR: "Stellar", MONAD: "Monad",
  };
  const chainLabel = CHAIN_LABELS[chain] ?? chain;

  /** The stages, with the last one only once the payout has actually gone. */
  const stagesFor = (sent: boolean, failed = false) => [
    { label: "Initiated", kind: "sent" as const, color: colors.foreground + "B3" },
    { label: "Processing", kind: "dot" as const, color: STAGE_PENDING },
    ...(failed
      ? [{ label: "Failed", kind: "failed" as const, color: STAGE_FAILED }]
      : sent
        ? [{ label: "Sent", kind: "badge" as const, color: STAGE_DONE }]
        : []),
  ];

  /* ─── IN FLIGHT ─── */
  /**
   * The same track the transaction sheet shows afterwards, live.
   *
   * A payout is the longest wait in the app - it signs on-chain, then settles
   * through a bank - so this is the screen most worth showing progress on
   * rather than a spinner.
   */
  if (processing) {
    return (
      <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <View style={ts.header}>
          <View style={{ width: 24 }} />
          <Text style={[ts.headerTitle, { color: colors.foreground }]}>Sending money</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={[cf.rule, { backgroundColor: colors.border }]} />

        <View style={cf.flight}>
          {/* The mark, not the glyph. Inter has no naira sign, so ₦ falls
              back to a system face and the amount on this screen was set in a
              different typeface from the identical amount on the one after
              it. */}
          <View style={cf.amountRow}>
            <Image
              source={require("@/assets/images/nairaiconnew.png")}
              style={[cf.nairaGlyph, { tintColor: colors.foreground }]}
            />
            <Text style={[cf.amount, { color: colors.foreground }]}>
              {netNgn.toLocaleString()}
            </Text>
          </View>
          <Text style={[cf.flightTo, { color: colors.mutedForeground }]}>
            {accountName} · {bankName}
          </Text>

          <View style={[cf.flightTrack, { backgroundColor: colors.card }]}>
            <StageTrack stages={stagesFor(processingStep >= 5)} />
          </View>

          <Text style={[cf.note, { color: colors.mutedForeground }]}>
            Keep this screen open while it goes through. Bank transfers usually land within
            minutes.
          </Text>
        </View>
      </View>
    );
  }

  /* ─── SENT ─── */
  /**
   * The same track as the in-flight screen, at rest.
   *
   * This replaced a success sheet that slid over the confirm screen: it
   * announced the transfer had started and then covered the one thing worth
   * watching. A payout settles through a bank afterwards, so the progress
   * stays on screen until the person chooses to leave it.
   */
  if (showSuccess) {
    return (
      <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <View style={ts.header}>
          <View style={{ width: 36 }} />
          <Text style={[ts.headerTitle, { color: colors.foreground }]}>
            {payoutFailed ? "Transfer failed" : settled ? "Transfer sent" : "Transfer in progress"}
          </Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={[cf.rule, { backgroundColor: colors.border }]} />

        <ScrollView contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
          <Animated.View
            style={[
              cf.checkOuter,
              {
                backgroundColor: payoutFailed ? STAGE_FAILED + "1A" : SUCCESS_HALO,
                transform: [{ scale: checkAnim }],
              },
            ]}
          >
            {/* A payout that did not land keeps its own mark. The tick is for
                money that arrived. */}
            {payoutFailed ? (
              <View style={[cf.checkInner, { backgroundColor: STAGE_FAILED }]}>
                <Feather name="alert-circle" size={30} color="#fff" />
              </View>
            ) : (
              <SuccessMark size={56} />
            )}
          </Animated.View>

          <View style={[cf.amountRow, { marginTop: 18 }]}>
            <Image
              source={require("@/assets/images/nairaiconnew.png")}
              style={[cf.nairaGlyph, { tintColor: colors.foreground }]}
            />
            <Text style={[cf.amount, { color: colors.foreground }]}>
              {netNgn.toLocaleString()}
            </Text>
          </View>
          <Text style={[cf.flightTo, { color: colors.mutedForeground }]}>
            {accountName} · {bankName}
          </Text>

          <View style={[cf.flightTrack, { backgroundColor: colors.card, marginHorizontal: 16, marginTop: 24 }]}>
            <StageTrack stages={stagesFor(settled, payoutFailed)} />
          </View>

          <View style={[cf.card, { backgroundColor: colors.card, marginTop: 14 }]}>
            <Row label="To" value={accountNumber} colors={colors} />
            <Row label="Bank" value={bankName} colors={colors} />
            <Row label="Source" value={`${assetLabel(token)} on ${chainLabel}`} colors={colors} />
            {!!narration && <Row label="Narration" value={narration} colors={colors} />}

            <View style={[cf.sep, { backgroundColor: colors.border }]} />

            <Row
              label={`Platform fee (${(FEE_RATE * 100).toFixed(1)}%)`}
              value={`₦${platformFee.toLocaleString()}`}
              colors={colors}
            />
            <Row label="Processing fee" value={`₦${processingFee.toLocaleString()}`} colors={colors} />
            {/* What left the wallet, in the currency the rows above are in.
                This said "Total debit $0.78" under two naira fees, so the one
                figure worth checking - the transfer plus its fees - was on
                neither screen. */}
            <Row label="You paid" value={`₦${grossNgn.toLocaleString()}`} colors={colors} />
            {totalDebitUsd > 0 && (
              <Row
                label="Debited"
                value={`${fmtAsset(amount, token)} ${assetLabel(token)}`}
                colors={colors}
              />
            )}
          </View>
        </ScrollView>

        <View style={[ts.bottomBar, { paddingBottom: bottomPad + 8, backgroundColor: colors.background }]}>
          <TouchableOpacity
            style={[cf.cta, { backgroundColor: colors.primary }]}
            onPress={() => router.replace("/(tabs)")}
            activeOpacity={0.85}
          >
            <Text style={[cf.ctaText, { color: colors.primaryForeground }]}>Done</Text>
          </TouchableOpacity>
          {/* A receipt only exists once the money has actually landed. While
              the payout is still moving there is nothing to put on one, so the
              link goes to the live detail sheet instead. */}
          <TouchableOpacity
            style={cf.detailsLink}
            onPress={() =>
              router.replace(
                settled
                  ? ({ pathname: "/transactions/receipt", params: { id: txId, done: "1" } } as any)
                  : ({ pathname: "/transactions/detail", params: { id: txId } } as any),
              )
            }
            activeOpacity={0.7}
          >
            <Feather
              name={settled ? "file-text" : "info"}
              size={15}
              color={colors.primary}
            />
            <Text style={[cf.detailsLinkText, { color: colors.primary }]}>
              {settled ? "View receipt" : "View details"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={ts.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          disabled={processing}
          style={[cf.back, { backgroundColor: colors.muted }]}
          hitSlop={10}
        >
          <Feather name="chevron-left" size={21} color={colors.foreground} />
        </TouchableOpacity>
        {/* The screen had a back button and two spacers where a title belongs,
            so nothing on it said what you were looking at. */}
        <Text style={[ts.headerTitle, { color: colors.foreground }]}>Transfer summary</Text>
        <View style={{ width: 36 }} />
      </View>
      <View style={[cf.rule, { backgroundColor: colors.border }]} />

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* ── The slip ──────────────────────────────────────────────────
            Two questions are asked on this screen - is this the right person,
            and what does it cost me - and a single column of label-and-value
            rows made them look like one. So it is a paper receipt torn across
            the middle: above the tear is what the recipient gets, below it is
            what leaves your wallet.

            The tear is painted, not cut. A View has no cut-out, so the two
            bites are circles in the screen's own background colour sitting
            over the card's edges. That is also why nothing may be placed
            behind this card. */}
        <View style={[sl.slip, { backgroundColor: colors.card }]}>
          <Text style={[sl.payTo, { color: colors.mutedForeground }]}>PAY TO</Text>
          <Text style={[sl.name, { color: colors.foreground }]} numberOfLines={2}>
            {accountName}
          </Text>
          <Text style={[sl.acct, { color: colors.mutedForeground }]} numberOfLines={1}>
            {bankName} · {accountNumber}
          </Text>

          {/* A glyph, not a text character: Inter carries no naira sign, so ₦
              falls back to a system face at the one size where it shows. */}
          <View style={sl.heroRow}>
            <Image
              source={require("@/assets/images/nairaiconnew.png")}
              style={[sl.heroGlyph, { tintColor: colors.primary }]}
            />
            <Text
              style={[sl.hero, { color: colors.primary }]}
              numberOfLines={1}
            >
              {netNgn.toLocaleString()}
            </Text>
          </View>

          <View style={sl.ledger}>
            <LeaderRow
              label={`Platform fee ${(FEE_RATE * 100).toFixed(1)}%`}
              value={`₦${platformFee.toLocaleString()}`}
              colors={colors}
            />
            <LeaderRow label="Processing" value={`₦${processingFee.toLocaleString()}`} colors={colors} />
            {!!narration && <LeaderRow label="Narration" value={narration} colors={colors} />}
          </View>

          <View style={sl.waist}>
            <View style={[sl.notch, sl.notchLeft, { backgroundColor: colors.background }]} />
            <View style={sl.perf}>
              <DashedRule color={colors.border} dash={5} gap={4} thickness={1.5} />
            </View>
            <View style={[sl.notch, sl.notchRight, { backgroundColor: colors.background }]} />
          </View>

          {/* What actually leaves, which the screen never used to say: it
              listed two naira fees and then a dollar total, so the one figure
              worth checking - the transfer plus its fees - was absent. */}
          <View style={sl.stub}>
            <Text style={[sl.stubLabel, { color: colors.foreground }]}>You pay</Text>
            <Text style={[sl.stubValue, { color: colors.foreground }]}>
              {totalDebitUsd > 0 ? `$${totalDebitUsd.toFixed(2)}` : `₦${grossNgn.toLocaleString()}`}
            </Text>
          </View>
          <Text style={[sl.stubSub, { color: colors.mutedForeground }]} numberOfLines={1}>
            {fmtAsset(amount, token)} {assetLabel(token)} · {chainLabel}
          </Text>
        </View>

        <Text style={[cf.disclaimer, { color: colors.mutedForeground }]}>
          Once confirmed this cannot be reversed.
        </Text>
      </ScrollView>

      <View style={[ts.bottomBar, { paddingBottom: bottomPad + 16, backgroundColor: colors.background }]}>
        {quotePaused ? (
          /* Flat and unpressable. The sheet has already explained; a button
             saying "Retry" next to a truncated half-sentence only invites a
             tap that cannot succeed. */
          <View style={[cf.cta, { backgroundColor: colors.muted }]}>
            <Text style={[cf.ctaText, { color: colors.mutedForeground }]}>
              Under maintenance
            </Text>
          </View>
        ) : quoteError ? (
          <TouchableOpacity
            style={[cf.cta, { backgroundColor: colors.muted }]}
            onPress={fetchQuote}
            activeOpacity={0.85}
          >
            <Text style={[cf.ctaText, { color: colors.foreground }]}>
              Retry · {quoteError.length > 40 ? quoteError.slice(0, 40) + "…" : quoteError}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[
              cf.cta,
              { backgroundColor: colors.primary, opacity: loading || quoteLoading ? 0.6 : 1 },
            ]}
            onPress={() => requestPin(handleSell)}
            disabled={loading || quoteLoading}
            activeOpacity={0.85}
          >
            <Text style={[cf.ctaText, { color: colors.primaryForeground }]}>
              {quoteLoading ? "Locking rate…" : "Confirm transfer"}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* PIN Modal */}
      {showPin && (
        <Modal transparent animationType="slide" visible>
          <TouchableOpacity
            style={ts.modalOverlay}
            activeOpacity={1}
            onPress={() => { setShowPin(false); setPin(""); }}
          >
            <View
              style={[ts.pinSheet, { backgroundColor: colors.card, paddingBottom: bottomPad + 16 }]}
              onStartShouldSetResponder={() => true}
              {...(Platform.OS === "web" ? { onClick: (e: any) => e.stopPropagation() } : {})}
            >
              <View style={ts.handle} />

              <Text style={[cf.pinHeading, { color: colors.foreground }]}>Confirm with PIN</Text>
              <Text style={[cf.pinSub, { color: colors.mutedForeground }]}>
                Enter your 4-digit PIN to authorise this transfer
              </Text>

              {/* Dots rather than boxes. Four empty rounded squares read as
                  fields waiting to be tapped, which these are not - there is
                  nothing to focus, only somewhere to look while you press keys. */}
              <Animated.View style={[cf.pinRow, { transform: [{ translateX: shake }] }]}>
                {[0, 1, 2, 3].map((i) => {
                  const filled = i < pin.length;
                  return (
                    <View
                      key={i}
                      style={[
                        cf.pinDot,
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
                style={[cf.pinErr, { color: pinError ? colors.destructive : "transparent" }]}
                numberOfLines={1}
              >
                Incorrect PIN, try again
              </Text>

              <Keypad
                style={cf.pinPad}
                disabled={pin.length >= 4}
                onKey={(d) => handlePinInput(pin + d)}
                onBackspace={() => { setPinError(false); setPin(pin.slice(0, -1)); }}
              />

              <TouchableOpacity
                style={cf.forgotWrap}
                hitSlop={10}
                onPress={() => router.push("/auth/pin" as any)}
              >
                <Text style={[cf.forgotPin, { color: colors.mutedForeground }]}>Forgot PIN?</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
}

function Row({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={cf.row}>
      <Text style={[cf.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[cf.rowValue, { color: colors.foreground }]} numberOfLines={1}>
        {value}
      </Text>
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
    // The stub carries its own bottom padding, so the card closes under it.
    paddingBottom: 20,
    // The notches are painted over the card's own edges, so nothing may sit
    // behind it and nothing may overflow past it.
    overflow: "hidden",
  },

  payTo: { fontSize: 10, lineHeight: 14, fontFamily: "Inter_700Bold", letterSpacing: 1.6 },
  name: { fontSize: 19, lineHeight: 25, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.4, marginTop: 7 },
  acct: { fontSize: 12.5, lineHeight: 17, fontFamily: SLIP_MONO, marginTop: 5 },

  heroRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 18 },
  // Box, not glyph: `contain` scales the mark's transparent margin too, so
  // it fills about two thirds of what is set here. 45 lands it on the cap
  // height of the 42pt figure; the lift puts it on their baseline.
  heroGlyph: { width: 45 * FONT_SCALE, height: 45 * FONT_SCALE, resizeMode: "contain", marginRight: -5 * FONT_SCALE, marginBottom: 4 * FONT_SCALE },
  hero: { fontSize: 42, lineHeight: 50, fontFamily: "Inter_800ExtraBold", letterSpacing: -1.8, flexShrink: 1 },

  ledger: { marginTop: 12 },

  // The tear. Height is the notch, so the circles sit centred on the line.
  waist: { height: NOTCH, marginTop: 14, marginHorizontal: -18, justifyContent: "center" },
  perf: { marginHorizontal: 14 },
  notch: { position: "absolute", top: 0, width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2 },
  notchLeft: { left: -NOTCH / 2 },
  notchRight: { right: -NOTCH / 2 },

  stub: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 16 },
  stubLabel: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_700Bold" },
  stubValue: { fontSize: 17, lineHeight: 23, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  stubSub: { fontSize: 11, lineHeight: 15, fontFamily: SLIP_MONO, textAlign: "right", marginTop: 4 },
});

/** The confirm and in-flight layout, kept apart from the old summary's styles. */
const cf = StyleSheet.create({
  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: 20 },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },

  amount: { fontSize: 43, lineHeight: 52, fontFamily: "Inter_800ExtraBold", letterSpacing: -1.6, textAlign: "center" },
  amountRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "center" },
  // Scaled to the 43pt figure beside it, nudged onto the same optical baseline.
  // Box, not glyph: `contain` scales the mark's transparent margin too, so
  // it fills about two thirds of what is set here. 46 lands it on the cap
  // height of the 43pt figure; the lift puts it on their baseline.
  nairaGlyph: { width: 46 * FONT_SCALE, height: 46 * FONT_SCALE, resizeMode: "contain", marginRight: -5 * FONT_SCALE, marginBottom: 4 * FONT_SCALE },

  card: { marginHorizontal: 16, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 10 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, paddingVertical: 9 },
  rowLabel: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_400Regular", flexShrink: 0 },
  rowValue: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_600SemiBold", textAlign: "right", flexShrink: 1 },
  // Heavier and inset, so it separates what is being sent from what it costs
  // without looking like another row.
  sep: { height: 1, marginVertical: 12, opacity: 0.7 },

  disclaimer: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 44,
    paddingHorizontal: 30,
  },

  cta: { height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },

  flight: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 70 },
  flightTo: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_500Medium", marginTop: 6, textAlign: "center" },
  flightTrack: { alignSelf: "stretch", borderRadius: 18, padding: 16, marginTop: 34 },
  note: { fontSize: 12.5, lineHeight: 18, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 22, paddingHorizontal: 12 },

  // The tick that opens the sent screen. Brand green with a soft halo rather
  // than a generic success green, so it belongs to the same screen as the
  // amount underneath it.
  checkOuter: {
    width: 76, height: 76, borderRadius: 38,
    alignItems: "center", justifyContent: "center", alignSelf: "center", marginTop: 32,
  },
  checkInner: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },

  // A link rather than a second button: leaving is the common choice, and two
  // filled buttons would make them look equally weighted.
  pinHeading: { fontSize: 23, lineHeight: 29, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.6, textAlign: "center" },
  pinSub: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 6 },
  pinRow: { flexDirection: "row", gap: 16, marginTop: 26 },
  // Big enough to read at a glance from across the sheet, small enough that
  // four of them still read as one group.
  pinDot: { width: 16, height: 16, borderRadius: 8 },
  pinErr: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_600SemiBold", marginTop: 14, marginBottom: 2 },
  pinPad: { alignSelf: "stretch", marginTop: 10 },
  forgotWrap: { paddingTop: 16, paddingBottom: 4 },
  forgotPin: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold" },

  detailsLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 13 },
  detailsLinkText: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
});

const st = StyleSheet.create({
  receiveCard: {
    borderRadius: 20, padding: 24, marginBottom: 16, alignItems: "center",
  },
  receiveTitleRow: {
    flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8,
  },
  receiveIcon: {
    width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center",
  },
  receiveLabel: {
    fontSize: 13, fontFamily: "Inter_500Medium", letterSpacing: 0.5, textTransform: "uppercase",
  },
  receiveAmount: {
    fontSize: 38, fontFamily: "Inter_700Bold",
  },
  receiveSub: {
    fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 6,
  },
  bankCard: {
    borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, gap: 10,
  },
  bankNameRow: {
    flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1,
  },
  bankLogo: {
    width: 20, height: 20, borderRadius: 10,
  },
  bankHeader: {
    flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4,
  },
  bankTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  bankRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  bankLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  bankValue: { fontSize: 13, fontFamily: "Inter_500Medium", flexShrink: 1, textAlign: "right" },
  saveRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    borderRadius: 14, padding: 16, marginTop: 12, borderWidth: 1,
  },
  saveLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },

  /* Sell button */
  sellBtn: {
    height: 56, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  sellBtnText: {
    fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff",
  },
});
