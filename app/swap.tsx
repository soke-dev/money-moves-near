import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  TextInput,
  ActivityIndicator,
  Modal,
  Image,
  Linking,
  KeyboardAvoidingView,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { TokenLogo } from "@/components/TokenLogo";
import { Keypad } from "@/components/Keypad";
import { CHAIN_MARKS } from "@/constants/transfer";
import { signSolanaTransaction, signEvmTransaction } from "@/services/wallet-core";
import {
  getSwapConfig,
  getSwapQuote,
  prepareSwap,
  submitSwap,
  submitSwapFee,
  getSwap,
  isSwapInFlight,
  fmtCoin,
  SWAP_CHAIN_NAME,
  type SwapAsset,
  type SwapConfig,
  type SwapQuote,
  type SwapState,
} from "@/services/swap";

/**
 * Swap — any coin you hold, to any chain, into your own wallet.
 *
 * One screen, four states, in the order they happen: choosing, reviewing,
 * watching, done. Kept in one route rather than four because the person is
 * making one decision and following it through; a stack of pages would let
 * the back button walk them into a review of a swap that has already gone.
 *
 * The fee is taken from what is sent, never added on top, so "You pay" is
 * always the whole of what leaves the wallet. The server sets the fee and the
 * minimum and checks both again at every step; this screen only previews them.
 */

type Step = "edit" | "review" | "sending" | "watch" | "done";

/** Their guidance: no faster than every ten seconds for an automatic refresh. */
const QUOTE_REFRESH_MS = 15_000;
const QUOTE_DEBOUNCE_MS = 600;
/** And five to ten seconds for status. */
const STATUS_POLL_MS = 6_000;
/** How long a reviewed price is shown before it is fetched again. */
const REVIEW_HOLD_S = 30;

const short = (a?: string | null) => (a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "");

