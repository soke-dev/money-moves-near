import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Animated,
  Easing,
  ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { fmtNaira } from "@/constants/transfer";
import { FIAT_SETTLES, FIAT_FEE_RATE } from "@/constants/fiat";
import {
  initializeFunding,
  verifyFunding,
  type FundingInitResult,
} from "@/services/funding";
import NinPrompt from "@/components/NinPrompt";
import { getLocalAddresses } from "@/services/wallet-core";

/** How often we ask whether the money landed. */
const POLL_MS = 5000;

const clock = (secs: number) => {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

/**
 * Where the naira goes, and the wait for it to arrive.
 *
 * There is no "I have paid" button. The webhook is what credits the account, so
 * asking the user to assert a payment we can already see would only introduce a
 * claim we then have to ignore. The screen polls, and moves on by itself.
 */
export default function DepositNairaTransferScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const { walletAddresses, walletReady, refreshBalances, refreshTransactions, user } = useApp();

  const params = useLocalSearchParams<{ ngnAmount: string; receives: string; rate: string }>();
  const ngnAmount = Number(params.ngnAmount) || 0;
  const receives = Number(params.receives) || 0;
  const quotedRate = Number(params.rate) || 0;

  const [account, setAccount] = useState<FundingInitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Money that arrived and was not released, with the reason in the words the
  // server wrote to be read.
  const [held, setHeld] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  /** null while waiting; set once the transfer has been seen. */
  const [landed, setLanded] = useState<{
    pending: boolean;
    amount: number;
    txId: string;
    /** The server's own figure. It charges this; we do not re-derive it. */
    feeNaira: number | null;
    feePercent: number | null;
    at: Date;
  } | null>(null);

  // Drives the whole completion card in: rings, mark, then the figures.
  const cheer = useRef(new Animated.Value(0)).current;

  const verifying = useRef(false);
  // One account per visit. The effect below re-runs as the wallet loads, and a
  // second run would strand the first account number the user may already be
  // copying into their bank.
  const opened = useRef(false);
  // Tracks the screen, not the effect. A per-run flag was cancelling the
  // in-flight request whenever the effect's dependencies changed underneath
  // it, which left the account request in limbo and the card on its spinner.
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastDrop = useRef(new Animated.Value(-10)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Open the account ────────────────────────────────────
  /**
   * Waits for the wallet before deciding there isn't one.
   *
   * Addresses arrive from the context a moment after mount, so treating an
   * empty map as "no wallet" meant this screen reliably failed for anyone who
   * got here quickly. It only counts as missing once the wallet says it is
   * ready and the address still is not there.
   */
  /**
   * Set when the bank needs a NIN we do not hold.
   *
   * Its own state rather than an error, because it is not a failure - it is a
   * question with an answer the person is carrying. Treating it as an error
   * left somebody verified, correct, and staring at "Deposit not started".
   */
  const [needNin, setNeedNin] = useState<string | null>(null);
  /** Bumped to ask for an account again once the NIN is in. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (opened.current) return;
    const walletAddress = walletAddresses[FIAT_SETTLES.chain] || "";
    if (!walletAddress) {
      if (walletReady) {
        setError("We could not find your Movement wallet. Open the app again and retry.");
      }
      return;
    }

    opened.current = true;
    initializeFunding({
      amountNaira: ngnAmount,
      token: FIAT_SETTLES.token,
      chain: FIAT_SETTLES.chain,
      walletAddress,
      convertedAmount: receives,
    })
      .then((r) => {
        if (alive.current) setAccount(r);
      })
      .catch((err: any) => {
        if (!alive.current) return;
        // Let them try again rather than stranding them on a spinner.
        opened.current = false;

        // Answerable here, so it is asked here rather than shown as a failure.
        const data = err?.response?.data;
        if (data?.code === "NIN_REQUIRED" && data?.canDeclare) {
          setNeedNin(data.error || "Your bank needs your National Identity Number.");
          return;
        }

        setError(
          data?.error ||
            err?.message ||
            "We could not generate a payment account for this deposit. Please try again.",
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletReady, walletAddresses[FIAT_SETTLES.chain], attempt]);

  /** Saved - ask for the account again, now that the bank can be given one. */
  const ninSaved = () => {
    setNeedNin(null);
    opened.current = false;
    setAttempt((a) => a + 1);
  };

  // ─── Watch for the money ─────────────────────────────────
  /**
   * "Not yet" is the expected answer here, so nothing about a pending result is
   * surfaced. Only two things end the wait: it landed, or the account lapsed.
   */
  const poll = async (reference: string) => {
    if (verifying.current || landed || held) return;
    verifying.current = true;
    try {
      const localAddrs = await getLocalAddresses().catch(() => null);
      const result = await verifyFunding(reference, localAddrs?.[FIAT_SETTLES.chain] || undefined);

      if (result.status === "success" && result.transaction) {
        const pending = result.transaction.status !== "COMPLETED";
        // Decimal over the wire is a string. Number() or the render throws.
        const meta: any = (result.transaction as any).metadata ?? {};
        setLanded({
          pending,
          amount: Number(result.transaction.amount) || 0,
          txId: result.transaction.id,
          feeNaira: Number.isFinite(Number(meta.feeNaira)) ? Number(meta.feeNaira) : null,
          feePercent: Number.isFinite(Number(meta.feePercent)) ? Number(meta.feePercent) : null,
          at: new Date(),
        });
        await Promise.all([refreshBalances(true), refreshTransactions()]);
        Haptics.notificationAsync(
          pending
            ? Haptics.NotificationFeedbackType.Warning
            : Haptics.NotificationFeedbackType.Success,
        );
      } else if (result.status === "held") {
        setHeld(
          result.message ||
            "Your transfer came from an account we could not match to your verified ID.",
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } else if (result.status === "expired") {
        setError("This payment account has expired. Go back and start the deposit again.");
      }
    } catch {
      // A failed poll is a dropped request, not a failed payment. Try again on
      // the next tick rather than alarming someone mid-transfer.
    } finally {
      verifying.current = false;
    }
  };

  useEffect(() => {
    if (!account?.reference || landed) return;
    const id = setInterval(() => poll(account.reference), POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.reference, landed]);

  // ─── Countdown ───────────────────────────────────────────
  useEffect(() => {
    if (!account?.expiresAt || landed) return;
    const tick = () => {
      const ms = new Date(account.expiresAt).getTime() - Date.now();
      setSecondsLeft(Math.max(0, Math.floor(ms / 1000)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [account?.expiresAt, landed]);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  useEffect(() => {
    if (!landed) return;
    /**
     * One driver, read at three different points.
     *
     * A spring was right for a disc that popped; with the disc gone it made
     * the figures bounce, which money should not do. This eases out once and
     * the three blocks take staggered slices of it, so the screen assembles
     * top to bottom instead of appearing all at once.
     */
    Animated.timing(cheer, {
      toValue: 1,
      duration: 720,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [landed, cheer]);

  const copy = async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(label);
    Animated.parallel([
      Animated.timing(toastOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(toastDrop, { toValue: 0, damping: 15, stiffness: 220, mass: 0.7, useNativeDriver: true }),
    ]).start();
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(toastOpacity, { toValue: 0, duration: 260, useNativeDriver: true }),
        Animated.timing(toastDrop, { toValue: -10, duration: 260, useNativeDriver: true }),
      ]).start(() => setCopied(null));
    }, 1800);
  };

  /**
   * Back to where the deposit started, in one step.
   *
   * Leaving cancels nothing: the webhook credits the account whether or not
   * this screen is open, which is why there is no confirmation on the way out.
   */
  const leave = () => {
    if (router.canDismiss()) router.dismissAll();
    else router.replace("/(tabs)" as any);
  };

  const header = (
    <View style={s.header}>
      <TouchableOpacity onPress={() => router.back()} style={s.back} hitSlop={12}>
        <Feather name="arrow-left" size={24} color={colors.foreground} />
      </TouchableOpacity>
      <Text style={[s.title, { color: colors.foreground }]}>Make transfer</Text>
    </View>
  );

  // ─── Landed ──────────────────────────────────────────────
  if (landed) {
    const done = !landed.pending;
    /**
     * One driver, three arrivals.
     *
     * The mark overshoots slightly, the halo opens behind it, and the figures
     * settle last - so the screen reads as a result landing rather than a card
     * that was already there when you looked up.
     */
    /** A slice of the entrance: faded up and lifted into place. */
    const rise = (from: number, to: number) => ({
      opacity: cheer.interpolate({
        inputRange: [from, to],
        outputRange: [0, 1],
        extrapolate: "clamp" as const,
      }),
      transform: [
        {
          translateY: cheer.interpolate({
            inputRange: [from, to],
            outputRange: [14, 0],
            extrapolate: "clamp" as const,
          }),
        },
      ],
    });

    // The server's own figure where it sent one. It charges 1% and takes it off
    // the naira before buying, so nothing here re-derives it.
    const feeNaira = landed.feeNaira;
    const feePct = landed.feePercent ?? 1;
    const when = landed.at.toLocaleString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });

    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <ScrollView
          contentContainerStyle={[s.doneScroll, { paddingBottom: bottomPad + 20 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ width: "100%" }}>
            {/*
              No tick.

              A disc with a check in it spent the top third of this screen
              confirming the tap - which the person made, and watched spin. The
              word and the figure are the confirmation, and the figure is what
              they came back to the phone for.
            */}
            <Animated.Text style={[s.fundWord, { color: colors.foreground }, rise(0, 0.45)]}>
              {done ? "Funded." : "Almost there."}
            </Animated.Text>

            {/*
              Funding is a trade, so both ends are on the screen and joined by
              a rail: naira left, crypto arrived. Only what arrived carries the
              brand colour.
            */}
            <Animated.View style={[s.flow, rise(0.18, 0.72)]}>
              <View style={s.flowRail}>
                <View style={[s.flowDot, { backgroundColor: colors.mutedForeground }]} />
                <View style={[s.flowStem, { backgroundColor: colors.border }]} />
                <View style={[s.flowEnd, { backgroundColor: colors.primary }]} />
              </View>

              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.legLabel, { color: colors.mutedForeground }]}>YOU PAID</Text>
                <Text style={[s.paidFig, { color: colors.foreground }]}>{fmtNaira(ngnAmount)}</Text>

                <View style={{ height: 22 }} />

                <Text style={[s.legLabel, { color: colors.mutedForeground }]}>
                  {done ? "YOU GOT" : "ON ITS WAY"}
                </Text>
                <Text style={[s.gotFig, { color: colors.primary }]}>
                  {landed.amount.toFixed(4)}
                </Text>
                <Text style={[s.gotSub, { color: colors.foreground }]}>
                  {FIAT_SETTLES.token}{" "}
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                    on {FIAT_SETTLES.network}
                  </Text>
                </Text>
              </View>
            </Animated.View>

            {!done && (
              <Text style={[s.doneBody, { color: colors.mutedForeground }]}>
                Your transfer landed. The crypto is on its way to your wallet and will show in
                your balance shortly.
              </Text>
            )}

            <Animated.View style={[s.facts, { borderTopColor: colors.border }, rise(0.45, 1)]}>
              {[
                ["Rate", quotedRate > 0 ? `$1 ≈ ₦${Math.round(quotedRate).toLocaleString()}` : "—"],
                ["Fee", feeNaira !== null ? `${fmtNaira(feeNaira)} · ${feePct}%` : `${feePct}%`],
                ["Date", when],
              ].map(([label, value], i, arr) => (
                <View
                  key={label}
                  style={[
                    s.factRow,
                    i < arr.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.card,
                    },
                  ]}
                >
                  <Text style={[s.factLabel, { color: colors.mutedForeground }]}>{label}</Text>
                  <Text style={[s.factValue, { color: colors.foreground }]}>{value}</Text>
                </View>
              ))}
            </Animated.View>
          </View>
        </ScrollView>

        <View style={[s.doneBar, { paddingBottom: bottomPad + 14 }]}>
          <TouchableOpacity
            style={[s.ghostBtn, { borderColor: colors.border }]}
            onPress={() =>
              router.replace({ pathname: "/transactions/receipt", params: { id: landed.txId, done: "1" } } as any)
            }
            activeOpacity={0.8}
          >
            <Feather name="file-text" size={17} color={colors.foreground} />
            <Text style={[s.ghostBtnText, { color: colors.foreground }]}>View receipt</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.cta, { flex: 1, backgroundColor: colors.primary }]}
            onPress={leave}
            activeOpacity={0.85}
          >
            <Text style={[s.ctaText, { color: colors.primaryForeground }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  /**
   * Held for review.
   *
   * Its own ending, and not an error: the money arrived, we have it, and a
   * person is going to look at it. Amber rather than red, and it says what
   * happens next rather than only what went wrong - somebody whose transfer is
   * sitting with us wants to know who is doing what, and by when.
   *
   * Without this the screen went on saying "waiting for your transfer" for as
   * long as it was left open, while the money had already arrived and stopped.
   */
  if (held) {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        {header}
        <View style={s.centre}>
          <View style={[s.doneCard, { backgroundColor: colors.card }]}>
            <View style={[s.ring, { borderColor: colors.warning + "33" }]}>
              <View style={[s.disc, { backgroundColor: colors.warning }]}>
                <Feather name="clock" size={24} color="#fff" />
              </View>
            </View>
            <Text style={[s.errorTitle, { color: colors.foreground }]}>Held for review</Text>
            <Text style={[s.doneBody, { color: colors.mutedForeground }]}>{held}</Text>
            <Text style={[s.doneBody, { color: colors.mutedForeground, marginTop: 10 }]}>
              We have your money and nothing is lost. Someone reviews it within 24 hours and
              you will get a notification either way. Message support if it is urgent.
            </Text>
          </View>
        </View>
        <View style={[s.bottomBar, { paddingBottom: bottomPad + 14 }]}>
          <TouchableOpacity
            style={[s.cta, { backgroundColor: colors.primary }]}
            onPress={() => router.replace("/(tabs)" as any)}
            activeOpacity={0.85}
          >
            <Text style={[s.ctaText, { color: colors.primaryForeground }]}>Done</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.ghostBtn}
            onPress={() => router.push("/account/support" as any)}
            activeOpacity={0.7}
          >
            <Text style={[s.ghostBtnText, { color: colors.mutedForeground }]}>Message support</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  /*
   * Asked over whatever is on screen, rather than as its own page: the deposit
   * has not failed and there is nothing to go back to. Answer it and the
   * account opens; decline and they are where they were.
   */
  const ninAsk = (
    <NinPrompt
      visible={!!needNin}
      message={needNin}
      onCancel={() => { setNeedNin(null); router.back(); }}
      onSaved={ninSaved}
    />
  );

  // ─── Could not generate a payment account ────────────────
  if (error) {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        {header}
        <View style={s.centre}>
          <View style={[s.doneCard, { backgroundColor: colors.card }]}>
            <View style={[s.ring, { borderColor: "#ef444433" }]}>
              <View style={[s.disc, { backgroundColor: "#ef4444" }]}>
                <Feather name="alert-triangle" size={24} color="#fff" />
              </View>
            </View>
            <Text style={[s.errorTitle, { color: colors.foreground }]}>Deposit not started</Text>
            <Text style={[s.doneBody, { color: colors.mutedForeground }]}>{error}</Text>
          </View>
        </View>
        <View style={[s.bottomBar, { paddingBottom: bottomPad + 14 }]}>
          <TouchableOpacity
            style={[s.cta, { backgroundColor: colors.primary }]}
            onPress={() => router.back()}
            activeOpacity={0.85}
          >
            <Text style={[s.ctaText, { color: colors.primaryForeground }]}>Go back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── Waiting on the transfer ─────────────────────────────
  const payable = account?.amountNaira ?? ngnAmount;
  // The name the deposit will actually be measured against - the one from the
  // verified ID, which is what the account now carries.
  const verifiedName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null;

  const rows = account
    ? [
        { label: "Account name", value: account.accountName || "Money Moves" },
        { label: "Account number", value: account.accountNumber },
        { label: "Bank name", value: account.bankName },
      ]
    : [];

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {header}
      {ninAsk}

      {/* Floats over the header so copying never nudges the page. */}
      {copied && (
        <Animated.View
          pointerEvents="none"
          style={[
            s.toast,
            {
              top: topPad + 8,
              backgroundColor: colors.primary,
              opacity: toastOpacity,
              transform: [{ translateY: toastDrop }],
            },
          ]}
        >
          <Feather name="copy" size={15} color={colors.primaryForeground} />
          <Text style={[s.toastText, { color: colors.primaryForeground }]}>{copied} copied</Text>
        </Animated.View>
      )}

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: bottomPad + 110 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[s.lede, { color: colors.mutedForeground }]}>
          Transfer{" "}
          <Text style={[s.ledeAmount, { color: colors.foreground }]}>{fmtNaira(payable)}</Text> to
          the account below to complete this deposit.
        </Text>

        {/* Above the account number, not in the notes underneath it.
            This one costs money to get wrong - a transfer from someone else's
            account is held and may be sent back rather than completed - and a
            warning read after the transfer has gone is not a warning. */}
        <View style={[s.notice, { backgroundColor: colors.warning + "14", borderColor: colors.warning + "40" }]}>
          <Feather name="alert-triangle" size={16} color={colors.warning} style={s.noticeMark} />
          <View style={{ flex: 1 }}>
            <Text style={[s.noticeTitle, { color: colors.foreground }]}>
              Send from your own account
            </Text>
            <Text style={[s.noticeBody, { color: colors.mutedForeground }]}>
              {verifiedName
                ? `It must be in your name, ${verifiedName}. Anything else is held for review.`
                : "It must be in your own name. Anything else is held for review."}
            </Text>
          </View>
        </View>

        <View style={[s.card, { backgroundColor: colors.card }]}>
          <Text style={[s.cardTitle, { color: colors.foreground }]}>Bank details</Text>

          {!account ? (
            <View style={s.loading}>
              <ActivityIndicator color={colors.mutedForeground} />
              <Text style={[s.loadingText, { color: colors.mutedForeground }]}>
                Generating a payment account...
              </Text>
            </View>
          ) : (
            rows.map((r) => (
              <View key={r.label} style={s.detail}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.detailLabel, { color: colors.mutedForeground }]}>{r.label}</Text>
                  <Text style={[s.detailValue, { color: colors.foreground }]} selectable>
                    {r.value}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => copy(r.label, r.value)}
                  style={[s.copyChip, { backgroundColor: colors.primary + "18" }]}
                  hitSlop={8}
                >
                  <Feather name="copy" size={16} color={colors.primary} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {/* What the transfer actually buys.
            The bank details say what to send. Until now nothing said what comes
            back, so the first place anyone learned the fee was by counting what
            arrived. Each line is a step of the sum the server performs, in its
            order, so the last figure can be checked rather than trusted. */}
        <View style={[s.card, { backgroundColor: colors.card }]}>
          <Text style={[s.cardTitle, { color: colors.foreground }]}>What you get</Text>

          {[
            ["You send", fmtNaira(payable)],
            [`Fee (${Math.round(FIAT_FEE_RATE * 100)}%)`, `− ${fmtNaira(Math.round(ngnAmount * FIAT_FEE_RATE))}`],
            [
              "Converted at",
              quotedRate > 0
                ? `$1 ≈ ₦${Math.round(quotedRate * (1 - FIAT_FEE_RATE)).toLocaleString()}`
                : "—",
            ],
          ].map(([k, v]) => (
            <View key={k} style={s.sumLine}>
              <Text style={[s.sumLabel, { color: colors.mutedForeground }]}>{k}</Text>
              <Text style={[s.sumValue, { color: colors.mutedForeground }]}>{v}</Text>
            </View>
          ))}

          <View style={[s.sumRule, { backgroundColor: colors.border }]} />

          <View style={s.sumLine}>
            <Text style={[s.sumLabel, { color: colors.foreground }]}>You receive</Text>
            <Text style={[s.sumTotal, { color: colors.foreground }]}>
              ≈ {receives.toFixed(2)} {FIAT_SETTLES.token}
            </Text>
          </View>

          <Text style={[s.bulletText, { color: colors.mutedForeground, marginTop: 10 }]}>
            The rate is taken when your transfer lands, so the final amount can move a little
            either way.
          </Text>
        </View>

        <View style={[s.card, { backgroundColor: colors.card }]}>
          <Text style={[s.cardTitle, { color: colors.foreground }]}>Bank info</Text>
          {[
            "This payment account is generated for this deposit only, and closes when the time is up.",
            `Send exactly ${fmtNaira(payable)}. A short transfer is not credited automatically and has to be released by support.`,
            "Your balance updates on its own once the transfer lands. There is nothing else to do.",
          ].map((line) => (
            <View key={line} style={s.bulletRow}>
              <View style={[s.bullet, { backgroundColor: colors.mutedForeground }]} />
              <Text style={[s.bulletText, { color: colors.mutedForeground }]}>{line}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* The status line replaces the button that used to ask the user to
          confirm their own payment. It reports; it does not request. */}
      <View style={[s.bottomBar, { paddingBottom: bottomPad + 14, backgroundColor: colors.background }]}>
        {!!account && (
          <View style={s.status}>
            <ActivityIndicator size="small" color={colors.mutedForeground} />
            <Text style={[s.statusText, { color: colors.mutedForeground }]}>
              {secondsLeft > 0
                ? `Waiting for your transfer. This payment account expires in ${clock(secondsLeft)}.`
                : "Waiting for your transfer."}
            </Text>
          </View>
        )}
        <TouchableOpacity
          style={[s.cta, { backgroundColor: colors.muted }]}
          onPress={leave}
          activeOpacity={0.85}
        >
          <Text style={[s.ctaText, { color: colors.foreground }]}>Close</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 12, marginBottom: 6 },
  back: { position: "absolute", left: 20 },
  title: { fontSize: 17, lineHeight: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },

  toast: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 999,
    zIndex: 20,
  },
  toastText: { fontSize: 13, lineHeight: 17, fontFamily: "Inter_600SemiBold" },

  content: { paddingHorizontal: 20 },
  lede: { fontSize: 14, lineHeight: 21, fontFamily: "Inter_400Regular", marginBottom: 16 },
  ledeAmount: { fontFamily: "Inter_700Bold" },

  card: { borderRadius: 20, padding: 18, marginBottom: 14 },
  notice: {
    flexDirection: "row",
    gap: 11,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 14,
  },
  noticeMark: { marginTop: 1 },
  noticeTitle: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_700Bold" },
  noticeBody: { fontSize: 12.5, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 3 },

  // The sum, one step per line, with the answer set apart by a rule.
  sumLine: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingVertical: 7 },
  sumLabel: { fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_400Regular" },
  sumValue: { fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_500Medium" },
  sumTotal: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_700Bold" },
  sumRule: { height: StyleSheet.hairlineWidth, marginVertical: 6 },
  cardTitle: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_700Bold", letterSpacing: -0.25, marginBottom: 14 },

  loading: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14 },
  loadingText: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_400Regular" },

  detail: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  detailLabel: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular", marginBottom: 3 },
  // Big enough to read back to a banking app without zooming.
  detailValue: { fontSize: 17, lineHeight: 23, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  copyChip: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },

  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginBottom: 9 },
  bullet: { width: 3.5, height: 3.5, borderRadius: 2, marginTop: 8 },
  bulletText: { flex: 1, fontSize: 12.5, lineHeight: 18, fontFamily: "Inter_400Regular" },

  centre: { flex: 1, justifyContent: "center", paddingHorizontal: 20 },

  // ── Completion ────────────────────────────────────────────
  // Left-aligned and top-weighted: a column of figures centred in the middle of
  // a tall screen reads as a dialog, not as a statement of what happened.
  doneScroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 22, paddingTop: 20 },
  fundWord: { fontSize: 52, lineHeight: 57, fontFamily: "Inter_800ExtraBold", letterSpacing: -2.4 },

  flow: { flexDirection: "row", gap: 14, marginTop: 38 },
  flowRail: { alignItems: "center", paddingTop: 7 },
  flowDot: { width: 7, height: 7, borderRadius: 4 },
  flowStem: { width: 1, flex: 1, minHeight: 46 },
  flowEnd: { width: 9, height: 9, borderRadius: 5 },
  legLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 1.4 },
  paidFig: { fontSize: 22, lineHeight: 28, fontFamily: "Inter_600SemiBold", letterSpacing: -0.6, marginTop: 3 },
  gotFig: { fontSize: 38, lineHeight: 44, fontFamily: "Inter_800ExtraBold", letterSpacing: -1.6, marginTop: 3 },
  gotSub: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_500Medium", marginTop: 2 },

  facts: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 34 },
  factRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13 },
  factLabel: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  factValue: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  // Side by side, equal halves. Stacked, the outlined button sat directly on
  // the filled one and read as a single two-storey control.
  doneBar: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 12 },
  ghostBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    height: 56,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  ghostBtnText: { fontSize: 14.5, lineHeight: 19, fontFamily: "Inter_700Bold" },
  doneCard: { borderRadius: 24, padding: 24, alignItems: "center" },
  // Two rings: a translucent halo around a solid disc, so the mark reads as a
  // status rather than another button.
  ring: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 5,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  disc: { width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center" },
  errorTitle: { fontSize: 19, lineHeight: 25, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.4, textAlign: "center", marginBottom: 10 },
  doneBody: { fontSize: 13.5, lineHeight: 20, fontFamily: "Inter_400Regular", marginTop: 20 },


  bottomBar: { paddingHorizontal: 20, paddingTop: 12 },
  status: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 12 },
  statusText: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular" },
  cta: { height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },
});
