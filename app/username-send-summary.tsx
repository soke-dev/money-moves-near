import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, TextInput, Platform, Modal,
  Animated, StyleSheet, Easing, Keyboard, Image,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { useColors } from "@/hooks/useColors";
import { useKeyboardHeight } from "@/hooks/useKeyboardHeight";
import { useApp } from "@/context/AppContext";
import { ts, assetLabel, fmtAsset, TokenSymbol, FONT_SCALE } from "@/constants/transfer";
import { prepareUsernameTransfer, submitUsernameTransfer, abandonUsernameTransfer } from "@/services/transactions";
import { solanaSendFee } from "@/services/status";
import { signMovementTransaction, signSolanaTransaction, signTonTransaction, signEvmTransaction, getLocalAddresses } from "@/services/wallet-core";
import { signStellarTransaction } from "@/services/stellar";
import { StageTrack, STAGE_DONE, STAGE_PENDING } from "@/components/StageTrack";
import { Keypad } from "@/components/Keypad";
import { DashedRule, LeaderRow, SLIP_MONO } from "@/components/Slip";
import { showError } from "@/components/PausedSheet";

import { SuccessMark, SUCCESS_HALO } from "@/components/SuccessMark";
/**
 * As much memo as the receipt can still print on one line.
 *
 * A transfer between two people is not a letter, and the note has to survive
 * into both parties' receipts unabbreviated to be worth carrying at all.
 */
const NOTE_MAX = 80;

