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
  Keyboard,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { CoinMark } from "@/components/SwapRoute";
import { Keypad } from "@/components/Keypad";
import { signSolanaTransaction, signEvmTransaction, signMovementTransaction, ensureSigningSession } from "@/services/wallet-core";
import {
  getSwapConfig,
  cachedSwapConfig,
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
 * One screen, four states in the order they happen: choosing, reviewing,
 * watching, done. One route rather than four, so the back button can never
 * walk somebody into a review of a swap that has already gone.
 *
 * Words are kept to what a decision needs. Labels name the two amounts; the
 * rate and fee sit on one quiet line; the review lists five facts. The fee is
 * taken from what is sent, so "You pay" is always the whole of what leaves the
 * wallet. The server sets the fee and minimum and re-checks both at every step.
 *
 * It opens on the config Home already fetched, so there is no loading screen
 * between tapping Swap and being able to type.
 */

type Step = "edit" | "review" | "sending" | "watch" | "done";

/** No faster than every ten seconds for an automatic refresh, per their guidance. */
const QUOTE_REFRESH_MS = 15_000;
const QUOTE_DEBOUNCE_MS = 600;
/** And five to ten seconds for status. */
const STATUS_POLL_MS = 6_000;
/** How long a reviewed price stands before it is fetched again. */
const REVIEW_HOLD_S = 30;

const short = (a?: string | null) => (a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "");

/** "You pay with" lists only coins holding at least this much. Anything less is dust no swap could take. */
const MIN_PAY_BALANCE = 0.1;

/** Where to start: what the person holds most of, going to USDC on Monad, or whatever else is first. */
function defaultsFor(c: SwapConfig, held: (a: SwapAsset) => number, wanted?: string) {
  const froms = c.assets.filter((a) => a.from);
  const tos = c.assets.filter((a) => a.to);
  const first = froms.find((a) => a.id === wanted) ?? [...froms].sort((a, b) => held(b) * b.price - held(a) * a.price)[0];
  if (!first) return { from: null, to: null };
  const to = tos.find((a) => a.id === "MONAD:USDC" && a.id !== first.id) ?? tos.find((a) => a.id !== first.id);
  return { from: first.id, to: to?.id ?? null };
}

export default function SwapScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ from?: string }>();
  const { walletBalances, walletAddresses, verifyPin, bioTx, refreshBalances, refreshTransactions } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const balanceOf = useCallback(
    (a: SwapAsset | null) => (a ? walletBalances.find((b) => b.asset === a.asset && b.chain === a.chain)?.balance ?? 0 : 0),
    [walletBalances],
  );

  const initial = cachedSwapConfig();
  const initialPick = initial ? defaultsFor(initial, balanceOf, params.from) : { from: null, to: null };
  const [config, setConfig] = useState<SwapConfig | null>(initial);
  const [configError, setConfigError] = useState("");
  const [fromId, setFromId] = useState<string | null>(initialPick.from);
  const [toId, setToId] = useState<string | null>(initialPick.to);
  const [amountText, setAmountText] = useState("");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [picker, setPicker] = useState<"from" | "to" | null>(null);
  const [step, setStep] = useState<Step>("edit");
  const [sendError, setSendError] = useState("");
  const [swap, setSwap] = useState<SwapState | null>(null);
  const [hold, setHold] = useState(REVIEW_HOLD_S);

  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const pendingAction = useRef<() => void>(() => {});

  // Review rides the keyboard, as Save does on the name screen, so it is never behind the keys.
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  /* ── Config: shown from memory at once, refreshed behind ── */
  useEffect(() => {
    getSwapConfig()
      .then((c) => {
        setConfig(c);
        if (!fromId) {
          const d = defaultsFor(c, balanceOf, params.from);
          setFromId(d.from);
          setToId(d.to);
        }
      })
      .catch((e) => {
        if (!cachedSwapConfig()) setConfigError(e?.response?.data?.error || "Swap couldn't load. Check your connection.");
      });
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const assets = config?.assets ?? [];
  const from = assets.find((a) => a.id === fromId) ?? null;
  const to = assets.find((a) => a.id === toId) ?? null;
  const amount = Number(amountText.replace(/,/g, ""));
  const fromBalance = balanceOf(from);
  // Dollar coins at face value, as the server counts them: 2 USDC meets a $2 minimum.
  const usd = from && amount > 0 ? (from.asset === "USDC" || from.asset === "USDT" || from.asset === "USDCx" ? amount : amount * from.price) : 0;
  const belowMin = !!config && amount > 0 && usd < config.minUsd;
  const overMax = !!config?.maxUsd && amount > 0 && usd > config.maxUsd + 1e-9;
  const overBalance = amount > 0 && amount > fromBalance + 1e-9;

  /* ── Quote: debounced while typing, refreshed while it sits ── */
  const quoteSeq = useRef(0);
  const fetchQuote = useCallback(async () => {
    if (!from || !to || !(amount > 0) || belowMin || overMax) {
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
  }, [from, to, amount, belowMin, overMax]);

  // The review keeps its own clock, so the background refresh only runs while choosing.
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
  }, [fromId, toId, amountText, config?.feeBps, step === "edit" || step === "review"]);

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

  /* ── Watching ── */
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
    // Out of Movement: their USDCx goes to our wallet, with the gas sponsored.
    if (chain === "MOVE") {
      const { signature, publicKey } = await signMovementTransaction(signingMessage);
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
      // A lapsed wallet session signs out here, before the server opens a row it couldn't then close.
      await ensureSigningSession();
      const prepared = await prepareSwap(from.id, to.id, amount);
      const sig = await signFor(prepared.chain, prepared.signingMessage, prepared.txRequest);
      const sent = await submitSwap({ swapId: prepared.swapId, ...sig });

      // The EVM fee is its own small transfer, signed straight after. Best
      // effort: the swap is already on its way whatever happens here.
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
  const header = (title: string, back = true) => (
    <View style={s.header}>
      {back ? (
        <TouchableOpacity
          onPress={() => (step === "review" ? setStep("edit") : router.back())}
          style={[s.iconBtn, { backgroundColor: colors.card }]}
          hitSlop={8}
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
      ) : (
        <View style={s.iconBtn} />
      )}
      <Text style={[s.title, { color: colors.foreground }]}>{title}</Text>
      <View style={s.iconBtn} />
    </View>
  );

  if (configError || (config && !config.enabled)) {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        {header("Swap")}
        <View style={s.center}>
          <Feather name="pause-circle" size={36} color={colors.mutedForeground} />
          <Text style={[s.centerText, { color: colors.foreground }]}>{configError || "Swap is paused right now."}</Text>
        </View>
      </View>
    );
  }

  /* Watching and done */
  if ((step === "watch" || step === "done") && swap) {
    const done = swap.status === "COMPLETED";
    const refunded = swap.status === "REFUNDED";
    const toName = SWAP_CHAIN_NAME[swap.to.chain];
    const fromName = SWAP_CHAIN_NAME[swap.from.chain];
    const tookS = swap.completedAt ? Math.max(1, Math.round((Date.parse(swap.completedAt) - Date.parse(swap.createdAt)) / 1000)) : null;
    const swapping = swap.swapStatus === "PROCESSING" || swap.swapStatus === "KNOWN_DEPOSIT_TX";
    // A swap out of Movement is refunded on Base, the chain it routes through.
    const refundName = swap.from.chain === "MOVE" ? "Base" : fromName;
    const link = (done ? swap.destinationExplorerUrl : null) || swap.originExplorerUrl;

    if (step === "done") {
      return (
        <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
          <ScrollView contentContainerStyle={[s.doneBody, { paddingBottom: bottomPad + 24 }]}>
            <View style={[s.doneDisc, { backgroundColor: done ? colors.primary : colors.warning }]}>
              <Feather name={done ? "check" : "rotate-ccw"} size={28} color={colors.background} />
            </View>
            <Text style={[s.doneFigure, { color: colors.foreground }]}>
              {done
                ? `${fmtCoin(swap.amountOut, swap.to.symbol)} ${swap.to.symbol}`
                : refunded
                  ? swap.from.chain === "MOVE"
                    ? `${fmtCoin(swap.refundedAmount ?? swap.from.net ?? 0, "USDC")} USDC`
                    : `${fmtCoin(swap.refundedAmount ?? swap.from.net ?? 0, swap.from.symbol)} ${swap.from.symbol}`
                  : "Not completed"}
            </Text>
            <Text style={[s.doneSub, { color: colors.mutedForeground }]}>
              {done ? `In your ${toName} wallet` : refunded ? `Returned to your ${refundName} wallet` : "Anything sent is on its way back"}
            </Text>

            <View style={[s.card, { backgroundColor: colors.card, marginTop: 32, alignSelf: "stretch" }]}>
              <Row label="Paid" value={`${fmtCoin(swap.from.amount ?? 0, swap.from.symbol)} ${swap.from.symbol} · ${fromName}`} colors={colors} />
              {!!swap.fee && <Row label="Fee" value={`${fmtCoin(swap.fee.amount, swap.fee.symbol)} ${swap.fee.symbol}`} colors={colors} />}
              {done && tookS !== null && <Row label="Time" value={tookS < 90 ? `${tookS}s` : `${Math.round(tookS / 60)} min`} colors={colors} />}
              {!!link && <Row label="Transaction" value="View" link={link} colors={colors} last />}
            </View>
          </ScrollView>
          <View style={[s.footerRow, { paddingBottom: bottomPad + 16 }]}>
            <TouchableOpacity
              style={[s.ghostBtn, { backgroundColor: colors.card }]}
              onPress={() => {
                setSwap(null);
                setAmountText("");
                setStep("edit");
              }}
            >
              <Text style={[s.ghostBtnText, { color: colors.foreground }]}>New swap</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.cta, s.flex1, { backgroundColor: colors.primary }]} onPress={() => router.back()}>
              <Text style={[s.ctaText, { color: colors.primaryForeground }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        {header("Swapping", false)}
        <ScrollView contentContainerStyle={[s.body, { paddingBottom: bottomPad + 24 }]}>
          <View style={s.pairHero}>
            <CoinMark asset={swap.from.asset} chain={swap.from.chain} size={56} ring={colors.card} />
            <Feather name="arrow-right" size={18} color={colors.mutedForeground} />
            <CoinMark asset={swap.to.asset} chain={swap.to.chain} size={56} ring={colors.card} />
          </View>
          <Text style={[s.watchTitle, { color: colors.foreground }]}>
            {fmtCoin(swap.from.amount ?? 0, swap.from.symbol)} {swap.from.symbol}
          </Text>
          <Text style={[s.watchSub, { color: colors.mutedForeground }]}>
            to about {fmtCoin(swap.to.expected ?? swap.amountOut, swap.to.symbol)} {swap.to.symbol} on {toName}
          </Text>

          <View style={[s.card, { backgroundColor: colors.card, paddingVertical: 18 }]}>
            <TrackStep state="done" title="Sent" colors={colors} />
            <TrackStep
              state="active"
              title={
                swap.held
                  ? "Being finished for you"
                  : swap.swapStatus === "INCOMPLETE_DEPOSIT"
                    ? "Waiting for the rest"
                    : swapping
                      ? "Swapping"
                      : "Confirming"
              }
              colors={colors}
            />
            <TrackStep state="todo" title={`In your ${toName} wallet`} colors={colors} last />
          </View>
        </ScrollView>
        <View style={[s.footerCol, { paddingBottom: bottomPad + 16 }]}>
          <Text style={[s.quiet, { color: colors.mutedForeground, marginBottom: 12 }]}>You can close this. It keeps going.</Text>
          <TouchableOpacity style={[s.ghostBtn, s.stretch, { backgroundColor: colors.card }]} onPress={() => router.back()}>
            <Text style={[s.ghostBtnText, { color: colors.foreground }]}>Close</Text>
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
        {header("Review")}
        <ScrollView contentContainerStyle={[s.body, { paddingBottom: 24 }]}>
          <View style={[s.card, { backgroundColor: colors.card, paddingVertical: 20, gap: 16 }]}>
            <View style={s.reviewLine}>
              <CoinMark asset={from.asset} chain={from.chain} size={40} ring={colors.card} />
              <View style={s.flex1}>
                <Text style={[s.reviewFig, { color: colors.foreground }]}>
                  {fmtCoin(amount, from.symbol)} {from.symbol}
                </Text>
                <Text style={[s.quiet, { color: colors.mutedForeground }]}>{SWAP_CHAIN_NAME[from.chain]}</Text>
              </View>
            </View>
            <View style={[s.reviewDivider, { backgroundColor: colors.border }]}>
              <View style={[s.reviewArrow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="arrow-down" size={14} color={colors.primary} />
              </View>
            </View>
            <View style={s.reviewLine}>
              <CoinMark asset={to.asset} chain={to.chain} size={40} ring={colors.card} />
              <View style={s.flex1}>
                <Text style={[s.reviewFig, { color: colors.foreground }]}>
                  {quote ? `${fmtCoin(quote.amountOut, to.symbol)} ${to.symbol}` : "…"}
                </Text>
                <Text style={[s.quiet, { color: colors.mutedForeground }]}>{SWAP_CHAIN_NAME[to.chain]}</Text>
              </View>
            </View>
          </View>

          <View style={[s.card, { backgroundColor: colors.card, marginTop: 12 }]}>
            <Row label="Minimum received" value={quote ? `${fmtCoin(quote.minAmountOut, to.symbol)} ${to.symbol}` : "…"} colors={colors} />
            <Row label="Rate" value={quote ? `1 ${from.symbol} = ${quote.rate.toFixed(4)} ${to.symbol}` : "…"} colors={colors} />
            <Row label="Fee" value={quote ? `${fmtCoin(quote.fee, from.symbol)} ${from.symbol}` : "…"} colors={colors} />
            <Row label="Network fee" value="Free" colors={colors} accent />
            <Row label="To" value={toAddr ? short(toAddr) : `Your ${SWAP_CHAIN_NAME[to.chain]} wallet`} colors={colors} last />
          </View>

          <Text style={[s.quiet, s.centered, { color: colors.mutedForeground, marginTop: 14 }]}>
            If it can't complete, it comes back to your wallet.
          </Text>
          {!!(sendError || quoteError) && <Text style={[s.hint, { color: colors.destructive }]}>{sendError || quoteError}</Text>}
        </ScrollView>
        <View style={[s.footerCol, { paddingBottom: bottomPad + 16 }]}>
          {!sending && quote && (
            <Text style={[s.quiet, { color: colors.mutedForeground, marginBottom: 10 }]}>Price refreshes in {hold}s</Text>
          )}
          <TouchableOpacity
            style={[s.cta, s.stretch, { backgroundColor: colors.primary, opacity: !quote || sending ? 0.55 : 1 }]}
            disabled={!quote || sending}
            onPress={() => requestPin(send)}
          >
            {sending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[s.ctaText, { color: colors.primaryForeground }]}>Confirm swap</Text>
            )}
          </TouchableOpacity>
        </View>
        {pinModal()}
      </View>
    );
  }

  /* Edit */
  const canReview = !!from && !!to && amount > 0 && !belowMin && !overMax && !overBalance && !!quote && !quoting;
  const hint = !from || !to
    ? ""
    : belowMin
      ? `Minimum swap is $${config!.minUsd}`
      : overMax
        ? `Maximum swap is $${config!.maxUsd}`
        : overBalance
          ? "More than your balance"
          : quoteError;

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {header("Swap")}
      <View style={s.flex1}>
        <ScrollView contentContainerStyle={[s.body, { paddingBottom: 24 }]} keyboardShouldPersistTaps="handled">
          {!!config?.notice && (
            <View style={[s.notice, { backgroundColor: colors.warning + "14" }]}>
              <Feather name="clock" size={13} color={colors.warning} />
              <Text style={[s.noticeText, { color: colors.foreground }]} numberOfLines={2}>
                {config.notice}
              </Text>
            </View>
          )}

          <View style={[s.panel, { backgroundColor: colors.card }]}>
            <View style={s.panelTop}>
              <Text style={[s.panelLabel, { color: colors.mutedForeground }]}>You pay</Text>
              {!!from && (
                <TouchableOpacity
                  onPress={() => setAmountText(String(Math.floor(fromBalance * 1e6) / 1e6))}
                  disabled={fromBalance <= 0}
                  hitSlop={10}
                  style={s.balanceBtn}
                >
                  <Text style={[s.panelLabel, { color: colors.mutedForeground }]}>{fmtCoin(fromBalance, from.symbol)}</Text>
                  <View style={[s.maxPill, { backgroundColor: colors.primary + "1F" }]}>
                    <Text style={[s.maxText, { color: colors.primary }]}>MAX</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
            <View style={s.panelMid}>
              <TextInput
                value={amountText}
                onChangeText={(t) => setAmountText(t.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"))}
                placeholder="0"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="decimal-pad"
                style={[s.amountInput, { color: colors.foreground }]}
                accessibilityLabel="Amount to swap"
              />
              <AssetChip asset={from} colors={colors} onPress={() => setPicker("from")} />
            </View>
            <Text style={[s.panelLabel, { color: colors.mutedForeground }]}>{usd > 0 ? `$${usd.toFixed(2)}` : " "}</Text>
          </View>

          <View style={s.flipWrap}>
            <TouchableOpacity
              style={[s.flipBtn, { backgroundColor: colors.card, borderColor: colors.background, opacity: canFlip ? 1 : 0.5 }]}
              onPress={flip}
              disabled={!canFlip}
              accessibilityLabel="Swap direction"
            >
              <Feather name="arrow-down" size={18} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <View style={[s.panel, { backgroundColor: colors.card }]}>
            <Text style={[s.panelLabel, { color: colors.mutedForeground }]}>You receive</Text>
            <View style={s.panelMid}>
              <View style={s.flex1}>
                {quoting && !quote ? (
                  <ActivityIndicator color={colors.mutedForeground} style={{ alignSelf: "flex-start", height: 44 }} />
                ) : (
                  <Text
                    style={[s.amountOut, { color: quote ? colors.foreground : colors.mutedForeground }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {quote ? fmtCoin(quote.amountOut, to?.symbol) : "0"}
                  </Text>
                )}
              </View>
              <AssetChip asset={to} colors={colors} onPress={() => setPicker("to")} />
            </View>
            <Text style={[s.panelLabel, { color: colors.mutedForeground }]}>
              {quote?.amountOutUsd ? `$${quote.amountOutUsd.toFixed(2)}` : " "}
            </Text>
          </View>

          {quote && from && to ? (
            <View style={s.meta}>
              <Text style={[s.quiet, { color: colors.mutedForeground }]}>
                1 {from.symbol} = {quote.rate.toFixed(4)} {to.symbol}
              </Text>
              <Text style={[s.quiet, { color: colors.mutedForeground }]}>
                Fee {fmtCoin(quote.fee, from.symbol)} {from.symbol}
              </Text>
            </View>
          ) : null}

          {!!hint && <Text style={[s.hint, { color: belowMin || overMax || overBalance ? colors.warning : colors.destructive }]}>{hint}</Text>}
        </ScrollView>
      </View>
      <View style={[s.footerCol, { marginBottom: kbHeight, paddingBottom: kbHeight > 0 ? 12 : bottomPad + 16 }]}>
        <TouchableOpacity
          style={[s.cta, s.stretch, { backgroundColor: colors.primary, opacity: canReview ? 1 : 0.4 }]}
          disabled={!canReview}
          onPress={() => {
            Keyboard.dismiss();
            setSendError("");
            setStep("review");
          }}
        >
          <Text style={[s.ctaText, { color: colors.primaryForeground }]}>{amount > 0 ? "Review" : "Enter an amount"}</Text>
        </TouchableOpacity>
      </View>

      <Picker
        visible={picker !== null}
        title={picker === "from" ? "You pay with" : "You receive"}
        assets={assets.filter((a) => (picker === "from" ? a.from && balanceOf(a) >= MIN_PAY_BALANCE : a.to))}
        empty={picker === "from" ? "No balance to swap yet" : "No match"}
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
          <View style={[s.sheet, { backgroundColor: colors.card, paddingBottom: bottomPad + 16 }]} onStartShouldSetResponder={() => true}>
            <View style={[s.handle, { backgroundColor: colors.border }]} />
            <Text style={[s.sheetTitle, s.centered, { color: colors.foreground }]}>Enter your PIN</Text>
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
            <Text style={[s.pinErr, { color: pinError ? colors.destructive : "transparent" }]}>Incorrect PIN</Text>
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

function AssetChip({ asset, colors, onPress }: { asset: SwapAsset | null; colors: any; onPress: () => void }) {
  return (
    <TouchableOpacity style={[s.chip, { backgroundColor: colors.background }]} onPress={onPress} activeOpacity={0.8}>
      {asset ? (
        <>
          <CoinMark asset={asset.asset} chain={asset.chain} size={28} ring={colors.card} />
          <Text style={[s.chipSym, { color: colors.foreground }]}>{asset.symbol}</Text>
        </>
      ) : (
        <Text style={[s.chipSym, { color: colors.foreground, paddingLeft: 6 }]}>Select</Text>
      )}
      <Feather name="chevron-down" size={15} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

function Row({ label, value, colors, last, accent, link }: { label: string; value: string; colors: any; last?: boolean; accent?: boolean; link?: string }) {
  const body = (
    <View style={[s.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
      <Text style={[s.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[s.rowValue, { color: link || accent ? colors.primary : colors.foreground }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
  return link ? <TouchableOpacity onPress={() => Linking.openURL(link)}>{body}</TouchableOpacity> : body;
}

function TrackStep({ state, title, colors, last }: { state: "done" | "active" | "todo"; title: string; colors: any; last?: boolean }) {
  return (
    <View style={s.track}>
      <View style={s.trackRail}>
        {state === "done" ? (
          <View style={[s.trackDot, { backgroundColor: colors.primary }]}>
            <Feather name="check" size={12} color={colors.primaryForeground} />
          </View>
        ) : state === "active" ? (
          <View style={[s.trackDot, { borderWidth: 2, borderColor: colors.primary }]}>
            <ActivityIndicator size="small" color={colors.primary} style={{ transform: [{ scale: 0.6 }] }} />
          </View>
        ) : (
          <View style={[s.trackDot, { borderWidth: 2, borderColor: colors.border }]} />
        )}
        {!last && <View style={[s.trackLine, { backgroundColor: state === "done" ? colors.primary : colors.border }]} />}
      </View>
      <Text style={[s.trackTitle, { color: state === "todo" ? colors.mutedForeground : colors.foreground }]}>{title}</Text>
    </View>
  );
}

function Picker({
  visible,
  title,
  assets,
  empty,
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
  empty: string;
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
        <View style={[s.sheet, s.pickerSheet, { backgroundColor: colors.card, paddingBottom: bottomPad + 12 }]} onStartShouldSetResponder={() => true}>
          <View style={[s.handle, { backgroundColor: colors.border }]} />
          <Text style={[s.sheetTitle, { color: colors.foreground }]}>{title}</Text>
          <View style={[s.search, { backgroundColor: colors.background }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search"
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
                  style={[s.filterChip, { backgroundColor: on ? colors.foreground : colors.background }]}
                >
                  <Text style={[s.filterText, { color: on ? colors.background : colors.mutedForeground }]}>
                    {c ? SWAP_CHAIN_NAME[c as keyof typeof SWAP_CHAIN_NAME] : "All"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <ScrollView style={{ maxHeight: 440 }} keyboardShouldPersistTaps="handled">
            {list.map((a) => {
              const bal = balanceOf(a);
              const on = selected === a.id;
              return (
                <TouchableOpacity
                  key={a.id}
                  style={[s.pickRow, on && { backgroundColor: colors.background }]}
                  onPress={() => onPick(a)}
                  activeOpacity={0.75}
                >
                  <CoinMark asset={a.asset} chain={a.chain} size={36} ring={colors.card} />
                  <View style={s.flex1}>
                    <Text style={[s.pickSym, { color: colors.foreground }]}>{a.symbol}</Text>
                    <Text style={[s.quiet, { color: colors.mutedForeground }]}>{SWAP_CHAIN_NAME[a.chain]}</Text>
                  </View>
                  {bal > 0 && <Text style={[s.pickBal, { color: colors.foreground }]}>{fmtCoin(bal, a.symbol)}</Text>}
                </TouchableOpacity>
              );
            })}
            {!list.length && (
              <Text style={[s.quiet, s.centered, { color: colors.mutedForeground, paddingVertical: 28 }]}>
                {q.trim() ? "No match" : empty}
              </Text>
            )}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  flex1: { flex: 1 },
  stretch: { alignSelf: "stretch" },
  centered: { textAlign: "center" },

  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 14 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },

  body: { paddingHorizontal: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 14 },
  centerText: { fontSize: 15, fontFamily: "Inter_500Medium", textAlign: "center" },
  quiet: { fontSize: 13, fontFamily: "Inter_500Medium" },
  hint: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 14, textAlign: "center" },

  notice: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, marginBottom: 10 },
  noticeText: { flex: 1, fontSize: 12.5, fontFamily: "Inter_500Medium" },

  panel: { borderRadius: 24, paddingHorizontal: 18, paddingVertical: 16 },
  panelTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  panelLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  balanceBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  maxPill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  maxText: { fontSize: 10.5, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
  panelMid: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 12 },
  amountInput: { flex: 1, minWidth: 0, fontSize: 40, fontFamily: "Inter_700Bold", letterSpacing: -1.2, padding: 0 },
  amountOut: { fontSize: 40, fontFamily: "Inter_700Bold", letterSpacing: -1.2 },

  chip: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 6, paddingRight: 10, height: 46, borderRadius: 23 },
  chipSym: { fontSize: 15, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },

  flipWrap: { alignItems: "center", marginVertical: -18, zIndex: 1 },
  flipBtn: { width: 44, height: 44, borderRadius: 14, borderWidth: 4, alignItems: "center", justifyContent: "center" },

  meta: { flexDirection: "row", justifyContent: "space-between", marginTop: 14, paddingHorizontal: 6 },

  footerRow: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 10 },
  footerCol: { paddingHorizontal: 16, paddingTop: 10, alignItems: "center" },
  cta: { height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  ghostBtn: { flex: 1, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  ghostBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  card: { borderRadius: 22, paddingHorizontal: 18 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14, gap: 12 },
  rowLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  rowValue: { fontSize: 14, fontFamily: "Inter_600SemiBold", flexShrink: 1, textAlign: "right" },

  reviewLine: { flexDirection: "row", alignItems: "center", gap: 14 },
  reviewFig: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  reviewDivider: { height: StyleSheet.hairlineWidth, justifyContent: "center", marginLeft: 54 },
  reviewArrow: { position: "absolute", left: -41, width: 28, height: 28, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },

  pairHero: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18, marginTop: 28, marginBottom: 20 },
  watchTitle: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.8, textAlign: "center" },
  watchSub: { fontSize: 14, fontFamily: "Inter_500Medium", textAlign: "center", marginTop: 6, marginBottom: 28 },

  track: { flexDirection: "row", gap: 14 },
  trackRail: { alignItems: "center" },
  trackDot: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  trackLine: { width: 2, height: 26 },
  trackTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", paddingTop: 2 },

  doneBody: { paddingHorizontal: 16, alignItems: "center", paddingTop: 80 },
  doneDisc: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 22 },
  doneFigure: { fontSize: 34, fontFamily: "Inter_700Bold", letterSpacing: -1, textAlign: "center" },
  doneSub: { fontSize: 14, fontFamily: "Inter_500Medium", marginTop: 6, textAlign: "center" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 16 },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, marginTop: 10, marginBottom: 14 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold", letterSpacing: -0.3, marginBottom: 14 },
  pinDots: { flexDirection: "row", justifyContent: "center", gap: 16, marginTop: 6 },
  pinDot: { width: 14, height: 14, borderRadius: 7 },
  pinErr: { fontSize: 12.5, fontFamily: "Inter_500Medium", textAlign: "center", marginVertical: 12 },

  pickerSheet: { maxHeight: "85%" },
  search: { flexDirection: "row", alignItems: "center", gap: 10, height: 46, paddingHorizontal: 14, borderRadius: 14 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", padding: 0 },
  chips: { gap: 8, paddingVertical: 12 },
  filterChip: { height: 32, paddingHorizontal: 14, borderRadius: 16, justifyContent: "center" },
  filterText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  pickRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 14, minHeight: 58 },
  pickSym: { fontSize: 15, fontFamily: "Inter_700Bold" },
  pickBal: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
