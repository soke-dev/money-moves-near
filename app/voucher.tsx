import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  ActivityIndicator,
  Linking,
  Image,
  Animated,
  Easing,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { AccountScanner } from "@/components/AccountScanner";
import { Confetti } from "@/components/Confetti";
import {
  claimVoucher,
  getMyVouchers,
  isVoucherCode,
  voucherCodeFrom,
  type VoucherRule,
  type PastClaim,
} from "@/services/voucher";

/**
 * Claim a voucher.
 *
 * Three states in one screen rather than three screens: typing, claimed, and
 * refused. A claim is one round trip, and pushing a route for its answer means
 * a back button that returns you to a code you have already spent.
 *
 * The thing being claimed is a voucher, so the screen is a voucher: a ticket
 * torn across, the code on the stub. A labelled text field on a plain
 * background is the same shape as changing your email address, and nothing
 * about being handed a voucher feels like that.
 *
 * The refusal is the screen that decides whether this feature generates
 * support tickets. "You are not eligible" is the version that does - so when
 * the server says which rule failed, that is what gets drawn, along with the
 * ones already met and a button that goes and fixes it.
 */

/** What a scanned code looks like in the field. Never the code itself. */
/** 1st, 2nd, 3rd — 11th to 13th are the ones a naive version gets wrong. */
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

const MASK = "•".repeat(9);

/**
 * The face a refusal wears.
 *
 * Every one of these is a different thing to have happened, and one red line
 * said all of them in the same voice - which left the commonest of them,
 * "you already had this one", reading as though something had broken. Matched
 * on the server's words rather than a code because the server sends prose; the
 * fallback below is what catches anything new, so a message we have not seen
 * still gets a screen rather than nothing.
 */
/**
 * What KIND of thing a requirement wants.
 *
 * One alert-circle against every unmet rule made a list of four look like four
 * of the same problem. An unmet rule is the one somebody has to act on, so it
 * is the one that gets the specific icon; a met rule only has to read as done.
 */
function ruleIcon(label: string): keyof typeof Feather.glyphMap {
  if (/identity/i.test(label)) return "user-check";
  if (/transaction/i.test(label)) return "repeat";
  if (/older than|joined before/i.test(label)) return "calendar";
  return "alert-circle";
}

