import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, TextInput, Platform, Modal,
  Animated, StyleSheet, Image, Easing, Keyboard, Linking,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { useColors } from "@/hooks/useColors";
import { useKeyboardHeight } from "@/hooks/useKeyboardHeight";
import { useApp } from "@/context/AppContext";
import { ts, assetLabel, fmtAsset, TokenSymbol } from "@/constants/transfer";
import { DashedRule, LeaderRow, SLIP_MONO } from "@/components/Slip";
import { TokenLogo } from "@/components/TokenLogo";
import { Keypad } from "@/components/Keypad";
import { CHAIN_MARKS } from "@/constants/transfer";
import { prepareWithdrawal, submitWithdrawal, abandonWithdraw } from "@/services/transactions";
import { solanaSendFee } from "@/services/status";
import { signMovementTransaction, signSolanaTransaction, signTonTransaction, signEvmTransaction, getLocalAddresses } from "@/services/wallet-core";
import { signStellarTransaction } from "@/services/stellar";
import { StageTrack, STAGE_DONE, STAGE_PENDING } from "@/components/StageTrack";
import { showError } from "@/components/PausedSheet";

import { SuccessMark, SUCCESS_HALO } from "@/components/SuccessMark";
export default function WithdrawSummaryScreen() {
  const colors = useColors();
  const kbHeight = useKeyboardHeight();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { walletBalances, verifyPin, bioTx, refreshBalances, refreshTransactions, rates } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const params = useLocalSearchParams<{ token: string; label?: string; network: string; networkName: string; address: string; amount: string; memo?: string; payRequestId?: string; payee?: string; payRef?: string; direct?: string }>();
  // Paying a business's checkout: named by the business, and held by the server to what it asked for.
  const payRequestId = params.payRequestId || "";
  const payee = payRequestId ? params.payee || "the business" : "";
  // The business's own reference, and whether the screen before this one was already the review.
  const payRef = payRequestId ? params.payRef || "" : "";
  const direct = !!payRequestId && params.direct === "1";
  // Stellar only, and only when the user typed one.
  const wMemo = params.network === "STELLAR" ? (params.memo || "").trim() : "";
  const wToken = (params.token || "USDC") as TokenSymbol;
  const wLabel = params.label || assetLabel(wToken);
  const wChain = params.network || "MOVE";
  /**
   * Whether the chain takes its fee out of what is being sent.
   *
   * On most chains the fee is a different asset and the treasury sponsors
   * it, so "Free" is true and worth saying. On Arc the fee is the USDC being
   * sent and on TON a relay takes its cut from the USDT - so the row is
   * dropped rather than reworded. It is a fraction of a cent, which is not
   * worth a line on a screen, and "Free" would be a small untruth in the one
   * place somebody is deciding to part with money.
   */
  const paysOwnFee = wChain === "ARC" || wChain === "TON";
  /**
   * The flat charge on a Solana send, when it is switched on.
   *
   * Stablecoins only - a SOL send has no token account to take it from. Zero
   * whenever the switch is off, which is how it ships, and then the row
   * below says Free exactly as it always did.
   */
  const sendFee =
    wChain === "SOL" && (wToken === "USDC" || wToken === "USDT") ? solanaSendFee() : 0;


  const networkName = params.networkName || "";
  const wAddress = params.address || "";
  const wAmount = Number(params.amount);
  const shortTo = payee || (wAddress.length > 18 ? `${wAddress.slice(0, 8)}…${wAddress.slice(-6)}` : wAddress);
  const usdValue = ((rates?.[wToken as keyof typeof rates] as any)?.usd || 0) * wAmount;

  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState(0);
  const [showPin, setShowPin] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [txId, setTxId] = useState("");
  const [paidTx, setPaidTx] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const pendingAction = useRef<() => void>(() => {});

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

  const tokenBalance = () => {
    const entry = walletBalances.find(b => b.asset === wToken && b.chain === wChain);
    return entry?.balance ?? 0;
  };

  const tokenDecimals = (sym: TokenSymbol) => sym === "ETH" ? 8 : sym === "MOVE" ? 2 : 4;
  const dec = tokenDecimals(wToken);



  const requestPin = (action: () => void) => {
    if (bioTx && Platform.OS !== "web") {
      LocalAuthentication.authenticateAsync({
        promptMessage: "Confirm Transaction",
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

  const autoPin = useRef(false);
  useEffect(() => {
    if (!direct || autoPin.current) return;
    autoPin.current = true;
    requestPin(handleSend);
  }, [direct]);

  const animateSuccess = () => {
    checkAnim.setValue(0);
    setShowSuccess(true);
      Animated.spring(checkAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 5 }).start();
  };

  const handleSend = async () => {
    setProcessing(true);
    setProcessingStep(0);
    // Declared out here so the catch can name the row. Inside the try it is
    // out of scope at exactly the moment it is needed.
    let preparedId: string | undefined;
    try {
      // Gasless flow for ALL chains: prepare → sign → submit
      const localAddrs = await getLocalAddresses().catch(() => null);
      setProcessingStep(1);
      const { withdrawalId, signingMessage, txRequest } = (await prepareWithdrawal({
        asset: wToken,
        chain: wChain,
        amount: wAmount,
        address: wAddress,
        senderAddress: localAddrs?.[wChain] || undefined,
        ...(wMemo ? { memo: wMemo } : {}),
        ...(payRequestId ? { payRequestId } : {}),
      })) as any;

      preparedId = withdrawalId;

      setProcessingStep(2);
      // Sign with the appropriate chain key (never leaves device)
      let signature: string;
      let publicKey: string;
      let signedRaw: string | undefined;

      if (wChain === "MOVE") {
        ({ signature, publicKey } = await signMovementTransaction(signingMessage));
      } else if (wChain === "SOL") {
        ({ signature, publicKey } = await signSolanaTransaction(signingMessage));
      } else if (wChain === "TON") {
        // Ed25519, same key as Solana - what differs is that the hash is of a
        // cell rather than a transaction message, which changes nothing here.
        ({ signature, publicKey } = await signTonTransaction(signingMessage));
      } else if (wChain === "STELLAR") {
        // Ed25519, same key as Solana, over the transaction hash. The treasury
        // pays the fee, so the user needs no XLM.
        ({ signature, publicKey } = await signStellarTransaction(signingMessage));
      } else {
        // EVM chains (BASE, BEP20, ARB)
        // An MPC wallet cannot sign a bare hash, so it signs the whole
        // transaction and returns the raw signed bytes instead of a signature.
        ({ signature, publicKey, signedRaw } = await signEvmTransaction(
          signingMessage,
          txRequest
        ));
      }

      setProcessingStep(3);
      // Submit signed tx to backend for on-chain broadcast
      const { transaction } = await submitWithdrawal({
        withdrawalId,
        signature,
        publicKey,
        signedRaw,
      });

      setTxId(transaction.id);
      setPaidTx((transaction as any)?.metadata?.txHash ?? (transaction as any)?.txHash ?? null);
      setProcessingStep(4);

      refreshBalances(true);
      refreshTransactions();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setProcessing(false);
      setShowPin(false);
      animateSuccess();
    } catch (err: any) {
      setProcessingStep(0);
      setProcessing(false);
      setShowPin(false);
      // Client-side throws - a signing timeout, an unsupported wallet, an RPC
      // failure - carry no response body, so keying only off response.data
      // collapsed every one of them to this generic line and lost the cause.
      console.error("[WITHDRAW] failed:", err?.response?.data || err);
      const msg = err?.response?.data?.error || err?.message || "Withdrawal failed";
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      /**
       * Say why, before the sweeper closes it without one.
       *
       * A withdrawal that is prepared and never signed sat PENDING for ten
       * minutes and then failed silently - the person watched "Processing" for
       * something that never left their phone, and the cause died with the
       * alert. The server ignores this for anything already submitted.
       */
      if (preparedId) {
        abandonWithdraw(preparedId, msg, `sign:${wChain}`);
        refreshTransactions();
      }
      showError(msg);
    }
  };

  /** The stages, with the last one only once the transfer is on chain. */
  const stagesFor = (sent: boolean) => [
    { label: "Signed", kind: "sent" as const, color: colors.foreground + "B3" },
    { label: "Broadcasting", kind: "dot" as const, color: STAGE_PENDING },
    ...(sent ? [{ label: "Sent", kind: "badge" as const, color: STAGE_DONE }] : []),
  ];

  /* ─── IN FLIGHT ─── */
  /**
   * The same track the transaction sheet shows afterwards, live.
   *
   * This replaced a spinner overlay that sat on top of the summary: a
   * broadcast takes long enough that a progress track tells a better story
   * than a rotating circle, and it is the same shape every other flow uses.
   */
  if (processing) {
    return (
      <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <View style={ts.header}>
          <View style={{ width: 24 }} />
          <Text style={[ts.headerTitle, { color: colors.foreground }]}>{payee ? "Paying" : "Sending"}</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={ws.flight}>
          <TokenLogo symbol={wToken} size={46} dark />
          <Text style={[ws.flightAmount, { color: colors.foreground }]}>
            {fmtAsset(wAmount, wToken)} {wLabel}
          </Text>
          <Text style={[ws.flightTo, { color: colors.mutedForeground }]}>
            to {shortTo}
          </Text>

          <View style={[ws.flightTrack, { backgroundColor: colors.card }]}>
            <StageTrack stages={stagesFor(processingStep >= 4)} />
          </View>

          <Text style={[ws.flightNote, { color: colors.mutedForeground }]}>
            Keep this screen open while it goes through. On-chain transfers usually
            confirm within a minute.
          </Text>
        </View>
      </View>
    );
  }

  /* ─── PAID A BUSINESS ─── */
  if (showSuccess && payee) {
    const link = paidTx ? payExplorer(wChain, paidTx) : null;
    const when = new Date().toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
    return (
      <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
          <Animated.View style={[pd.mark, { backgroundColor: colors.primary, transform: [{ scale: checkAnim }] }]}>
            <Feather name="check" size={38} color={colors.primaryForeground} />
          </Animated.View>
          <Text style={[pd.title, { color: colors.foreground }]}>${fmtAsset(wAmount, wToken)} sent</Text>
          <Text style={[pd.sub, { color: colors.mutedForeground }]}>{payee} has your payment.</Text>

          <View style={[pd.float, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={pd.row}>
              <Text style={[pd.label, { color: colors.mutedForeground }]}>Paid with</Text>
              <View style={pd.valueRow}>
                <TokenLogo symbol={wLabel as TokenSymbol} size={18} />
                <Text style={[pd.value, { color: colors.foreground }]}>
                  {wLabel} on {networkName}
                </Text>
              </View>
            </View>
            {!!payRef && (
              <View style={[pd.row, pd.ruled, { borderTopColor: colors.border }]}>
                <Text style={[pd.label, { color: colors.mutedForeground }]}>Reference</Text>
                <Text style={[pd.value, pd.mono, { color: colors.foreground }]}>{payRef}</Text>
              </View>
            )}
            {!!paidTx && (
              <TouchableOpacity
                disabled={!link}
                onPress={() => link && Linking.openURL(link)}
                activeOpacity={0.7}
                style={[pd.row, pd.ruled, { borderTopColor: colors.border }]}
              >
                <Text style={[pd.label, { color: colors.mutedForeground }]}>Transaction</Text>
                <View style={pd.valueRow}>
                  <Text style={[pd.value, pd.mono, { color: colors.foreground }]}>{paidTx.slice(0, 6)}…{paidTx.slice(-4)}</Text>
                  {!!link && <Feather name="arrow-up-right" size={14} color={colors.mutedForeground} />}
                </View>
              </TouchableOpacity>
            )}
            <View style={[pd.row, pd.ruled, { borderTopColor: colors.border }]}>
              <Text style={[pd.label, { color: colors.mutedForeground }]}>When</Text>
              <Text style={[pd.value, { color: colors.foreground }]}>Today, {when}</Text>
            </View>
          </View>
        </ScrollView>

        <View style={[pd.cta, { paddingBottom: bottomPad + 14, backgroundColor: colors.background }]}>
          <TouchableOpacity style={[pd.btn, { backgroundColor: colors.primary }]} onPress={() => router.replace("/(tabs)")} activeOpacity={0.85}>
            <Text style={[pd.btnText, { color: colors.primaryForeground }]}>Done</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={pd.ghost}
            onPress={() => router.replace({ pathname: "/transactions/receipt", params: { id: txId, done: "1" } } as any)}
            activeOpacity={0.7}
          >
            <Text style={[pd.ghostText, { color: colors.mutedForeground }]}>View receipt</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  /* ─── SENT ─── */
  if (showSuccess) {
    return (
      <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <View style={ts.header}>
          <View style={{ width: 24 }} />
          <Text style={[ts.headerTitle, { color: colors.foreground }]}>{payee ? "Paid" : "Transfer sent"}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
          <Animated.View
            style={[ws.checkOuter, { backgroundColor: SUCCESS_HALO, transform: [{ scale: checkAnim }] }]}
          >
            <SuccessMark size={56} />
          </Animated.View>

          <Text style={[ws.sentAmount, { color: colors.foreground }]}>
            {fmtAsset(wAmount, wToken)} {wLabel}
          </Text>
          <Text style={[ws.flightTo, { color: colors.mutedForeground, textAlign: "center" }]}>
            to {shortTo}
          </Text>

          <View style={[ws.flightTrack, { backgroundColor: colors.card, marginHorizontal: 16 }]}>
            <StageTrack stages={stagesFor(true)} />
          </View>

          <View style={[ws.card, { backgroundColor: colors.card, marginTop: 14 }]}>
            <SumRow icon="link-2" label="Network" colors={colors} value={networkName}
              mark={CHAIN_MARKS[wChain]} />
            <SumRow icon="user" label="To" colors={colors} value={shortTo} />
            {!!wMemo && <SumRow icon="hash" label="Memo" colors={colors} value={wMemo} />}
            {!paysOwnFee && (
              <SumRow
                icon="percent"
                label="Network fee"
                colors={colors}
                value={sendFee ? `${sendFee} ${wToken}` : "Free"}
                accent={!sendFee}
              />
            )}
          </View>
        </ScrollView>

        <View style={[ts.bottomBar, { paddingBottom: bottomPad + 8, backgroundColor: colors.background }]}>
          <TouchableOpacity
            style={[ts.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={() => router.replace("/(tabs)")}
            activeOpacity={0.85}
          >
            <Text style={[ts.primaryBtnText, { color: colors.primaryForeground }]}>Done</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={ws.detailsLink}
            onPress={() =>
              router.replace({ pathname: "/transactions/receipt", params: { id: txId, done: "1" } } as any)
            }
            activeOpacity={0.7}
          >
            <Feather name="file-text" size={15} color={colors.primary} />
            <Text style={[ws.detailsLinkText, { color: colors.primary }]}>View receipt</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={ts.header}>
        <TouchableOpacity onPress={() => router.back()} disabled={processing}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[ts.headerTitle, { color: colors.foreground }]}>Summary</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
        {/* ── The slip ──────────────────────────────────────────────────
            The same torn receipt every confirm screen uses. Above the tear is
            where it goes and how much; below it is what that is worth, which
            is the only figure here a person cannot work out for themselves.

            The tear is painted, not cut - a View has no cut-out - so the two
            bites are circles in the screen's own background colour laid over
            the card's edges. Nothing may sit behind this card. */}
        <View style={[sl.slip, { backgroundColor: colors.card }]}>
          <View style={sl.head}>
            <View style={sl.headText}>
              <Text style={[sl.payTo, { color: colors.mutedForeground }]}>{payee ? "PAY" : "SEND TO"}</Text>
              {/* Head and tail, never the middle: an address is checked at its
                  ends, and a truncation that hid one of them would defeat the
                  only check available on this screen. A business is named
                  instead - its address is the one it gave, held by the server. */}
              <Text style={[sl.addr, { color: colors.foreground }]} numberOfLines={2}>
                {payee || (wAddress.length > 24 ? `${wAddress.slice(0, 12)}…${wAddress.slice(-10)}` : wAddress)}
              </Text>
              <Text style={[sl.acct, { color: colors.mutedForeground }]} numberOfLines={1}>
                {networkName || wChain}
              </Text>
            </View>
            {!!CHAIN_MARKS[wChain] && (
              <Image source={CHAIN_MARKS[wChain]} style={sl.chainMark} resizeMode="cover" />
            )}
          </View>

          <View style={sl.heroRow}>
            <TokenLogo symbol={wToken} size={30} dark />
            <Text
              style={[sl.hero, { color: colors.primary }]}
              numberOfLines={1}
            >
              {fmtAsset(wAmount, wToken)} {wLabel}
            </Text>
          </View>

          <View style={sl.ledger}>
            {!!wMemo && <LeaderRow label="Memo" value={wMemo} colors={colors} />}
            {!paysOwnFee && (
              <LeaderRow
                label="Network fee"
                value={sendFee ? `${sendFee} ${wToken}` : "Free"}
                colors={colors}
              />
            )}
            <LeaderRow label={payee ? "They get" : "Recipient gets"} value={`${fmtAsset(wAmount, wToken)} ${wLabel}`} colors={colors} />
          </View>

          <View style={sl.waist}>
            <View style={[sl.notch, sl.notchLeft, { backgroundColor: colors.background }]} />
            <View style={sl.perf}>
              <DashedRule color={colors.border} dash={5} gap={4} thickness={1.5} />
            </View>
            <View style={[sl.notch, sl.notchRight, { backgroundColor: colors.background }]} />
          </View>

          <View style={sl.stub}>
            <Text style={[sl.stubLabel, { color: colors.foreground }]}>
              {usdValue > 0 ? "Worth" : "You pay"}
            </Text>
            <Text style={[sl.stubValue, { color: colors.foreground }]}>
              {usdValue > 0
                ? `$${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `${fmtAsset(wAmount, wToken)} ${wLabel}`}
            </Text>
          </View>
        </View>

        <Text style={[ws.note, { color: colors.mutedForeground }]}>
          {payee
            ? `Payments can't be reversed. ${payee} sees it as paid as soon as it lands.`
            : "On-chain transfers cannot be reversed. Check the address and network before confirming."}
        </Text>
      </ScrollView>
      <View style={[ts.bottomBar, { paddingBottom: bottomPad + 16, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[ts.primaryBtn, { backgroundColor: colors.primary, opacity: loading || processing ? 0.7 : 1 }]}
          onPress={() => requestPin(handleSend)}
          disabled={loading || processing}
        >
          <Text style={[ts.primaryBtnText, { color: colors.primaryForeground }]}>
            {loading ? "Sending..." : payee ? `Pay ${payee}` : "Confirm Withdrawal"}
          </Text>
        </TouchableOpacity>
      </View>



      {/* PIN Modal */}
      {showPin && (
        <Modal transparent animationType="slide" visible>
          <TouchableOpacity
            style={ts.modalOverlay}
            activeOpacity={1}
            onPress={() => {
              setShowPin(false);
              setPin("");
              // Came straight here from the business's screen: closing the PIN goes back to it.
              if (direct && !processing) router.back();
            }}
          >
            <View
              style={[ts.pinSheet, { backgroundColor: colors.card, paddingBottom: bottomPad + 16 }]}
              onStartShouldSetResponder={() => true}
              {...(Platform.OS === "web" ? { onClick: (e: any) => e.stopPropagation() } : {})}
            >
              <View style={ts.handle} />

              <Text style={[wp.heading, { color: colors.foreground }]}>Confirm with PIN</Text>
              <Text style={[wp.sub, { color: colors.mutedForeground }]}>
                Enter your 4-digit PIN to authorise this {payee ? "payment" : "withdrawal"}
              </Text>

              {/* Dots rather than boxes: there is nothing to focus, only
                  somewhere to look while the keypad is pressed. */}
              <View style={wp.dots}>
                {[0, 1, 2, 3].map((i) => {
                  const filled = i < pin.length;
                  return (
                    <View
                      key={i}
                      style={[
                        wp.dot,
                        filled
                          ? { backgroundColor: pinError ? colors.destructive : colors.primary }
                          : { borderWidth: 2, borderColor: pinError ? colors.destructive + "66" : colors.border },
                      ]}
                    />
                  );
                })}
              </View>

              {/* Fixed slot, so the keypad does not jump when the error appears. */}
              <Text style={[wp.err, { color: pinError ? colors.destructive : "transparent" }]} numberOfLines={1}>
                Incorrect PIN, try again
              </Text>

              <Keypad
                style={wp.pad}
                disabled={pin.length >= 4}
                onKey={(k) => handlePinInput(pin + k)}
                onBackspace={() => { setPinError(false); setPin(pin.slice(0, -1)); }}
              />
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
}

/**
 * One line of the breakdown.
 *
 * The icon is the point: a column of label/value pairs reads as a table, and
 * the marks let you find the line you want without reading all of them.
 */
function SumRow({
  icon,
  label,
  value,
  colors,
  mark,
  accent,
}: {
  icon: any;
  label: string;
  value: string;
  colors: any;
  mark?: any;
  accent?: boolean;
}) {
  return (
    <View style={ws.row}>
      <View style={[ws.rowIcon, { backgroundColor: colors.muted }]}>
        <Feather name={icon} size={14} color={accent ? colors.primary : colors.mutedForeground} />
      </View>
      <Text style={[ws.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
      {!!mark && <Image source={mark} style={ws.rowMark} />}
      <Text
        style={[ws.rowValue, { color: accent ? colors.primary : colors.foreground }]}
        numberOfLines={1}
      >
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
    paddingBottom: 20,
    // The notches are painted over the card's own edges, so nothing may
    // overflow past it and nothing may sit behind it.
    overflow: "hidden",
  },

  head: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headText: { flex: 1, minWidth: 0 },
  payTo: { fontSize: 10, lineHeight: 14, fontFamily: "Inter_700Bold", letterSpacing: 1.6 },
  // Monospaced and smaller than a name would be: an address is read character
  // by character, and a proportional face makes that harder, not easier.
  addr: { fontSize: 15, lineHeight: 21, fontFamily: SLIP_MONO, marginTop: 7 },
  acct: { fontSize: 12.5, lineHeight: 17, fontFamily: SLIP_MONO, marginTop: 5 },
  chainMark: { width: 38, height: 38, borderRadius: 19 },

  heroRow: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 18 },
  hero: { fontSize: 30, lineHeight: 38, fontFamily: "Inter_800ExtraBold", letterSpacing: -1.2, flexShrink: 1 },

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
});

/** A business payment's transaction on its chain's explorer - the chains a checkout takes. */
function payExplorer(chain: string, hash: string): string | null {
  switch (chain) {
    case "MOVE": return `https://explorer.movementnetwork.xyz/txn/${hash}`;
    case "SOL": return `https://solscan.io/tx/${hash}`;
    case "BASE": return `https://basescan.org/tx/${hash}`;
    case "BEP20": return `https://bscscan.com/tx/${hash}`;
    case "ARC": return `https://explorer.arc.io/tx/${hash}`;
    case "MONAD": return `https://monadscan.com/tx/${hash}`;
    default: return null;
  }
}

/** The paid screen for a business: the same floating card as the screen that asked. */
const pd = StyleSheet.create({
  mark: { width: 78, height: 78, borderRadius: 39, alignSelf: "center", alignItems: "center", justifyContent: "center", marginTop: 64 },
  title: { fontSize: 28, lineHeight: 34, fontFamily: "Inter_700Bold", letterSpacing: -0.8, textAlign: "center", marginTop: 20 },
  sub: { fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 4 },
  float: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, marginTop: 28 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 13 },
  ruled: { borderTopWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  valueRow: { flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 },
  value: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  mono: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12 },
  cta: { paddingHorizontal: 20, paddingTop: 10 },
  btn: { height: 54, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_700Bold" },
  ghost: { alignItems: "center", justifyContent: "center", height: 42, marginTop: 4 },
  ghostText: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
});

const ws = StyleSheet.create({
  hero: { alignItems: "center", paddingTop: 26, paddingBottom: 24 },
  heroAmount: {
    fontSize: 32,
    lineHeight: 40,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -1,
    marginTop: 14,
  },
  heroNgn: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_500Medium", marginTop: 5 },

  card: { marginHorizontal: 16, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 6 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 8, marginHorizontal: -14 },

  row: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 11 },
  rowIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_400Regular" },
  rowMark: { width: 16, height: 16, borderRadius: 8 },
  // flexShrink so a long address truncates instead of shoving the label off.
  rowValue: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_600SemiBold", textAlign: "right", flexShrink: 1 },

  flight: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 64 },
  flightAmount: { fontSize: 30, lineHeight: 38, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.9, marginTop: 16 },
  flightTo: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium", marginTop: 6 },
  flightTrack: { alignSelf: "stretch", borderRadius: 18, padding: 16, marginTop: 30 },
  flightNote: { fontSize: 12.5, lineHeight: 18, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 22, paddingHorizontal: 12 },

  checkOuter: {
    width: 76, height: 76, borderRadius: 38,
    alignItems: "center", justifyContent: "center", alignSelf: "center", marginTop: 30,
  },
  sentAmount: { fontSize: 28, lineHeight: 36, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.8, textAlign: "center", marginTop: 16 },

  detailsLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 13 },
  detailsLinkText: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_600SemiBold" },

  note: {
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingHorizontal: 32,
    marginTop: 18,
  },
});

const wp = StyleSheet.create({
  heading: { fontSize: 23, lineHeight: 29, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.6, textAlign: "center" },
  sub: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 6 },
  dots: { flexDirection: "row", gap: 16, justifyContent: "center", marginTop: 26 },
  dot: { width: 16, height: 16, borderRadius: 8 },
  err: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_600SemiBold", textAlign: "center", marginTop: 14, marginBottom: 2 },
  pad: { alignSelf: "stretch", marginTop: 6 },
});