export default function UsernameSendSummaryScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { verifyPin, bioTx, refreshBalances, refreshTransactions } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const params = useLocalSearchParams<{
    recipientId: string;
    recipientUsername: string;
    recipientName: string;
    token: string;
    chain: string;
    chainName: string;
    amount: string;
    ngnAmount: string;
  }>();
  const token = (params.token || "USDC") as TokenSymbol;
  const chain = params.chain || "MOVE";
  const chainName = params.chainName || chain;
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
  const paysOwnFee = chain === "ARC" || chain === "TON";
  /**
   * The flat charge on a Solana send, when it is switched on.
   *
   * Stablecoins only - a SOL send has no token account to take it from. Zero
   * whenever the switch is off, which is how it ships, and then the row
   * below says Free exactly as it always did.
   */
  const sendFee =
    chain === "SOL" && (token === "USDC" || token === "USDT") ? solanaSendFee() : 0;


  const recipientUsername = params.recipientUsername || "";
  const recipientName = params.recipientName || recipientUsername;
  const amount = Number(params.amount);
  const ngnAmount = Number(params.ngnAmount || 0);

  /**
   * The sender's own line on the slip.
   *
   * It is typed here rather than a screen earlier because the amount screen is
   * a keypad: a text field beside one fights it for the keyboard, and the two
   * take turns covering each other.
   */
  const [note, setNote] = useState("");
  const [memoFocused, setMemoFocused] = useState(false);
  const kb = useKeyboardHeight();
  const scrollRef = useRef<ScrollView>(null);

  /**
   * Put the memo above the keyboard, and above the Confirm bar riding on it.
   *
   * The memo is the last thing on the slip, so scrolling to the end is
   * scrolling to the field. It runs again when `kb` settles because Android
   * reports the keyboard's height after the field has already taken focus -
   * scrolling on focus alone lands against a height that is still 0.
   */
  useEffect(() => {
    if (!memoFocused) return;
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(t);
  }, [memoFocused, kb]);

  const [processing, setProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState(0);
  const [showPin, setShowPin] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [txId, setTxId] = useState("");
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
  const tokenDecimals = (sym: TokenSymbol) => (sym === "ETH" ? 8 : sym === "MOVE" ? 2 : 4);
  const dec = tokenDecimals(token);
  const displayDec = Math.min(dec, 3); // show at most 3 decimals in the UI

  const requestPin = (action: () => void) => {
    // The memo field may still hold focus, and the sheet this opens has a
    // keypad of its own - two keyboards, one on top of the other.
    Keyboard.dismiss();
    if (bioTx && Platform.OS !== "web") {
      LocalAuthentication.authenticateAsync({
        promptMessage: "Confirm Transfer",
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

  const handleSend = async () => {
    setProcessing(true);
    setProcessingStep(0);
    /**
     * Set once prepare has opened a row, cleared the moment submit is sent.
     *
     * Only a failure in between is reported as never signed. Once submit has
     * left the phone the server may be broadcasting, and a timeout here says
     * nothing about whether the money moved - that row is the server's call.
     */
    let unsignedId: string | null = null;
    let signChain = chain;
    try {
      // Phase 1: Prepare — validate, build on-chain tx, sponsor gas
      const localAddrs = await getLocalAddresses().catch(() => null);
      setProcessingStep(1);
      const { transferId, signingMessage, chain: txChain, txRequest } = (await prepareUsernameTransfer({
        recipientUsername,
        asset: token,
        chain,
        amount,
        narration: note.trim() || undefined,
        senderAddress: localAddrs?.[chain] || undefined,
      })) as any;

      unsignedId = transferId;
      signChain = txChain;
      setProcessingStep(2);
      // Phase 2: Sign with the user's private key (never leaves device)
      let signature: string;
      let publicKey: string;
      let signedRaw: string | undefined;

      if (txChain === "MOVE") {
        ({ signature, publicKey } = await signMovementTransaction(signingMessage));
      } else if (txChain === "SOL") {
        ({ signature, publicKey } = await signSolanaTransaction(signingMessage));
      } else if (txChain === "TON") {
        // Ed25519, same key as Solana - what differs is that the hash is of a
        // cell rather than a transaction message, which changes nothing here.
        ({ signature, publicKey } = await signTonTransaction(signingMessage));
      } else if (txChain === "STELLAR") {
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
      unsignedId = null;
      // Phase 3: Submit signed tx for on-chain broadcast
      const result = await submitUsernameTransfer({
        transferId,
        signature,
        publicKey,
        signedRaw,
      });

      setTxId(result.transaction.id);
      setProcessingStep(4);
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
      console.error("[USERNAME-SEND] failed:", err?.response?.data || err);
      const msg = err?.response?.data?.error || err?.message || "Transfer failed";
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // Signing failed after prepare: close the row now, with the reason,
      // rather than leave it reading "Pending" to the sender and to support.
      if (unsignedId) {
        abandonUsernameTransfer(unsignedId, msg, `sign:${signChain}`);
        refreshTransactions();
      }
      showError(msg);
    }
  };

  const initial = (recipientName || recipientUsername || "?")[0].toUpperCase();
  const cryptoLine = `${fmtAsset(amount, token)} ${assetLabel(token)}`;
  const nairaFigure = ngnAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nairaLine = `₦${nairaFigure}`;

  /** The stages. An internal transfer has no chain leg, so it is short. */
  const stagesFor = (sent: boolean) => [
    { label: "Signed", kind: "sent" as const, color: colors.foreground + "B3" },
    { label: "Sending", kind: "dot" as const, color: STAGE_PENDING },
    ...(sent ? [{ label: "Delivered", kind: "badge" as const, color: STAGE_DONE }] : []),
  ];

  /* ─── IN FLIGHT ─── */
  if (processing) {
    return (
      <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <View style={ts.header}>
          <View style={{ width: 24 }} />
          <Text style={[ts.headerTitle, { color: colors.foreground }]}>Sending</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={u.flight}>
          <View style={[u.avatarLg, { backgroundColor: colors.primary + "1F" }]}>
            <Text style={[u.avatarLgText, { color: colors.primary }]}>{initial}</Text>
          </View>
          <View style={u.heroRow}>
            <Image
              source={require("@/assets/images/nairaiconnew.png")}
              style={[u.nairaGlyphSm, { tintColor: colors.foreground }]}
            />
            <Text style={[u.flightAmount, { color: colors.foreground }]}>{nairaFigure}</Text>
          </View>
          <Text style={[u.flightTo, { color: colors.mutedForeground }]}>to @{recipientUsername}</Text>

          <View style={[u.track, { backgroundColor: colors.card }]}>
            <StageTrack stages={stagesFor(processingStep >= 4)} />
          </View>

          <Text style={[u.flightNote, { color: colors.mutedForeground }]}>
            Keep this screen open. Transfers between Money Moves accounts land
            straight away.
          </Text>
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
          <Text style={[ts.headerTitle, { color: colors.foreground }]}>Transfer sent</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
          <Animated.View
            style={[u.checkOuter, { backgroundColor: SUCCESS_HALO, transform: [{ scale: checkAnim }] }]}
          >
            <SuccessMark size={52} />
          </Animated.View>

          <View style={u.heroRow}>
            <Image
              source={require("@/assets/images/nairaiconnew.png")}
              style={[u.nairaGlyphSm, { tintColor: colors.foreground }]}
            />
            <Text style={[u.sentAmount, { color: colors.foreground }]}>{nairaFigure}</Text>
          </View>
          <Text style={[u.flightTo, { color: colors.mutedForeground, textAlign: "center" }]}>
            to @{recipientUsername}
          </Text>

          <View style={[u.track, { backgroundColor: colors.card, marginHorizontal: 16 }]}>
            <StageTrack stages={stagesFor(true)} />
          </View>

          <View style={[u.card, { backgroundColor: colors.card, marginTop: 14 }]}>
            <URow icon="user" label="To" colors={colors} value={`@${recipientUsername}`} />
            <URow icon="repeat" label="Type" colors={colors} value="Money Moves transfer" />
            {!!note.trim() && (
              <URow icon="edit-3" label="Note" colors={colors} value={note.trim()} lines={2} />
            )}
            {!paysOwnFee && (
              <URow
                icon="percent"
                label="Fee"
                colors={colors}
                value={sendFee ? `${sendFee} ${token}` : "Free"}
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
            style={u.link}
            onPress={() =>
              router.replace({ pathname: "/transactions/receipt", params: { id: txId, done: "1" } } as any)
            }
            activeOpacity={0.7}
          >
            <Feather name="file-text" size={15} color={colors.primary} />
            <Text style={[u.linkText, { color: colors.primary }]}>View receipt</Text>
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
        <Text style={[ts.headerTitle, { color: colors.foreground }]}>Transfer summary</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{
          // Enough tail to scroll the memo clear of the keyboard and of the
          // Confirm bar sitting on top of it. `automaticallyAdjustKeyboardInsets`
          // would do the first half on iOS and nothing at all on Android, so
          // this measures instead - the same number on both platforms.
          //
          // `memoFocused` as well as `kb`, because where the platform resizes
          // the window for the keyboard this hook correctly reports 0: the
          // view is already short, and the bar is still over its last inch.
          paddingBottom: 28 + (kb > 0 || memoFocused ? kb + 92 : 0),
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* ── The slip ──────────────────────────────────────────────────
            The same torn receipt every confirm screen uses. Above the tear is
            who it reaches and what they get; below it is what leaves your
            balance.

            The tear is painted, not cut - a View has no cut-out - so the two
            bites are circles in the screen's own background colour laid over
            the card's edges. Nothing may sit behind this card. */}
        <View style={[sl.slip, { backgroundColor: colors.card }]}>
          <View style={sl.head}>
            <View style={sl.headText}>
              <Text style={[sl.payTo, { color: colors.mutedForeground }]}>PAY TO</Text>
              <Text style={[sl.name, { color: colors.foreground }]} numberOfLines={1}>
                {recipientName}
              </Text>
              <Text style={[sl.acct, { color: colors.mutedForeground }]} numberOfLines={1}>
                @{recipientUsername}
              </Text>
            </View>
            {/* The initial, where the other slips carry a provider mark. An
                account has no logo, and a username is checked by glance. */}
            <View style={[sl.avatar, { backgroundColor: colors.primary + "1F" }]}>
              <Text style={[sl.avatarText, { color: colors.primary }]}>{initial}</Text>
            </View>
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
              {nairaFigure}
            </Text>
          </View>

          <View style={sl.ledger}>
            {!paysOwnFee && (
              <LeaderRow
                label="Fee"
                value={sendFee ? `${sendFee} ${token}` : "Free"}
                colors={colors}
              />
            )}
            <LeaderRow label="Arrives" value="Instantly" colors={colors} />
          </View>

          <View style={sl.waist}>
            <View style={[sl.notch, sl.notchLeft, { backgroundColor: colors.background }]} />
            <View style={sl.perf}>
              <DashedRule color={colors.border} dash={5} gap={4} thickness={1.5} />
            </View>
            <View style={[sl.notch, sl.notchRight, { backgroundColor: colors.background }]} />
          </View>

          <View style={sl.stub}>
            <Text style={[sl.stubLabel, { color: colors.foreground }]}>You pay</Text>
            <Text style={[sl.stubValue, { color: colors.foreground }]}>{cryptoLine}</Text>
          </View>
          <Text style={[sl.stubSub, { color: colors.mutedForeground }]} numberOfLines={1}>
            {chainName}
          </Text>

          {/* The memo line, which is the one thing a paper slip has always
              had room for and this one did not. The person on the other end
              gets a figure and a username; without this there is nowhere to
              say what the money was for. */}
          <View style={sl.memo}>
            <View style={sl.memoLine}>
              <Text style={[sl.memoLabel, { color: colors.mutedForeground }]}>MEMO</Text>
              <TextInput
                style={[sl.memoInput, { color: colors.foreground }]}
                value={note}
                onChangeText={setNote}
                onFocus={() => setMemoFocused(true)}
                onBlur={() => setMemoFocused(false)}
                placeholder="What is this for?"
                placeholderTextColor={colors.mutedForeground}
                maxLength={NOTE_MAX}
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
              />
            </View>
            <DashedRule color={colors.border} dash={2} gap={3} thickness={2} round />
          </View>
        </View>

        <Text style={[u.note, { color: colors.mutedForeground }]}>
          Transfers between Money Moves accounts cannot be reversed.
        </Text>
      </ScrollView>

      <View
        style={[
          ts.bottomBar,
          {
            // Over the keyboard rather than behind it: the memo is typed on
            // this screen, and Confirm is what you reach for next.
            bottom: kb,
            paddingBottom: kb > 0 ? 12 : bottomPad + 16,
            backgroundColor: colors.background,
          },
        ]}
      >
        <TouchableOpacity
          style={[ts.primaryBtn, { backgroundColor: colors.primary, opacity: processing ? 0.7 : 1 }]}
          onPress={() => requestPin(handleSend)}
          disabled={processing}
        >
          <Text style={[ts.primaryBtnText, { color: colors.primaryForeground }]}>Confirm transfer</Text>
        </TouchableOpacity>
      </View>

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

              <Text style={[u.pinHeading, { color: colors.foreground }]}>Confirm with PIN</Text>
              <Text style={[u.pinSub, { color: colors.mutedForeground }]}>
                Enter your 4-digit PIN to authorise this transfer
              </Text>

              <View style={u.pinDots}>
                {[0, 1, 2, 3].map((i) => {
                  const filled = i < pin.length;
                  return (
                    <View
                      key={i}
                      style={[
                        u.pinDot,
                        filled
                          ? { backgroundColor: pinError ? colors.destructive : colors.primary }
                          : { borderWidth: 2, borderColor: pinError ? colors.destructive + "66" : colors.border },
                      ]}
                    />
                  );
                })}
              </View>

              <Text style={[u.pinErr, { color: pinError ? colors.destructive : "transparent" }]} numberOfLines={1}>
                Incorrect PIN, try again
              </Text>

              <Keypad
                style={u.pinPad}
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

const s = StyleSheet.create({
  recipientCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  recipientName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  recipientUsername: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  successOverlay: { flex: 1, justifyContent: "flex-end" },
  successDim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.85)" },
  successSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  successHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: "#ccc", marginBottom: 32 },
  successTitle: { fontSize: 24, fontFamily: "Inter_700Bold", marginBottom: 6 },
  successSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 36 },
  successActions: { flexDirection: "row", gap: 12, width: "100%" },
  successSecondary: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  successSecondaryText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  successDone: { flex: 1, height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  successDoneText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});

/**
 * One line of the breakdown.
 *
 * The icon is the point: a column of label/value pairs reads as a table, and
 * the marks let you find the line you want without reading all of them.
 */
function URow({
  icon,
  label,
  value,
  colors,
  accent,
  lines,
}: {
  icon: any;
  label: string;
  value: string;
  colors: any;
  accent?: boolean;
  /** How many lines the value may take before it truncates. One by default. */
  lines?: number;
}) {
  return (
    <View style={u.row}>
      <View style={[u.rowIcon, { backgroundColor: colors.muted }]}>
        <Feather name={icon} size={14} color={accent ? colors.primary : colors.mutedForeground} />
      </View>
      <Text style={[u.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text
        style={[u.rowValue, { color: accent ? colors.primary : colors.foreground }]}
        numberOfLines={lines ?? 1}
      >
        {value}
      </Text>
    </View>
  );
}

/** This screen's own layout, matching the crypto transfer flow. */
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
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_800ExtraBold" },

  heroRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 18 },
  // Box, not glyph: `contain` scales the mark's transparent margin too, so
  // it fills about two thirds of what is set here. 45 lands it on the cap
  // height of the 42pt figure; the lift puts it on their baseline.
  heroGlyph: { width: 45 * FONT_SCALE, height: 45 * FONT_SCALE, resizeMode: "contain", marginRight: -5 * FONT_SCALE, marginBottom: 4 * FONT_SCALE },
  hero: { fontSize: 42, lineHeight: 48, fontFamily: "Inter_800ExtraBold", letterSpacing: -1.8, flexShrink: 1 },

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

  memo: { marginTop: 14 },
  memoLine: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, marginBottom: 6 },
  memoLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 1.6 },
  // No lineHeight: on Android it stops centring the text in the field, and a
  // memo sitting off its own rule is worse than one a point too tall.
  memoInput: { flex: 1, height: 20, padding: 0, fontSize: 12.5, fontFamily: SLIP_MONO },
});

const u = StyleSheet.create({
  hero: { alignItems: "center", paddingTop: 24, paddingBottom: 22 },
  avatarLg: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  avatarLgText: { fontSize: 22, lineHeight: 28, fontFamily: "Inter_800ExtraBold" },
  heroRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "center" },
  // Box, not glyph: `contain` scales the mark's transparent margin too, so
  // it fills about two thirds of what is set here. 34 lands it on the cap
  // height of the 32pt figure; the lift puts it on their baseline.
  nairaGlyph: { width: 34 * FONT_SCALE, height: 34 * FONT_SCALE, resizeMode: "contain", marginRight: -4 * FONT_SCALE, marginBottom: 3 * FONT_SCALE },
  // Box, not glyph: `contain` scales the mark's transparent margin too, so
  // it fills about two thirds of what is set here. 31 lands it on the cap
  // height of the 28-30pt figure; the lift puts it on their baseline.
  nairaGlyphSm: { width: 31 * FONT_SCALE, height: 31 * FONT_SCALE, resizeMode: "contain", marginRight: -4 * FONT_SCALE, marginBottom: 3 * FONT_SCALE },
  heroAmount: { fontSize: 32, lineHeight: 40, fontFamily: "Inter_800ExtraBold", letterSpacing: -1, marginTop: 14 },
  heroSub: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium", marginTop: 5 },

  card: { marginHorizontal: 16, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 6 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 8, marginHorizontal: -14 },

  row: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 11 },
  rowIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_400Regular" },
  // flexShrink so a long value truncates instead of shoving the label off.
  rowValue: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_600SemiBold", textAlign: "right", flexShrink: 1 },

  note: {
    fontSize: 12.5, lineHeight: 18, fontFamily: "Inter_400Regular",
    textAlign: "center", paddingHorizontal: 32, marginTop: 18,
  },

  flight: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 64 },
  flightAmount: { fontSize: 30, lineHeight: 38, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.9, marginTop: 16 },
  flightTo: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium", marginTop: 6 },
  track: { alignSelf: "stretch", borderRadius: 18, padding: 16, marginTop: 30 },
  flightNote: { fontSize: 12.5, lineHeight: 18, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 22, paddingHorizontal: 12 },

  checkOuter: {
    width: 76, height: 76, borderRadius: 38,
    alignItems: "center", justifyContent: "center", alignSelf: "center", marginTop: 30,
  },
  sentAmount: { fontSize: 28, lineHeight: 36, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.8, textAlign: "center", marginTop: 16 },

  link: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 13 },
  linkText: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_600SemiBold" },

  pinHeading: { fontSize: 23, lineHeight: 29, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.6, textAlign: "center" },
  pinSub: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 6 },
  pinDots: { flexDirection: "row", gap: 16, justifyContent: "center", marginTop: 26 },
  pinDot: { width: 16, height: 16, borderRadius: 8 },
  pinErr: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_600SemiBold", textAlign: "center", marginTop: 14, marginBottom: 2 },
  pinPad: { alignSelf: "stretch", marginTop: 6 },
});