const DENIALS: {
  match: RegExp;
  icon: keyof typeof Feather.glyphMap;
  word: string;
  tone: "kept" | "gone" | "soon";
}[] = [
  // Every icon here is shown INSIDE a disc, so none of them may carry a circle
  // of its own - check-circle in a ring was two rings and read as neither.
  { match: /already claimed|as many times/i, icon: "check", word: "Already yours", tone: "kept" },
  { match: /all gone/i, icon: "inbox", word: "All gone", tone: "gone" },
  { match: /closed and is no longer/i, icon: "clock", word: "Voucher expired", tone: "gone" },
  { match: /not started/i, icon: "sunrise", word: "Not open yet", tone: "soon" },
  { match: /invalid voucher code/i, icon: "search", word: "Invalid code", tone: "gone" },

  /**
   * The reward left, we just have not seen it land.
   *
   * Without this it fell to the generic red triangle and "Not this time" -
   * telling somebody whose USDC is already on its way that nothing happened.
   * The claim is spent either way, so a refusal that reads as a failure here
   * is the one that costs us a support message and them their confidence.
   */
  { match: /sent, but we could not confirm/i, icon: "send", word: "On its way", tone: "soon" },

  // Ours to fix and worth retrying, so amber rather than a dead end.
  { match: /could not send that reward|could not claim that/i, icon: "refresh-cw", word: "Try that again", tone: "soon" },
  { match: /wallet is not ready/i, icon: "loader", word: "Almost there", tone: "soon" },
  { match: /is paused/i, icon: "pause", word: "Paused for now", tone: "soon" },
  { match: /not available right now/i, icon: "pause", word: "Not right now", tone: "soon" },
];
export default function VoucherScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, refreshBalances, refreshTransactions } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  /** A code handed over by the shared scanner, already read. */
  const params = useLocalSearchParams<{ code?: string; scanned?: string }>();

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [past, setPast] = useState<PastClaim[]>([]);

  /**
   * The real code behind the mask.
   *
   * The field shows dots so the screen looks filled and the Claim button comes
   * alive, while the code itself never appears anywhere it could be read and
   * passed on. Cleared the moment somebody types, because then the field is
   * the truth again.
   */
  const scanned = useRef<string | null>(null);

  const [won, setWon] = useState<{
    amount: number;
    code: string | null;
    txHash: string;
    /** Set only by a lucky voucher, where the amount alone says nothing. */
    luck?: { rank: number; of: number; best: boolean; top: number } | null;
  } | null>(null);
  const [viaScan, setViaScan] = useState(false);
  const [refused, setRefused] = useState<{ reason: string; rules: VoucherRule[] | null } | null>(null);

  /** One driver for the entrance; the blocks read it at staggered points. */
  const enter = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  /** Runs only while a claim is in flight. */
  const wait = useRef(new Animated.Value(0)).current;
  /** The refusal's entrance: one timing for the stagger, one spring for the mark. */
  const deny = useRef(new Animated.Value(0)).current;
  const denyPop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 620,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  /**
   * A bar that sweeps while the claim is out.
   *
   * Looping rather than filling: this waits on a chain, and a progress bar
   * that creeps towards an end it cannot predict is a lie told slowly. A
   * sweep says working, which is all anybody knows.
   */
  useEffect(() => {
    if (!busy) { wait.setValue(0); return; }
    const loop = Animated.loop(
      Animated.timing(wait, {
        toValue: 1,
        duration: 1150,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [busy, wait]);

  /**
   * A refusal arrives rather than appearing.
   *
   * The mark springs in first and the words follow it, so the eye lands on
   * what happened before it starts reading why. Both run on the native driver
   * - scale and opacity only - so the entrance is not competing with the
   * balance refresh that follows a claim either way.
   */
  useEffect(() => {
    if (!refused) return;
    deny.setValue(0);
    denyPop.setValue(0);
    Animated.parallel([
      Animated.timing(deny, {
        toValue: 1,
        duration: 620,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(denyPop, {
        toValue: 1,
        damping: 10,
        stiffness: 170,
        mass: 0.7,
        useNativeDriver: true,
      }),
    ]).start();
  }, [refused, deny, denyPop]);

  /**
   * A lucky amount is counted up to, not printed.
   *
   * On a fixed voucher the number was known before the screen opened and
   * animating it would be theatre. On a lucky one it is the answer to the
   * question the whole thing was about, and arriving at it over half a second
   * is the difference between a result and a reveal.
   *
   * Driven on the JS thread because it is text rather than a transform - the
   * one place in this file worth that, and short enough not to fight the
   * balance refresh that follows.
   */
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!won) return;
    if (!won.luck) { setShown(won.amount); return; }
    setShown(0);
    const target = won.amount;
    const started = Date.now();
    const DUR = 900;
    const id = setInterval(() => {
      const t = Math.min((Date.now() - started) / DUR, 1);
      // Fast then settling, so it lands rather than stops.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Number((target * eased).toFixed(2)));
      if (t >= 1) clearInterval(id);
    }, 40);
    return () => clearInterval(id);
  }, [won]);

  // The figure lands after the confetti is already in the air.
  useEffect(() => {
    if (!won) return;
    pop.setValue(0);
    Animated.spring(pop, {
      toValue: 1,
      damping: 11,
      stiffness: 160,
      mass: 0.7,
      delay: 90,
      useNativeDriver: true,
    }).start();
  }, [won, pop]);

  useFocusEffect(
    useCallback(() => {
      getMyVouchers().then(setPast).catch(() => {});
    }, []),
  );

  /**
   * Claimed on arrival when Scan & pay sent us here.
   *
   * That camera already read the code, so showing this screen's own form and
   * waiting to be told again would be asking somebody to confirm a gift. The
   * ref guards it because a re-render must not spend the same code twice.
   */
  const handedOver = useRef(false);
  useEffect(() => {
    const given = String(params.code ?? "").trim().toUpperCase();
    if (!given || handedOver.current) return;
    handedOver.current = true;
    scanned.current = given;
    setViaScan(params.scanned === "1");
    setCode(MASK);
    claim(given);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.code]);

  const rise = (from: number, to: number) => ({
    opacity: enter.interpolate({
      inputRange: [from, to],
      outputRange: [0, 1],
      extrapolate: "clamp" as const,
    }),
    transform: [
      {
        translateY: enter.interpolate({
          inputRange: [from, to],
          outputRange: [16, 0],
          extrapolate: "clamp" as const,
        }),
      },
    ],
  });

  const claim = async (raw?: string) => {
    const value = (raw ?? scanned.current ?? code).trim();
    if (!value || busy) return;
    if (raw === undefined && !scanned.current) setViaScan(false);
    setBusy(true);
    setRefused(null);
    Haptics.selectionAsync().catch(() => {});

    const result = await claimVoucher(value, raw !== undefined || !!scanned.current);
    setBusy(false);

    if (result.claimed) {
      setWon({
        amount: result.amount,
        code: result.code,
        txHash: result.txHash,
        luck: result.luck ?? null,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      refreshBalances(true).catch(() => {});
      refreshTransactions().catch(() => {});
      getMyVouchers().then(setPast).catch(() => {});
      return;
    }
    setRefused({ reason: result.reason, rules: result.rules });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  };

  const reset = () => {
    setWon(null);
    setRefused(null);
    setCode("");
    setViaScan(false);
    scanned.current = null;
  };

  /**
   * Where Done goes, which depends on how they got here.
   *
   * Somebody who typed a code walked to this screen and may well have another,
   * so the form comes back empty for them. Somebody sent here by Scan & pay
   * never asked for that form - the scanner replaced itself to hand over - and
   * dropping them on it with a dimmed Claim button reads as though something
   * is still expected of them, after the one thing they came to do is done.
   *
   * handedOver is the flag because it survives reset(), which clears viaScan
   * and the code along with everything else the next claim would reuse.
   */
  const fromScan = handedOver.current;
  const finish = () => {
    if (fromScan) router.replace("/(tabs)");
    else reset();
  };

  const who = user?.username ? `@${user.username}` : user?.firstName || "there";

  /* ── On its way ────────────────────────────────────────────────── */
  /**
   * Shown the instant a claim starts, scanned or typed.
   *
   * A spinner on the button left somebody staring at the form they had just
   * finished with, for the several seconds a transfer takes - and after a scan
   * there is nothing on that screen to explain why the camera closed. Moving
   * here immediately makes the wait part of the reward rather than a pause
   * before it, and the layout is the one the result arrives into, so nothing
   * jumps when it does.
   */
  if (busy) {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <View style={s.hero}>
          <Text style={[s.congrats, { color: colors.mutedForeground }]}>
            Hold on,{" "}
            <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold" }}>{who}</Text>
          </Text>
          <Text style={[s.word, { color: colors.foreground }]}>Claiming…</Text>

          <View style={[s.track, { backgroundColor: colors.card }]}>
            <Animated.View
              style={[
                s.sweep,
                {
                  backgroundColor: colors.primary,
                  transform: [
                    {
                      translateX: wait.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-140, 340],
                      }),
                    },
                  ],
                },
              ]}
            />
          </View>

          <Text style={[s.figureNote, { color: colors.mutedForeground }]}>
            Checking the code, then sending it to your wallet.
          </Text>
        </View>
      </View>
    );
  }

  /* ── It landed ─────────────────────────────────────────────────── */
  if (won) {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <Confetti />

        <View style={s.hero}>
          <Text style={[s.congrats, { color: colors.mutedForeground }]}>
            Congrats,{" "}
            <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold" }}>{who}</Text>
          </Text>
          <Text style={[s.claimedWord, { color: colors.foreground }]}>Voucher claimed</Text>

          <Animated.View
            style={{
              alignSelf: "flex-start",
              opacity: pop,
              transform: [
                { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) },
              ],
            }}
          >
            <View style={s.figureRow}>
              <Text style={[s.figure, { color: colors.primary }]}>
                +{won.luck ? shown.toFixed(2) : won.amount}
              </Text>
              <Text style={[s.figureUnit, { color: colors.foreground }]}>USDC</Text>
            </View>
          </Animated.View>

          {/*
            What the number means, which the number cannot say by itself.
            A lucky voucher's whole appeal is where you landed, and 1.30 reads
            as nothing at all without knowing that the best so far was 1.40 -
            or that it was 4.10.
          */}
          {won.luck ? (
            <View style={s.luckRow}>
              {won.luck.best ? (
                <>
                  <Feather name="award" size={15} color={colors.primary} />
                  <Text style={[s.luckText, { color: colors.primary }]}>
                    Biggest claim so far
                    {won.luck.of > 1 ? ` — ahead of ${won.luck.of - 1}` : ""}
                  </Text>
                </>
              ) : (
                <>
                  <Feather name="bar-chart-2" size={15} color={colors.mutedForeground} />
                  <Text style={[s.luckText, { color: colors.mutedForeground }]}>
                    {ordinal(won.luck.rank)} of {won.luck.of} so far · biggest is {won.luck.top}
                  </Text>
                </>
              )}
            </View>
          ) : null}

          <Text style={[s.figureNote, { color: colors.mutedForeground }]}>
            {won.luck ? "Everybody gets a different amount" : "in your Money Moves wallet"}
          </Text>

          <View style={[s.facts, { borderTopColor: colors.border }]}>
            {/*
              How it was claimed, where the code was.
              A code scanned off a QR is not shown back even when the voucher
              is a public one: somebody who scans and then reads it off this
              screen can pass it on, which is the leak the QR existed to
              close. Typed, they already have it, so naming it is a receipt.
            */}
            <Fact
              colors={colors}
              k="Voucher"
              v={viaScan || !won.code ? "Claimed by QR" : won.code}
            />
            <Fact
              colors={colors}
              k="Sent in"
              v={`${won.txHash.slice(0, 6)}…${won.txHash.slice(-4)}`}
              onPress={() =>
                Linking.openURL(
                  `https://explorer.movementnetwork.xyz/txn/${won.txHash}`,
                ).catch(() => {})
              }
            />
          </View>
        </View>

        <View style={[s.dock, { paddingBottom: bottomPad + 10 }]}>
          <TouchableOpacity
            style={[s.cta, { backgroundColor: colors.foreground }]}
            onPress={finish}
            activeOpacity={0.85}
          >
            <Text style={[s.ctaText, { color: colors.background }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  /* ── Not yet ───────────────────────────────────────────────────── */
  /**
   * Which refusal this is, and what it wears.
   *
   * kept - they already have it. Not a failure, and it should not look like
   *        one: the same red used for a dead code told somebody who had just
   *        been paid that something had gone wrong.
   * soon - it opens later, so amber. There is something to come back for.
   * gone - nothing more to do here.
   */
  const hasRules = !!refused?.rules?.length;
  const look = hasRules
    ? { icon: "lock" as const, word: "Not yet", tone: "soon" as const }
    : (refused && DENIALS.find((d) => d.match.test(refused.reason))) ?? {
        icon: "alert-triangle" as const,
        word: "Not this time",
        tone: "gone" as const,
      };
  const shade =
    look.tone === "kept"
      ? colors.primary
      : look.tone === "soon"
        ? colors.warning
        : colors.destructive;

  /**
   * The ones still standing first.
   *
   * Source order put a met requirement at the top as often as not, so the
   * thing somebody has to DO was somewhere in the middle of a list that all
   * looked alike. What is left comes first; what is done settles underneath as
   * progress rather than as instructions.
   */
  const ordered = [...(refused?.rules ?? [])].sort((a, b) => Number(a.met) - Number(b.met));
  const metCount = ordered.filter((r) => r.met).length;

  /** Identity is the one requirement with somewhere to send them. */
  const needsKyc = !!refused?.rules?.some((r) => !r.met && r.label.startsWith("Identity"));

  /** The stagger: each block reads the same clock from its own starting point. */
  const denyRise = (from: number, to: number) => ({
    opacity: deny.interpolate({
      inputRange: [from, to],
      outputRange: [0, 1],
      extrapolate: "clamp" as const,
    }),
    transform: [
      {
        translateY: deny.interpolate({
          inputRange: [from, to],
          outputRange: [14, 0],
          extrapolate: "clamp" as const,
        }),
      },
    ],
  });

  /**
   * Every refusal, not only the ones carrying requirements.
   *
   * This used to be `refused?.rules?.length`, so a cap, an expiry or a bad
   * code fell through to the entry form and showed as one red line above a
   * Claim button that had nothing left to claim. The commonest refusal there
   * is looked like the app had failed.
   */
  if (refused) {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={finish} hitSlop={12}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[s.title, { color: colors.foreground }]}>Voucher</Text>
        </View>

        <View style={s.hero}>
          <Animated.View
            style={[
              s.mark,
              {
                /**
                 * Solid when they already hold it, tinted when they do not.
                 *
                 * "Already yours" is not a failure and a faint outline made it
                 * look like one; a filled disc in the same lime as the Claim
                 * button says the thing happened. A red disc at this size
                 * would be an alarm, and none of the others are one.
                 */
                backgroundColor: look.tone === "kept" ? shade : shade + "1F",
                opacity: denyPop.interpolate({ inputRange: [0, 0.4], outputRange: [0, 1], extrapolate: "clamp" }),
                transform: [
                  {
                    scale: denyPop.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.55, 1],
                      extrapolate: "clamp",
                    }),
                  },
                ],
              },
            ]}
          >
            <Feather
              name={look.icon}
              size={34}
              color={look.tone === "kept" ? colors.background : shade}
            />
          </Animated.View>

          <Animated.Text style={[s.word, { color: colors.foreground }, denyRise(0.1, 0.55)]}>
            {look.word}
          </Animated.Text>

          <Animated.Text style={[s.lede, { color: colors.mutedForeground }, denyRise(0.25, 0.75)]}>
            {hasRules ? (
              viaScan ? (
                "That voucher is real, and still open. You do not qualify for it yet."
              ) : (
                <>
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>
                    {code.toUpperCase()}
                  </Text>{" "}
                  is real, and still open. You do not qualify for it yet.
                </>
              )
            ) : (
              refused.reason
            )}
          </Animated.Text>

          {hasRules && (
            <Animated.View style={[s.rules, { borderColor: colors.border }, denyRise(0.35, 0.8)]}>
              {/*
                The tally, so the list reads as distance covered rather than as
                a wall. Somebody one requirement short and somebody who has met
                none of them were looking at the same screen.
              */}
              <View style={[s.rulesHead, { borderBottomColor: colors.border }]}>
                <Text style={[s.rulesCount, { color: colors.foreground }]}>
                  {metCount} of {ordered.length} met
                </Text>
                <View style={[s.meter, { backgroundColor: colors.border }]}>
                  <View
                    style={[
                      s.meterFill,
                      {
                        width: `${(metCount / Math.max(ordered.length, 1)) * 100}%`,
                        backgroundColor: colors.primary,
                      },
                    ]}
                  />
                </View>
              </View>

              {ordered.map((r, i) => (
                <Animated.View
                  key={r.label}
                  style={[
                    s.rule,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                    // Each row rides in behind the one above it.
                    denyRise(Math.min(0.5 + i * 0.07, 0.9), Math.min(0.9 + i * 0.07, 1)),
                  ]}
                >
                  {/* The same disc as the mark above it, at a twelfth the size. */}
                  <View
                    style={[
                      s.ruleDot,
                      { backgroundColor: (r.met ? colors.primary : colors.warning) + "1F" },
                    ]}
                  >
                    <Feather
                      name={r.met ? "check" : ruleIcon(r.label)}
                      size={14}
                      color={r.met ? colors.primary : colors.warning}
                    />
                  </View>

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={[
                        s.ruleLabel,
                        {
                          color: r.met ? colors.mutedForeground : colors.foreground,
                          fontFamily: r.met ? "Inter_400Regular" : "Inter_600SemiBold",
                        },
                      ]}
                    >
                      {r.label}
                    </Text>
                    {/* The note carries the instruction, so on an unmet rule it
                        is the line worth reading and wears the colour. */}
                    <Text
                      style={[
                        s.ruleNote,
                        { color: r.met ? colors.mutedForeground : colors.warning },
                      ]}
                    >
                      {r.note}
                    </Text>
                  </View>
                </Animated.View>
              ))}
            </Animated.View>
          )}
        </View>

        <View style={[s.dock, { paddingBottom: bottomPad + 10 }]}>
          {needsKyc && (
            <TouchableOpacity
              style={[s.cta, { backgroundColor: colors.foreground }]}
              onPress={() => router.push("/account/kyc")}
              activeOpacity={0.85}
            >
              <Text style={[s.ctaText, { color: colors.background }]}>Verify my identity</Text>
            </TouchableOpacity>
          )}
          {/*
            A refusal with no requirements has nothing else to offer, so its one
            way out is the button rather than a grey word floating over an inch
            of empty screen. Where "Verify my identity" is already the solid
            one, this drops back to a ghost beneath it.

            "Try another code" is an instruction to type one, which is the
            wrong thing to say to somebody who arrived holding a camera.
          */}
          {needsKyc ? (
            <TouchableOpacity style={s.ghost} onPress={finish} activeOpacity={0.7}>
              <Text style={[s.ghostText, { color: colors.mutedForeground }]}>
                {fromScan ? "Done" : "Try another code"}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[s.cta, { backgroundColor: colors.foreground }]}
              onPress={finish}
              activeOpacity={0.85}
            >
              <Text style={[s.ctaText, { color: colors.background }]}>
                {fromScan || !hasRules ? "Done" : "Try another code"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  /* ── The ticket ────────────────────────────────────────────────── */
  const ready = code.trim().length > 0;

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.foreground }]}>Voucher</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
        {/*
          A ticket, torn across.
          The stub carries what you do with it and the body carries the code.
          The tear is the whole reason this reads as a voucher rather than as
          a form with a text box on it.
        */}
        <Animated.View style={[s.ticketWrap, rise(0, 0.6)]}>
          <View style={[s.ticket, { backgroundColor: colors.card }]}>
            <View style={s.ticketTop}>
              <Image
                source={require("@/assets/images/gift-card.png")}
                style={[s.ticketMark, { tintColor: colors.primary }]}
                resizeMode="contain"
              />
              <Text style={[s.ticketEyebrow, { color: colors.mutedForeground }]}>VOUCHER</Text>
            </View>

            <Text style={[s.ticketHeading, { color: colors.foreground }]}>Got a code?</Text>
            <Text style={[s.ticketLede, { color: colors.mutedForeground }]}>
              Type it in or scan the QR. The reward lands in your wallet.
            </Text>

            <TextInput
              value={code}
              onChangeText={(t) => {
                // Typing replaces a scan: the field is the truth again.
                scanned.current = null;
                setViaScan(false);
                setCode(t.toUpperCase());
                if (refused) setRefused(null);
              }}
              placeholder="LAUNCH50"
              placeholderTextColor={colors.mutedForeground + "55"}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={() => claim()}
              style={[
                s.input,
                {
                  backgroundColor: colors.background,
                  borderColor: ready ? colors.primary : colors.border,
                  color: colors.foreground,
                },
              ]}
            />
          </View>

          {/* Paper missing, not a line added: notches in the page colour
              punched into both edges, with the perforation between them. */}
          <View style={s.tear}>
            <View style={[s.notch, s.notchLeft, { backgroundColor: colors.background }]} />
            <View style={[s.tearLine, { borderTopColor: colors.border }]} />
            <View style={[s.notch, s.notchRight, { backgroundColor: colors.background }]} />
          </View>

          <TouchableOpacity
            style={[s.stub, { backgroundColor: colors.card }]}
            onPress={() => setScanning(true)}
            activeOpacity={0.8}
          >
            <Feather name="maximize" size={17} color={colors.primary} />
            <Text style={[s.stubText, { color: colors.foreground }]}>Scan a QR code</Text>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </Animated.View>


        {/*
          The other half of a voucher: giving one.
          Under the claim card rather than beside it, because somebody arriving
          here is far more often holding a code than intending to send one -
          but a person who wants to send has nowhere else to look for it.
        */}
        <Animated.View style={rise(0.25, 0.9)}>
          <Text style={[s.eyebrow, { color: colors.mutedForeground }]}>OR GIVE ONE</Text>
          <View style={{ paddingHorizontal: 22, gap: 12 }}>
            <TouchableOpacity
              style={[s.giveRow, { backgroundColor: colors.card }]}
              onPress={() => router.push("/voucher-send")}
              activeOpacity={0.75}
            >
              {/* The same mark the claimed rows below use, so a voucher looks
                  like one thing on this screen rather than two. */}
              <View style={[s.giveIcon, { backgroundColor: colors.primary + "1F" }]}>
                <Image
                  source={require("@/assets/images/gift-card.png")}
                  style={[s.giveGlyph, { tintColor: colors.primary }]}
                />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.giveTitle, { color: colors.foreground }]}>Create a voucher</Text>
                <Text style={[s.giveNote, { color: colors.mutedForeground }]}>
                  Share USDC with up to 20 people
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.giveRow, { backgroundColor: colors.card }]}
              onPress={() => router.push("/vouchers-sent")}
              activeOpacity={0.75}
            >
              <View style={[s.giveIcon, { backgroundColor: colors.muted }]}>
                <Feather name="clock" size={19} color={colors.mutedForeground} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.giveTitle, { color: colors.foreground }]}>Your vouchers</Text>
                <Text style={[s.giveNote, { color: colors.mutedForeground }]}>
                  Who claimed, and what came back
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </Animated.View>

        {past.length > 0 && (
          <Animated.View style={rise(0.3, 1)}>
            <Text style={[s.eyebrow, { color: colors.mutedForeground }]}>CLAIMED BEFORE</Text>
            <View style={{ paddingHorizontal: 22 }}>
              {past.map((p, i) => (
                <View key={`${p.code}-${i}`} style={[s.pastRow, { borderBottomColor: colors.border }]}>
                  <View style={[s.pastMark, { backgroundColor: colors.primary + "1A" }]}>
                    <Image
                      source={require("@/assets/images/gift-card.png")}
                      style={[s.pastGlyph, { tintColor: colors.primary }]}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[s.pastCode, { color: colors.foreground }]} numberOfLines={1}>
                      {p.code ?? "Scanned voucher"}
                    </Text>
                    <Text style={[s.pastWhen, { color: colors.mutedForeground }]}>
                      {new Date(p.claimedAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </Text>
                  </View>
                  <Text style={[s.pastAmount, { color: colors.primary }]}>
                    +{p.amount}
                    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}> USDC</Text>
                  </Text>
                </View>
              ))}
            </View>
          </Animated.View>
        )}
      </ScrollView>

      <View style={[s.dock, { paddingBottom: bottomPad + 10 }]}>
        <TouchableOpacity
          style={[s.cta, { backgroundColor: colors.primary, opacity: !ready || busy ? 0.4 : 1 }]}
          onPress={() => claim()}
          disabled={!ready || busy}
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Text style={[s.ctaText, { color: colors.primaryForeground }]}>Claim reward</Text>
          )}
        </TouchableOpacity>
      </View>

      <AccountScanner
        visible={scanning}
        onClose={() => setScanning(false)}
        onPick={() => setScanning(false)}
        title="Scan a voucher"
        hint="Point at the QR on the voucher"
        onCode={(data) => {
          if (!isVoucherCode(data)) return;
          const text = voucherCodeFrom(data);
          setScanning(false);
          // Masked, not empty. An empty field after a good scan reads as a
          // scan that failed - and the code itself must not appear, or it can
          // be read off the screen and passed on.
          scanned.current = text;
          setViaScan(true);
          setCode(MASK);
          claim(text);
        }}
      />
    </View>
  );
}