export default function SwapScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ from?: string }>();
  const { walletBalances, walletAddresses, verifyPin, bioTx, refreshBalances, refreshTransactions } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [config, setConfig] = useState<SwapConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [amountText, setAmountText] = useState("");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [picker, setPicker] = useState<"from" | "to" | null>(null);
  const [step, setStep] = useState<Step>("edit");
  const [sendError, setSendError] = useState("");
  const [swap, setSwap] = useState<SwapState | null>(null);
  const [hold, setHold] = useState(REVIEW_HOLD_S);

  // PIN
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const pendingAction = useRef<() => void>(() => {});

  /* ── Config ── */
  useEffect(() => {
    getSwapConfig()
      .then((c) => {
        setConfig(c);
        const froms = c.assets.filter((a) => a.from);
        const tos = c.assets.filter((a) => a.to);
        // Start from what the person holds most of, unless they came from a token.
        const held = (a: SwapAsset) => walletBalances.find((b) => b.asset === a.asset && b.chain === a.chain)?.balance ?? 0;
        const wanted = froms.find((a) => a.id === params.from);
        const first = wanted ?? [...froms].sort((a, b) => held(b) * b.price - held(a) * a.price)[0];
        if (first) {
          setFromId(first.id);
          const dest = tos.find((a) => a.id === "MONAD:USDC" && a.id !== first.id) ?? tos.find((a) => a.id !== first.id);
          if (dest) setToId(dest.id);
        }
      })
      .catch((e) => setConfigError(e?.response?.data?.error || "Swaps couldn't load. Check your connection."));
    // walletBalances is read once for the default only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const assets = config?.assets ?? [];
  const from = assets.find((a) => a.id === fromId) ?? null;
  const to = assets.find((a) => a.id === toId) ?? null;
  const amount = Number(amountText.replace(/,/g, ""));
  const balanceOf = useCallback(
    (a: SwapAsset | null) => (a ? walletBalances.find((b) => b.asset === a.asset && b.chain === a.chain)?.balance ?? 0 : 0),
    [walletBalances],
  );
  const fromBalance = balanceOf(from);
  const usd = from && amount > 0 ? amount * from.price : 0;
  const belowMin = !!config && amount > 0 && usd < config.minUsd;
  const overBalance = amount > 0 && amount > fromBalance + 1e-9;
  const feePct = config ? config.feeBps / 100 : 0;

  /* ── Quote: debounced while typing, refreshed while it sits ── */
  const quoteSeq = useRef(0);
  const fetchQuote = useCallback(async () => {
    if (!from || !to || !(amount > 0) || belowMin) {
      setQuote(null);
      setQuoteError("");
      return;
    }
    const seq = ++quoteSeq.current;
    setQuoting(true);
    try {
      const q = await getSwapQuote(from.id, to.id, amount);
      if (seq !== quoteSeq.current) return;
      setQuote(q);
      setQuoteError("");
    } catch (e: any) {
      if (seq !== quoteSeq.current) return;
      setQuote(null);
      setQuoteError(e?.response?.data?.error || "Couldn't get a price right now.");
    } finally {
      if (seq === quoteSeq.current) setQuoting(false);
    }
  }, [from, to, amount, belowMin]);

  // The review screen keeps its own clock ("Price held for"), so the
  // background refresh only runs while choosing.
  const stepRef = useRef<Step>(step);
  stepRef.current = step;

  useEffect(() => {
    if (step !== "edit" && step !== "review") return;
    setQuote(null);
    const t = setTimeout(fetchQuote, QUOTE_DEBOUNCE_MS);
    const every = setInterval(() => {
      if (stepRef.current === "edit") fetchQuote();
    }, QUOTE_REFRESH_MS);
    return () => {
      clearTimeout(t);
      clearInterval(every);
    };
    // Re-run when what is being priced changes, not on every quote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromId, toId, amountText, step === "edit" || step === "review"]);

  /* ── Review: the price is held for a while, then fetched again ── */
  useEffect(() => {
    if (step !== "review") return;
    setHold(REVIEW_HOLD_S);
    const t = setInterval(() => {
      setHold((h) => {
        if (h <= 1) {
          fetchQuote();
          return REVIEW_HOLD_S;
        }
        return h - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [step, fetchQuote]);

  /* ── Watching: poll until it lands or comes back ── */
  useEffect(() => {
    if (step !== "watch" || !swap) return;
    let stopped = false;
    const tick = async () => {
      try {
        const s = await getSwap(swap.id);
        if (stopped) return;
        setSwap(s);
        if (!isSwapInFlight(s.status)) {
          setStep("done");
          refreshBalances(true);
          refreshTransactions();
          Haptics.notificationAsync(
            s.status === "COMPLETED" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
          ).catch(() => {});
        }
      } catch {
        /* the next tick tries again */
      }
    };
    const t = setInterval(tick, STATUS_POLL_MS);
    tick();
    return () => {
      stopped = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, swap?.id]);

  /* ── Pick / flip ── */
  const pick = (a: SwapAsset) => {
    if (picker === "from") {
      setFromId(a.id);
      if (a.id === toId) setToId(fromId && assets.find((x) => x.id === fromId)?.to ? fromId : null);
    } else if (picker === "to") {
      setToId(a.id);
      if (a.id === fromId) setFromId(toId && assets.find((x) => x.id === toId)?.from ? toId : null);
    }
    setPicker(null);
  };
  const canFlip = !!from && !!to && from.to && to.from;
  const flip = () => {
    if (!canFlip) return;
    setFromId(to!.id);
    setToId(from!.id);
    setAmountText("");
    Haptics.selectionAsync().catch(() => {});
  };

  /* ── PIN ── */
  const requestPin = (action: () => void) => {
    pendingAction.current = action;
    const ask = () => {
      setPin("");
      setPinError(false);
      setShowPin(true);
    };
    if (bioTx && Platform.OS !== "web") {
      LocalAuthentication.authenticateAsync({ promptMessage: "Confirm swap", fallbackLabel: "Use PIN", cancelLabel: "Cancel" })
        .then((r) => (r.success ? action() : ask()))
        .catch(ask);
      return;
    }
    ask();
  };
  const handlePinInput = (next: string) => {
    setPinError(false);
    if (next.length > 4) return;
    setPin(next);
    if (next.length < 4) return;
    (async () => {
      const reject = () => {
        setPinError(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
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

  /* ── Send ── */
  const signFor = async (chain: string, signingMessage: string, txRequest?: any) => {
    if (chain === "SOL") {
      const { signature, publicKey } = await signSolanaTransaction(signingMessage);
      return { signature, publicKey };
    }
    // An MPC wallet signs the whole transaction and returns it raw.
    return signEvmTransaction(signingMessage, txRequest);
  };

  const send = async () => {
    if (!from || !to) return;
    setStep("sending");
    setSendError("");
    try {
      const prepared = await prepareSwap(from.id, to.id, amount);
      const sig = await signFor(prepared.chain, prepared.signingMessage, prepared.txRequest);
      const sent = await submitSwap({ swapId: prepared.swapId, ...sig });

      // The EVM fee: its own small transfer, signed straight after. Best
      // effort - the swap is already on its way whatever happens here.
      if (sent.feeLeg) {
        try {
          const feeSig = await signFor(prepared.chain, sent.feeLeg.signingMessage, sent.feeLeg.txRequest);
          await submitSwapFee({ swapId: prepared.swapId, ...feeSig });
        } catch (e) {
          if (__DEV__) console.warn("[swap] fee leg:", e);
        }
      }

      setSwap({
        id: prepared.swapId,
        status: "PROCESSING",
        swapStatus: "PENDING_DEPOSIT",
        from: { id: from.id, asset: from.asset, chain: from.chain, symbol: from.symbol, amount, net: prepared.quote.net, address: "" },
        to: { id: to.id, asset: to.asset, chain: to.chain, symbol: to.symbol, expected: prepared.quote.amountOut, minimum: prepared.quote.minAmountOut, address: "" },
        fee: { amount: prepared.quote.fee, symbol: from.symbol, bps: prepared.quote.feeBps, collected: false },
        amountOut: prepared.quote.amountOut,
        originTxHash: sent.txHash,
        destinationTxHash: null,
        originExplorerUrl: null,
        destinationExplorerUrl: null,
        refundedAmount: null,
        timeEstimate: prepared.quote.timeEstimate,
        createdAt: new Date().toISOString(),
        completedAt: null,
      });
      refreshBalances(true);
      refreshTransactions();
      setStep("watch");
    } catch (e: any) {
      console.error("[SWAP] failed:", e?.response?.data || e);
      setSendError(e?.response?.data?.error || e?.message || "The swap couldn't be sent. Nothing left your wallet.");
      setStep("review");
    }
  };

  /* ── Render ── */
  const header = (title: string, sub?: string, back = true) => (
    <View style={s.header}>
      {back ? (
        <TouchableOpacity
          onPress={() => (step === "review" ? setStep("edit") : router.back())}
          style={s.back}
          hitSlop={12}
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
      ) : (
        <View style={s.back} />
      )}
      <View style={s.headerText}>
        <Text style={[s.title, { color: colors.foreground }]}>{title}</Text>
        {!!sub && <Text style={[s.titleSub, { color: colors.mutedForeground }]}>{sub}</Text>}
      </View>
    </View>
  );

  if (configError || (config && !config.enabled)) {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        {header("Swap")}
        <View style={s.center}>
          <Feather name="pause-circle" size={40} color={colors.mutedForeground} />
          <Text style={[s.centerText, { color: colors.foreground }]}>
            {configError || "Swaps are paused right now. Please try again later."}
          </Text>
        </View>
      </View>
    );
  }

  if (!config) {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        {header("Swap")}
        <View style={s.center}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      </View>
    );
  }

  /* Watching and done */
  if ((step === "watch" || step === "done") && swap) {
    const done = swap.status === "COMPLETED";
    const refunded = swap.status === "REFUNDED";
    const failed = swap.status === "FAILED" || swap.status === "CANCELLED";
    const toName = SWAP_CHAIN_NAME[swap.to.chain];
    const fromName = SWAP_CHAIN_NAME[swap.from.chain];
    const delivered = done ? swap.amountOut : swap.to.expected ?? swap.amountOut;
    const tookS = swap.completedAt ? Math.max(1, Math.round((Date.parse(swap.completedAt) - Date.parse(swap.createdAt)) / 1000)) : null;
    const swapping = swap.swapStatus === "PROCESSING" || swap.swapStatus === "KNOWN_DEPOSIT_TX";

    if (step === "done") {
      return (
        <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
          <ScrollView contentContainerStyle={[s.doneBody, { paddingBottom: bottomPad + 24 }]}>
            <View style={[s.doneHalo, { backgroundColor: (done ? colors.primary : colors.warning) + "1F" }]}>
              <View style={[s.doneDisc, { backgroundColor: done ? colors.primary : colors.warning }]}>
                <Feather name={done ? "check" : "rotate-ccw"} size={26} color={colors.background} />
              </View>
            </View>
            <Text style={[s.doneEyebrow, { color: colors.mutedForeground }]}>
              {done ? "Swap complete" : refunded ? "Swap returned" : "Swap not completed"}
            </Text>
            <Text style={[s.doneFigure, { color: colors.foreground }]}>
              {done
                ? `${fmtCoin(swap.amountOut, swap.to.symbol)} ${swap.to.symbol}`
                : refunded
                  ? `${fmtCoin(swap.refundedAmount ?? swap.from.net ?? 0, swap.from.symbol)} ${swap.from.symbol}`
                  : "Nothing swapped"}
            </Text>
            <Text style={[s.doneSub, { color: colors.mutedForeground }]}>
              {done
                ? `is in your ${toName} wallet`
                : refunded
                  ? `went back to your ${fromName} wallet`
                  : "If anything left your wallet, it is being returned to it."}
            </Text>

            <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 28, alignSelf: "stretch" }]}>
              <Row label="You paid" value={`${fmtCoin(swap.from.amount ?? 0, swap.from.symbol)} ${swap.from.symbol}, ${fromName}`} colors={colors} />
              {done && <Row label="You got" value={`${fmtCoin(swap.amountOut, swap.to.symbol)} ${swap.to.symbol}, ${toName}`} colors={colors} />}
              {!!swap.fee && <Row label="Fee" value={`${fmtCoin(swap.fee.amount, swap.fee.symbol)} ${swap.fee.symbol}`} colors={colors} />}
              {done && tookS !== null && <Row label="Took" value={tookS < 90 ? `${tookS} seconds` : `${Math.round(tookS / 60)} minutes`} colors={colors} />}
              {!!(swap.destinationExplorerUrl || swap.originExplorerUrl) && (
                <Row
                  label={done ? `${toName} transaction` : `${fromName} transaction`}
                  value="View"
                  link={(done ? swap.destinationExplorerUrl : null) || swap.originExplorerUrl || undefined}
                  colors={colors}
                  last
                />
              )}
            </View>
          </ScrollView>
          <View style={[s.footer, { paddingBottom: bottomPad + 16 }]}>
            <TouchableOpacity
              style={[s.secondaryBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
              onPress={() => {
                setSwap(null);
                setAmountText("");
                setStep("edit");
              }}
            >
              <Text style={[s.secondaryBtnText, { color: colors.foreground }]}>Swap again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.primaryBtn, s.flex1, { backgroundColor: colors.primary }]} onPress={() => router.back()}>
              <Text style={[s.primaryBtnText, { color: colors.primaryForeground }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        {header("Swapping", undefined, false)}
        <ScrollView contentContainerStyle={[s.body, { paddingBottom: bottomPad + 24 }]}>
          <View style={s.pairHero}>
            <CoinMark asset={swap.from.asset} chain={swap.from.chain} size={52} colors={colors} />
            <View style={s.dots}>
              {[1, 0.6, 0.3].map((o) => (
                <View key={o} style={[s.dot, { backgroundColor: colors.primary, opacity: o }]} />
              ))}
            </View>
            <CoinMark asset={swap.to.asset} chain={swap.to.chain} size={52} colors={colors} />
          </View>
          <Text style={[s.watchTitle, { color: colors.foreground }]}>
            {fmtCoin(swap.from.amount ?? 0, swap.from.symbol)} {swap.from.symbol} to {swap.to.symbol}
          </Text>
          <Text style={[s.watchSub, { color: colors.mutedForeground }]}>
            {fromName} to {toName}
          </Text>

          <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border, paddingVertical: 18 }]}>
            <TrackStep state="done" title="Sent from your wallet" sub={`${fmtCoin(swap.from.amount ?? 0, swap.from.symbol)} ${swap.from.symbol} on ${fromName}`} colors={colors} />
            <TrackStep
              state="active"
              title="Swapping"
              sub={swap.swapStatus === "INCOMPLETE_DEPOSIT" ? "Waiting for the rest of the deposit" : swapping ? "Finding the best price" : "Waiting for the network to confirm"}
              colors={colors}
            />
            <TrackStep state="todo" title={`In your ${toName} wallet`} sub={`About ${fmtCoin(delivered, swap.to.symbol)} ${swap.to.symbol}`} colors={colors} last />
          </View>
        </ScrollView>
        <View style={[s.footerCol, { paddingBottom: bottomPad + 16 }]}>
          <Text style={[s.leaveNote, { color: colors.mutedForeground }]}>
            You can leave this screen. The swap carries on and shows in your transactions.
          </Text>
          <TouchableOpacity
            style={[s.secondaryBtn, s.stretch, { backgroundColor: colors.secondary, borderColor: colors.border }]}
            onPress={() => router.back()}
          >
            <Text style={[s.secondaryBtnText, { color: colors.foreground }]}>Back to home</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  /* Review */
  if ((step === "review" || step === "sending") && from && to) {
    const sending = step === "sending";
    const toAddr = walletAddresses[to.chain] || "";
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        {header("Review swap")}
        <ScrollView contentContainerStyle={[s.body, { paddingBottom: 24 }]}>
          <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border, paddingVertical: 18, gap: 14 }]}>
            <View style={s.reviewLine}>
              <CoinMark asset={from.asset} chain={from.chain} size={38} colors={colors} />
              <View style={s.flex1}>
                <Text style={[s.capLabel, { color: colors.mutedForeground }]}>You pay</Text>
                <Text style={[s.reviewFig, { color: colors.foreground }]}>
                  {fmtCoin(amount, from.symbol)} {from.symbol}
                </Text>
              </View>
              <Text style={[s.reviewChain, { color: colors.mutedForeground }]}>{SWAP_CHAIN_NAME[from.chain]}</Text>
            </View>
            <View style={s.reviewArrow}>
              <Feather name="arrow-down" size={14} color={colors.primary} />
              <View style={[s.hair, { backgroundColor: colors.border }]} />
            </View>
            <View style={s.reviewLine}>
              <CoinMark asset={to.asset} chain={to.chain} size={38} colors={colors} />
              <View style={s.flex1}>
                <Text style={[s.capLabel, { color: colors.mutedForeground }]}>You get about</Text>
                <Text style={[s.reviewFig, { color: colors.foreground }]}>
                  {quote ? `${fmtCoin(quote.amountOut, to.symbol)} ${to.symbol}` : "…"}
                </Text>
              </View>
              <Text style={[s.reviewChain, { color: colors.mutedForeground }]}>{SWAP_CHAIN_NAME[to.chain]}</Text>
            </View>
          </View>

          <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 14 }]}>
            <Row label="At least" value={quote ? `${fmtCoin(quote.minAmountOut, to.symbol)} ${to.symbol}` : "…"} colors={colors} strong />
            <Row label="Rate" value={quote ? `1 ${from.symbol} = ${quote.rate.toFixed(4)} ${to.symbol}` : "…"} colors={colors} />
            <Row label={`Fee (${feePct}%)`} value={quote ? `${fmtCoin(quote.fee, from.symbol)} ${from.symbol}` : "…"} colors={colors} />
            <Row label="Network fee" value="On us" colors={colors} accent />
            <Row label="Lands in" value={`Your ${SWAP_CHAIN_NAME[to.chain]} wallet${toAddr ? `, ${short(toAddr)}` : ""}`} colors={colors} />
            <Row
              label="Takes"
              value={quote ? (quote.timeEstimate <= 60 ? "Under a minute" : `About ${Math.ceil(quote.timeEstimate / 60)} minutes`) : "…"}
              colors={colors}
              last
            />
          </View>

          <View style={s.noteRow}>
            <Feather name="shield" size={14} color={colors.mutedForeground} style={{ marginTop: 2 }} />
            <Text style={[s.noteText, { color: colors.mutedForeground }]}>
              If the price moves below the minimum or the swap fails, your {from.symbol} comes back to your{" "}
              {SWAP_CHAIN_NAME[from.chain]} wallet.
            </Text>
          </View>
          {!!sendError && <Text style={[s.errorText, { color: colors.destructive }]}>{sendError}</Text>}
          {!!quoteError && <Text style={[s.errorText, { color: colors.destructive }]}>{quoteError}</Text>}
        </ScrollView>
        <View style={[s.footerCol, { paddingBottom: bottomPad + 16 }]}>
          {!sending && quote && <Text style={[s.holdText, { color: colors.mutedForeground }]}>Price held for 0:{String(hold).padStart(2, "0")}</Text>}
          <TouchableOpacity
            style={[s.primaryBtn, s.stretch, { backgroundColor: colors.primary, opacity: !quote || sending ? 0.6 : 1 }]}
            disabled={!quote || sending}
            onPress={() => requestPin(send)}
          >
            {sending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <>
                <Feather name="lock" size={17} color={colors.primaryForeground} />
                <Text style={[s.primaryBtnText, { color: colors.primaryForeground }]}>Confirm with PIN</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
        {pinModal()}
      </View>
    );
  }

  /* Edit */
  const canReview = !!from && !!to && amount > 0 && !belowMin && !overBalance && !!quote && !quoting;
  const hint = !from || !to
    ? ""
    : belowMin
      ? `The smallest swap is $${config.minUsd}.`
      : overBalance
        ? `You have ${fmtCoin(fromBalance, from.symbol)} ${from.symbol} on ${SWAP_CHAIN_NAME[from.chain]}.`
        : quoteError;

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {header("Swap", "Into your own wallet, any chain")}
      <KeyboardAvoidingView style={s.flex1} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={[s.body, { paddingBottom: 24 }]} keyboardShouldPersistTaps="handled">
          {!!config.notice && (
            <View style={[s.notice, { borderColor: colors.warning + "55", backgroundColor: colors.warning + "12" }]}>
              <Feather name="clock" size={14} color={colors.warning} />
              <Text style={[s.noticeText, { color: colors.foreground }]}>{config.notice}</Text>
            </View>
          )}

          <View style={[s.box, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.boxTop}>
              <Text style={[s.capLabel, { color: colors.mutedForeground }]}>You pay</Text>
              <View style={s.balanceRow}>
                <Text style={[s.capLabel, { color: colors.mutedForeground }]}>
                  Balance {from ? fmtCoin(fromBalance, from.symbol) : "0.00"}
                </Text>
                <TouchableOpacity
                  onPress={() => setAmountText(String(Math.floor(fromBalance * 1e6) / 1e6))}
                  hitSlop={10}
                  disabled={!from || fromBalance <= 0}
                >
                  <Text style={[s.maxText, { color: colors.primary }]}>Max</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={s.boxMid}>
              <TextInput
                value={amountText}
                onChangeText={(t) => setAmountText(t.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"))}
                placeholder="0.00"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="decimal-pad"
                style={[s.amountInput, { color: colors.foreground }]}
                accessibilityLabel="Amount to swap"
              />
              <AssetChip asset={from} colors={colors} onPress={() => setPicker("from")} placeholder="Pick" />
            </View>
            <Text style={[s.capLabel, { color: colors.mutedForeground }]}>{usd > 0 ? `$${usd.toFixed(2)}` : " "}</Text>
          </View>

          <View style={s.flipWrap}>
            <TouchableOpacity
              style={[s.flipBtn, { backgroundColor: colors.background, borderColor: colors.border, opacity: canFlip ? 1 : 0.4 }]}
              onPress={flip}
              disabled={!canFlip}
              accessibilityLabel="Swap direction"
            >
              <Feather name="repeat" size={18} color={colors.primary} style={{ transform: [{ rotate: "90deg" }] }} />
            </TouchableOpacity>
          </View>

          <View style={[s.box, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[s.capLabel, { color: colors.mutedForeground }]}>You get</Text>
            <View style={s.boxMid}>
              <View style={s.flex1}>
                {quoting && !quote ? (
                  <ActivityIndicator color={colors.mutedForeground} style={{ alignSelf: "flex-start", height: 42 }} />
                ) : (
                  <Text style={[s.amountOut, { color: quote ? colors.foreground : colors.mutedForeground }]} numberOfLines={1} adjustsFontSizeToFit>
                    {quote ? fmtCoin(quote.amountOut, to?.symbol) : "0.00"}
                  </Text>
                )}
              </View>
              <AssetChip asset={to} colors={colors} onPress={() => setPicker("to")} placeholder="Pick" />
            </View>
            <Text style={[s.capLabel, { color: colors.mutedForeground }]}>Estimate, updated live</Text>
          </View>

          {from && to && (
            <View style={s.facts}>
              <Fact label="Rate" value={quote ? `1 ${from.symbol} = ${quote.rate.toFixed(4)} ${to.symbol}` : "…"} colors={colors} />
              <Fact label={`Fee (${feePct}%)`} value={quote ? `${fmtCoin(quote.fee, from.symbol)} ${from.symbol}` : amount > 0 ? "…" : `${feePct}% of what you send`} colors={colors} />
              <Fact label="Arrives" value={`Your ${SWAP_CHAIN_NAME[to.chain]} wallet, under a minute`} colors={colors} />
            </View>
          )}

          {!!hint && <Text style={[s.errorText, { color: belowMin || overBalance ? colors.warning : colors.destructive }]}>{hint}</Text>}

          <TouchableOpacity onPress={() => router.push("/sweep" as any)} style={s.sweepLink}>
            <Text style={[s.sweepText, { color: colors.mutedForeground }]}>
              Gather small balances into USDC on Movement instead
            </Text>
            <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={[s.footerCol, { paddingBottom: bottomPad + 16 }]}>
        <TouchableOpacity
          style={[s.primaryBtn, s.stretch, { backgroundColor: colors.primary, opacity: canReview ? 1 : 0.45 }]}
          disabled={!canReview}
          onPress={() => {
            setSendError("");
            setStep("review");
          }}
        >
          <Text style={[s.primaryBtnText, { color: colors.primaryForeground }]}>Review swap</Text>
        </TouchableOpacity>
      </View>

      <Picker
        visible={picker !== null}
        title={picker === "from" ? "Swap from" : "Swap to"}
        assets={assets.filter((a) => (picker === "from" ? a.from : a.to))}
        selected={picker === "from" ? fromId : toId}
        balanceOf={balanceOf}
        onPick={pick}
        onClose={() => setPicker(null)}
        colors={colors}
        bottomPad={bottomPad}
      />
    </View>
  );

  function pinModal() {
    if (!showPin) return null;
    return (
      <Modal transparent animationType="slide" visible>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowPin(false)}>
          <View
            style={[s.pinSheet, { backgroundColor: colors.card, paddingBottom: bottomPad + 16 }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={[s.handle, { backgroundColor: colors.border }]} />
            <Text style={[s.pinHeading, { color: colors.foreground }]}>Confirm with PIN</Text>
            <Text style={[s.pinSub, { color: colors.mutedForeground }]}>Enter your 4-digit PIN to authorise this swap</Text>
            <View style={s.pinDots}>
              {[0, 1, 2, 3].map((i) => (
                <View
                  key={i}
                  style={[
                    s.pinDot,
                    i < pin.length
                      ? { backgroundColor: pinError ? colors.destructive : colors.primary }
                      : { borderWidth: 2, borderColor: pinError ? colors.destructive + "66" : colors.border },
                  ]}
                />
              ))}
            </View>
            <Text style={[s.pinErr, { color: pinError ? colors.destructive : "transparent" }]}>Incorrect PIN, try again</Text>
            <Keypad
              disabled={pin.length >= 4}
              onKey={(k) => handlePinInput(pin + k)}
              onBackspace={() => {
                setPinError(false);
                setPin(pin.slice(0, -1));
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    );
  }
}

/* ─── Pieces ───────────────────────────────────────────────────────── */

function CoinMark({ asset, chain, size, colors }: { asset: string; chain: string; size: number; colors: any }) {
  const badge = Math.round(size * 0.42);
  return (
    <View style={{ width: size, height: size }}>
      <TokenLogo symbol={asset} size={size} />
      {CHAIN_MARKS[chain] && (
        <Image
          source={CHAIN_MARKS[chain]}
          style={{
            position: "absolute",
            right: -3,
            bottom: -3,
            width: badge,
            height: badge,
            borderRadius: badge / 2,
            borderWidth: 2,
            borderColor: colors.card,
          }}
        />
      )}
    </View>
  );
}

function AssetChip({ asset, colors, onPress, placeholder }: { asset: SwapAsset | null; colors: any; onPress: () => void; placeholder: string }) {
  return (
    <TouchableOpacity style={[s.chip, { backgroundColor: colors.secondary, borderColor: colors.border }]} onPress={onPress} activeOpacity={0.8}>
      {asset ? (
        <>
          <CoinMark asset={asset.asset} chain={asset.chain} size={28} colors={colors} />
          <View>
            <Text style={[s.chipSym, { color: colors.foreground }]}>{asset.symbol}</Text>
            <Text style={[s.chipChain, { color: colors.mutedForeground }]}>{SWAP_CHAIN_NAME[asset.chain]}</Text>
          </View>
        </>
      ) : (
        <Text style={[s.chipSym, { color: colors.foreground, paddingHorizontal: 6 }]}>{placeholder}</Text>
      )}
      <Feather name="chevron-down" size={15} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

function Fact({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={s.fact}>
      <Text style={[s.factLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[s.factValue, { color: colors.foreground }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Row({
  label,
  value,
  colors,
  last,
  strong,
  accent,
  link,
}: {
  label: string;
  value: string;
  colors: any;
  last?: boolean;
  strong?: boolean;
  accent?: boolean;
  link?: string;
}) {
  const body = (
    <View style={[s.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
      <Text style={[s.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text
        style={[
          s.rowValue,
          { color: link || accent ? colors.primary : colors.foreground },
          (strong || link || accent) && { fontFamily: "Inter_600SemiBold" },
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
  return link ? <TouchableOpacity onPress={() => Linking.openURL(link)}>{body}</TouchableOpacity> : body;
}

function TrackStep({
  state,
  title,
  sub,
  colors,
  last,
}: {
  state: "done" | "active" | "todo";
  title: string;
  sub: string;
  colors: any;
  last?: boolean;
}) {
  return (
    <View style={s.track}>
      <View style={s.trackRail}>
        {state === "done" ? (
          <View style={[s.trackDone, { backgroundColor: colors.primary }]}>
            <Feather name="check" size={12} color={colors.primaryForeground} />
          </View>
        ) : state === "active" ? (
          <View style={[s.trackActive, { borderColor: colors.primary }]}>
            <View style={[s.trackPip, { backgroundColor: colors.primary }]} />
          </View>
        ) : (
          <View style={[s.trackTodo, { borderColor: colors.border }]} />
        )}
        {!last && <View style={[s.trackLine, { backgroundColor: state === "done" ? colors.primary : colors.border }]} />}
      </View>
      <View style={s.trackText}>
        <Text style={[s.trackTitle, { color: state === "todo" ? colors.mutedForeground : colors.foreground }]}>{title}</Text>
        <Text style={[s.trackSub, { color: colors.mutedForeground }]}>{sub}</Text>
      </View>
    </View>
  );
}

function Picker({
  visible,
  title,
  assets,
  selected,
  balanceOf,
  onPick,
  onClose,
  colors,
  bottomPad,
}: {
  visible: boolean;
  title: string;
  assets: SwapAsset[];
  selected: string | null;
  balanceOf: (a: SwapAsset) => number;
  onPick: (a: SwapAsset) => void;
  onClose: () => void;
  colors: any;
  bottomPad: number;
}) {
  const [q, setQ] = useState("");
  const [chain, setChain] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) {
      setQ("");
      setChain(null);
    }
  }, [visible]);

  const chains = useMemo(() => [...new Set(assets.map((a) => a.chain))], [assets]);
  const list = assets.filter((a) => {
    if (chain && a.chain !== chain) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return a.symbol.toLowerCase().includes(needle) || SWAP_CHAIN_NAME[a.chain].toLowerCase().includes(needle);
  });

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose}>
        <View
          style={[s.pickerSheet, { backgroundColor: colors.card, paddingBottom: bottomPad + 16 }]}
          onStartShouldSetResponder={() => true}
        >
          <View style={[s.handle, { backgroundColor: colors.border }]} />
          <View style={s.pickerHead}>
            <Text style={[s.pickerTitle, { color: colors.foreground }]}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityLabel="Close">
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <View style={[s.search, { backgroundColor: colors.input, borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search a coin or chain"
              placeholderTextColor={colors.mutedForeground}
              style={[s.searchInput, { color: colors.foreground }]}
              accessibilityLabel="Search coins"
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
            {[null, ...chains].map((c) => {
              const on = chain === c;
              return (
                <TouchableOpacity
                  key={c ?? "all"}
                  onPress={() => setChain(c)}
                  style={[s.filterChip, on ? { backgroundColor: colors.primary } : { backgroundColor: colors.secondary, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}
                >
                  <Text style={[s.filterText, { color: on ? colors.primaryForeground : colors.foreground }]}>
                    {c ? SWAP_CHAIN_NAME[c as keyof typeof SWAP_CHAIN_NAME] : "All"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
            {list.map((a) => {
              const bal = balanceOf(a);
              return (
                <TouchableOpacity key={a.id} style={s.pickRow} onPress={() => onPick(a)} activeOpacity={0.75}>
                  <CoinMark asset={a.asset} chain={a.chain} size={34} colors={colors} />
                  <View style={s.flex1}>
                    <Text style={[s.pickSym, { color: colors.foreground }]}>{a.symbol}</Text>
                    <Text style={[s.pickNote, { color: colors.mutedForeground }]}>
                      {SWAP_CHAIN_NAME[a.chain]}
                      {bal > 0 ? ` · ${fmtCoin(bal, a.symbol)} in your wallet` : ""}
                    </Text>
                  </View>
                  {selected === a.id && <Feather name="check" size={18} color={colors.primary} />}
                </TouchableOpacity>
              );
            })}
            {!list.length && <Text style={[s.pickNote, { color: colors.mutedForeground, paddingVertical: 24, textAlign: "center" }]}>Nothing matches that.</Text>}
          </ScrollView>
          <Text style={[s.pickFoot, { color: colors.mutedForeground }]}>
            Only coins your wallet can hold are listed, so whatever you pick lands in your own wallet.
          </Text>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  flex1: { flex: 1 },
  stretch: { alignSelf: "stretch" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 16 },
  back: { width: 40 },
  headerText: { flex: 1, alignItems: "center", marginRight: 40 },
  title: { fontSize: 19, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  titleSub: { fontSize: 12.5, fontFamily: "Inter_400Regular", marginTop: 2 },
  body: { paddingHorizontal: 20 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 14 },
  centerText: { fontSize: 15, fontFamily: "Inter_500Medium", textAlign: "center", lineHeight: 21 },

  notice: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginBottom: 12 },
  noticeText: { flex: 1, fontSize: 12.5, fontFamily: "Inter_500Medium", lineHeight: 17 },

  box: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  boxTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  balanceRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  maxText: { fontSize: 12.5, fontFamily: "Inter_600SemiBold" },
  boxMid: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 10 },
  capLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  amountInput: { flex: 1, minWidth: 0, fontSize: 34, fontFamily: "Inter_700Bold", letterSpacing: -0.8, padding: 0 },
  amountOut: { fontSize: 34, fontFamily: "Inter_700Bold", letterSpacing: -0.8 },

  chip: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 7, paddingRight: 10, paddingVertical: 7, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, minHeight: 44 },
  chipSym: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  chipChain: { fontSize: 10.5, fontFamily: "Inter_400Regular" },

  flipWrap: { alignItems: "center", marginVertical: -12, zIndex: 1 },
  flipBtn: { width: 44, height: 44, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },

  facts: { marginTop: 16, gap: 10, paddingHorizontal: 4 },
  fact: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  factLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  factValue: { fontSize: 13, fontFamily: "Inter_500Medium", flexShrink: 1, textAlign: "right" },

  errorText: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 14, textAlign: "center", lineHeight: 18 },
  sweepLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 22, paddingVertical: 8 },
  sweepText: { fontSize: 12.5, fontFamily: "Inter_500Medium" },

  footer: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 10 },
  footerCol: { paddingHorizontal: 20, paddingTop: 10, alignItems: "center" },
  primaryBtn: { height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  primaryBtnText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  secondaryBtn: { flex: 1, height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  secondaryBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  holdText: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 10 },

  card: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, gap: 12 },
  rowLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  rowValue: { fontSize: 13, fontFamily: "Inter_500Medium", flexShrink: 1, textAlign: "right" },
  reviewLine: { flexDirection: "row", alignItems: "center", gap: 12 },
  reviewFig: { fontSize: 20, fontFamily: "Inter_700Bold", letterSpacing: -0.4 },
  reviewChain: { fontSize: 12.5, fontFamily: "Inter_400Regular" },
  reviewArrow: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 13 },
  hair: { flex: 1, height: StyleSheet.hairlineWidth },
  noteRow: { flexDirection: "row", gap: 9, marginTop: 14, paddingHorizontal: 2 },
  noteText: { flex: 1, fontSize: 12.5, lineHeight: 18, fontFamily: "Inter_400Regular" },

  pairHero: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 20, marginBottom: 16 },
  dots: { flexDirection: "row", gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  watchTitle: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.6, textAlign: "center" },
  watchSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 6, marginBottom: 26 },
  leaveNote: { fontSize: 12.5, lineHeight: 18, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 14, paddingHorizontal: 10 },

  track: { flexDirection: "row", gap: 12 },
  trackRail: { alignItems: "center" },
  trackDone: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  trackActive: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  trackPip: { width: 8, height: 8, borderRadius: 4 },
  trackTodo: { width: 22, height: 22, borderRadius: 11, borderWidth: 2 },
  trackLine: { width: 2, height: 32 },
  trackText: { paddingTop: 1, paddingBottom: 10, flex: 1 },
  trackTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  trackSub: { fontSize: 12.5, fontFamily: "Inter_400Regular", marginTop: 2 },

  doneBody: { paddingHorizontal: 20, alignItems: "center", paddingTop: 70 },
  doneHalo: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center", marginBottom: 22 },
  doneDisc: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  doneEyebrow: { fontSize: 15, fontFamily: "Inter_500Medium" },
  doneFigure: { fontSize: 32, fontFamily: "Inter_700Bold", letterSpacing: -0.9, marginTop: 6, textAlign: "center" },
  doneSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 6, textAlign: "center", lineHeight: 18 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginTop: 10, marginBottom: 12 },
  pinSheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20 },
  pinHeading: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  pinSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 6 },
  pinDots: { flexDirection: "row", justifyContent: "center", gap: 16, marginTop: 22 },
  pinDot: { width: 14, height: 14, borderRadius: 7 },
  pinErr: { fontSize: 12.5, fontFamily: "Inter_500Medium", textAlign: "center", marginVertical: 12 },

  pickerSheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, maxHeight: "85%" },
  pickerHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  pickerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  search: { flexDirection: "row", alignItems: "center", gap: 10, height: 46, paddingHorizontal: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", padding: 0 },
  chips: { gap: 8, paddingVertical: 12 },
  filterChip: { height: 32, paddingHorizontal: 12, borderRadius: 999, justifyContent: "center" },
  filterText: { fontSize: 12.5, fontFamily: "Inter_600SemiBold" },
  pickRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, minHeight: 56 },
  pickSym: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  pickNote: { fontSize: 12.5, fontFamily: "Inter_400Regular", marginTop: 1 },
  pickFoot: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 10 },
});