function Fact({
  colors,
  k,
  v,
  onPress,
}: {
  colors: any;
  k: string;
  v: string;
  onPress?: () => void;
}) {
  const Wrap: any = onPress ? TouchableOpacity : View;
  return (
    <Wrap
      style={[s.fact, { borderBottomColor: colors.border }]}
      {...(onPress ? { onPress, activeOpacity: 0.7 } : {})}
    >
      <Text style={[s.factKey, { color: colors.mutedForeground }]}>{k}</Text>
      <Text style={[s.factValue, { color: onPress ? colors.primary : colors.foreground }]}>{v}</Text>
      {!!onPress && <Feather name="external-link" size={13} color={colors.primary} />}
    </Wrap>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 14 },
  title: { fontSize: 15.5, fontFamily: "Inter_600SemiBold" },

  ticketWrap: { marginHorizontal: 20, marginTop: 6 },
  ticket: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 22,
  },
  ticketTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  ticketMark: { width: 19, height: 19 },
  ticketEyebrow: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 1.6 },
  ticketHeading: {
    fontSize: 27,
    lineHeight: 33,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -1.1,
    marginTop: 16,
  },
  ticketLede: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 7 },
  input: {
    marginTop: 18,
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 19,
    letterSpacing: 2.5,
    fontFamily: "Inter_700Bold",
  },

  tear: { height: 22, justifyContent: "center" },
  tearLine: { marginHorizontal: 16, borderTopWidth: 1.5, borderStyle: "dashed" },
  notch: { position: "absolute", width: 22, height: 22, borderRadius: 11, top: 0 },
  notchLeft: { left: -11 },
  notchRight: { right: -11 },

  stub: {
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 20,
    paddingVertical: 17,
  },
  stubText: { flex: 1, fontSize: 14.5, fontFamily: "Inter_600SemiBold" },

  eyebrow: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.3,
    marginTop: 30,
    marginHorizontal: 22,
  },
  giveRow: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 18, padding: 16 },
  giveIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  giveGlyph: { width: 19, height: 19, resizeMode: "contain" },
  giveTitle: { fontSize: 14.5, fontFamily: "Inter_600SemiBold" },
  giveNote: { fontSize: 12.5, fontFamily: "Inter_400Regular", marginTop: 2 },

  pastRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pastMark: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  pastGlyph: { width: 16, height: 16, resizeMode: "contain" },
  pastCode: { fontSize: 13.5, fontFamily: "Inter_500Medium" },
  pastWhen: { fontSize: 11.5, fontFamily: "Inter_400Regular", marginTop: 2 },
  pastAmount: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },

  hero: { flex: 1, justifyContent: "center", paddingHorizontal: 22 },
  congrats: { fontSize: 17, lineHeight: 23, fontFamily: "Inter_400Regular" },
  claimedWord: {
    fontSize: 30,
    lineHeight: 36,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -1.2,
    marginTop: 6,
    marginBottom: 20,
  },
  // A window the sweep passes behind, clipped so it enters and leaves rather
  // than appearing at the edges.
  track: { height: 5, borderRadius: 3, overflow: "hidden", marginTop: 26, width: 200 },
  sweep: { width: 90, height: 5, borderRadius: 3 },
  word: { fontSize: 44, lineHeight: 49, fontFamily: "Inter_800ExtraBold", letterSpacing: -2 },
  // A ring rather than a filled disc: a solid block of red at this size reads
  // as an alarm, and most of these are not one.
  mark: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  lede: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular", marginTop: 12 },
  figureRow: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  figure: {
    fontSize: 52,
    lineHeight: 58,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -2.4,
    fontVariant: ["tabular-nums"],
  },
  figureUnit: { fontSize: 19, fontFamily: "Inter_500Medium" },
  figureNote: { fontSize: 13.5, fontFamily: "Inter_400Regular", marginTop: 8 },
  luckRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 12 },
  luckText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  facts: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 32 },
  fact: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  factKey: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  factValue: { fontSize: 13.5, fontFamily: "Inter_600SemiBold" },

  rules: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, marginTop: 30, overflow: "hidden" },
  rulesHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rulesCount: { fontSize: 12.5, fontFamily: "Inter_600SemiBold" },
  meter: { flex: 1, height: 4, borderRadius: 2, overflow: "hidden" },
  meterFill: { height: 4, borderRadius: 2 },
  rule: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 15 },
  ruleDot: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  ruleLabel: { fontSize: 13.5, fontFamily: "Inter_500Medium" },
  ruleNote: { fontSize: 11.5, lineHeight: 16, fontFamily: "Inter_400Regular", marginTop: 2 },

  dock: { paddingHorizontal: 20, paddingTop: 10 },
  cta: { height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 15.5, fontFamily: "Inter_600SemiBold" },
  ghost: { height: 50, alignItems: "center", justifyContent: "center", marginTop: 4 },
  ghostText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
