import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ScrollView,
  Platform,
  TextInput,
  BackHandler,
  ActivityIndicator,
  Animated,
  Easing,
  Image,
} from "react-native";
import { useRouter, useNavigation } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/context/ThemeContext";
import { useApp } from "@/context/AppContext";
import { StageTrack, STAGE_DONE, STAGE_PENDING, STAGE_FAILED } from "@/components/StageTrack";
import { signSolanaTransaction, signTonTransaction, signEvmTransaction } from "@/services/wallet-core";
import { assetLabel } from "@/constants/transfer";
import {
  getSweepQuote,
  prepareSweep,
  submitSweepLeg,
  type SweepQuote,
  type SweepBalance,
} from "@/services/sweep";

/**
 * Swap — scattered stablecoins into one USDC balance on Movement.
 *
 * Called sweep in the route, the service and the transaction type, because
 * those were named first. Only what somebody reads says swap.
 *
 * A sheet over the Assets list, not a page. It is one decision taken from that
 * list and handed straight back to it, and the blurred list underneath says so.
 *
 * The header is the state, not a label: an eyebrow, the figure being decided,
 * and a line saying where it goes. Ticking a row moves the figure, so there is
 * no separate total to keep in step with it and nothing to read twice.
 *
 * Two states in the same sheet: choosing, then watching. The watching half uses
 * the app's own track with the count in the middle stage, and cannot be left.
 */

const CHAIN_NAME: Record<string, string> = {
  SOL: "Solana",
  BASE: "Base",
  BEP20: "BNB Chain",
  ARC: "Arc",
  TON: "TON",
};

// Token over network, the way every wallet draws it - the token is what you
// own, the chain is only where it happens to be sitting.
const TOKEN_ART: Record<string, any> = {
  USDC: require("@/assets/images/usdc-logo.png"),
  USDT: require("@/assets/images/usdt.png"),
};
/**
 * The least worth moving off a chain, after its own fee.
 *
 * Mirrors minNetFor in backend/src/lib/sweep.ts. Arc and TON take their fee
 * out of the very asset being swept, so a couple of cents there nets to
 * nothing and a leg for it would arrive as zero. Said on this side too, so
 * the button goes quiet instead of the server refusing after a tap.
 */
const MIN_SWEEP: Record<string, number> = { ARC: 0.01, TON: 0.02 };
const minFor = (chain: string) => MIN_SWEEP[chain] ?? 0.001;

/**
 * Four places, and no trailing zeros.
 *
 * Balances arrive with eight, which on a stablecoin is six digits of noise
 * after the cent - unreadable in a box this size and meaningless at these
 * amounts. Floored rather than rounded, so the figure offered can never be
 * a hair above what the chain will actually let go.
 *
 * What is left behind is at most a hundredth of a cent. It stays on the
 * chain and falls under the dust floor, so it does not come back as a row
 * offering to swap nothing.
 */
const fmt4 = (n: number) => String(Math.floor(n * 1e4) / 1e4);

const CHAIN_ART: Record<string, any> = {
  SOL: require("@/assets/images/solana.png"),
  BASE: require("@/assets/images/base logo.png"),
  BEP20: require("@/assets/images/bsc logo.png"),
  ARC: require("@/assets/images/ARC.jpg"),
  TON: require("@/assets/images/toncoin.png"),
};

type LegState = {
  asset: string;
  chain: string;
  amount: number;
  status: "waiting" | "sending" | "landed" | "failed";
};

const key = (b: { asset: string; chain: string }) => `${b.asset}:${b.chain}`;

function Mark({ asset, chain, border }: { asset: string; chain: string; border: string }) {
  return (
    <View style={s.mark}>
      <Image source={TOKEN_ART[asset]} style={s.markToken} />
      <View style={[s.markBadge, { borderColor: border }]}>
        <Image source={CHAIN_ART[chain]} style={s.markChain} />
      </View>
    </View>
  );
}

/**
 * One chain, working.
 *
 * Four legs sitting still with a coloured dot each says almost nothing about
 * which one the phone is actually waiting on - and waiting is the whole of
 * this screen, sometimes for half a minute while a relay and an indexer
 * catch up. So the active leg is the one that moves:
 *
 *   waiting   still and dim, out of the way of the one that matters
 *   sending   a halo breathing behind the dot, and a hairline travelling
 *             the width of the row, which is the only part of the screen
 *             in motion
 *   landed    the halo stops, the dot turns, and the figure springs in
 *   failed    the same settle, in red, so a refusal reads as an answer
 *             rather than as nothing happening
 *
 * The travelling line is measured rather than a percentage, because a
 * percentage translateX is silently ignored on one of the two platforms.
 */
function LegRow({
  leg,
  first,
  colors,
  dot,
}: {
  leg: LegState;
  first: boolean;
  colors: any;
  dot: string;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  const travel = useRef(new Animated.Value(0)).current;
  const settle = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);

  const working = leg.status === "sending";
  const done = leg.status === "landed" || leg.status === "failed";

  useEffect(() => {
    if (!working) {
      pulse.setValue(0);
      travel.setValue(0);
      return;
    }
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1, duration: 850, easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0, duration: 850, easing: Easing.in(Easing.quad), useNativeDriver: true,
        }),
      ]),
    );
    const run = Animated.loop(
      Animated.timing(travel, {
        toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
      }),
    );
    breathe.start();
    run.start();
    return () => {
      breathe.stop();
      run.stop();
    };
  }, [working, pulse, travel]);

  useEffect(() => {
    if (!done) return;
    Animated.spring(settle, {
      toValue: 1, useNativeDriver: true, friction: 7, tension: 90,
    }).start();
  }, [done, settle]);

  const word =
    leg.status === "landed"
      ? `$${leg.amount.toFixed(2)} in`
      : leg.status === "failed"
      ? "did not go"
      : leg.status === "sending"
      ? "on its way"
      : "waiting";

  const barWidth = Math.max(48, width * 0.3);

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[
        s.legRow,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
        leg.status === "waiting" && { opacity: 0.5 },
      ]}
    >
      <Mark asset={leg.asset} chain={leg.chain} border={colors.card} />

      <Text style={[s.legName, { color: colors.foreground }]} numberOfLines={1}>
        {assetLabel(leg.asset)}
        <Text style={[s.legChain, { color: colors.mutedForeground }]}>
          {`  ${CHAIN_NAME[leg.chain] || leg.chain}`}
        </Text>
      </Text>

      <View style={s.legState}>
        <View style={s.dotWrap}>
          {working && (
            <Animated.View
              style={[
                s.halo,
                {
                  backgroundColor: dot,
                  opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.36, 0] }),
                  transform: [
                    { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.9] }) },
                  ],
                },
              ]}
            />
          )}
          <Animated.View
            style={[
              s.dot,
              {
                backgroundColor: dot,
                transform: done
                  ? [{ scale: settle.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }]
                  : [],
              },
            ]}
          />
        </View>
        <Animated.Text
          numberOfLines={1}
          style={[
            s.legWord,
            {
              color: leg.status === "landed" ? colors.foreground : colors.mutedForeground,
              opacity: done ? settle : 1,
              transform: done
                ? [{ translateX: settle.interpolate({ inputRange: [0, 1], outputRange: [7, 0] }) }]
                : [],
            },
          ]}
        >
          {word}
        </Animated.Text>
      </View>

      {/* Only under the leg being waited on, and only while it is waited on. */}
      {working && width > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            s.legBar,
            {
              width: barWidth,
              backgroundColor: colors.primary,
              transform: [
                {
                  translateX: travel.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-barWidth, width],
                  }),
                },
              ],
            },
          ]}
        />
      )}
    </View>
  );
}

export default function SweepSheet() {
  const colors = useColors();
  const { theme } = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { refreshBalances, refreshTransactions } = useApp();
  const bottomPad = Platform.OS === "web" ? 24 : Math.max(insets.bottom, 14);

  const [quote, setQuote] = useState<SweepQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /**
   * How much of each balance to move, as typed.
   *
   * Kept as the string the person entered rather than a number, so a
   * half-finished "1." or a cleared box stays on screen instead of snapping
   * back to zero under their cursor. Read through amountFor, which is the
   * only place it becomes a figure.
   */
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const [running, setRunning] = useState(false);
  const [legs, setLegs] = useState<LegState[]>([]);
  const [landedTotal, setLandedTotal] = useState(0);

  const doneCount = legs.filter((l) => l.status === "landed" || l.status === "failed").length;
  const allDone = legs.length > 0 && doneCount === legs.length;
  const anyLanded = legs.some((l) => l.status === "landed");

  /**
   * While it is moving, there is no way out.
   *
   * Half of a sweep is on a chain and half is not; leaving mid-flight would
   * stop the app submitting the legs it has already opened, and the person
   * would be left with tokens in treasury and nothing showing it. So the
   * backdrop stops dismissing, the gesture is disabled and the hardware back
   * button is swallowed until every leg has answered one way or the other.
   */
  const locked = running && !allDone;

  useEffect(() => {
    navigation.setOptions?.({ gestureEnabled: !locked });
  }, [navigation, locked]);

  useEffect(() => {
    if (!locked) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, [locked]);

  /**
   * The sheet animates itself.
   *
   * The navigator is told not to transition, so the blur can fade while the
   * card slides - one movement each, rather than both dragged up together as
   * a rectangle.
   */
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim]);

  const close = useCallback(() => {
    if (locked) return;
    Animated.timing(anim, {
      toValue: 0,
      duration: 190,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => router.back());
  }, [locked, anim, router]);

  useEffect(() => {
    getSweepQuote()
      .then((q) => {
        setQuote(q);
        // Everything ticked to begin with: the common case is "all of it", and
        // un-ticking one is less work than ticking three.
        setPicked(new Set(q.balances.map(key)));
        // All of everything, which is what a swap has always done. Anything
        // else is a change the person makes deliberately.
        setAmounts(Object.fromEntries(q.balances.map((b) => [key(b), fmt4(b.amount)])));
      })
      .catch(() => setError("Could not read your balances. Try again."))
      .finally(() => setLoading(false));
  }, []);

  /**
   * What a row will actually move.
   *
   * Clamped to the balance here as well as on the server, so the figure under
   * the button is the figure that gets sent. Below the chain's floor it reads
   * as nothing at all, which is what disables the button rather than letting
   * somebody sign a leg that arrives as zero.
   */
  const amountFor = useCallback(
    (b: SweepBalance) => {
      const raw = amounts[key(b)];
      if (raw === undefined) return b.amount;
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) return 0;
      return Math.min(n, b.amount);
    },
    [amounts],
  );

  /**
   * One step of the minus and plus.
   *
   * A whole token, because for a stablecoin that is a dollar and a dollar is
   * the unit anybody thinks in. On a balance too small for that to be useful
   * it drops to a tenth, so the buttons still do something on 0.40 rather
   * than jumping straight to nothing or to everything.
   */
  const stepFor = (balance: number) => (balance >= 2 ? 1 : 0.1);

  const nudge = useCallback(
    (b: SweepBalance, direction: 1 | -1) => {
      const k = key(b);
      const step = stepFor(b.amount);
      const from = Number(amounts[k] ?? b.amount);
      const base = Number.isFinite(from) ? from : 0;
      // Snapped to the step, so a typed 3.7 then plus gives 4 rather than
      // 4.7 - the buttons are for tidy figures, the box is for exact ones.
      const next =
        direction > 0
          ? Math.floor(base / step + 1e-9) * step + step
          : Math.ceil(base / step - 1e-9) * step - step;
      const clamped = Math.min(Math.max(0, next), b.amount);
      setAmounts((prev) => ({ ...prev, [k]: fmt4(clamped) }));
      setError("");
      Haptics.selectionAsync().catch(() => {});
    },
    [amounts],
  );

  const selected = useMemo(
    () => (quote?.balances ?? []).filter((b) => picked.has(key(b)) && amountFor(b) >= minFor(b.chain)),
    [quote, picked, amountFor],
  );
  const total = useMemo(
    () => selected.reduce((n, b) => n + amountFor(b), 0),
    [selected, amountFor],
  );
  // Anything at all will do. Twice a week is the only block there is.
  const enough = total > 0;
  const noneLeft = (quote?.left ?? 0) <= 0;

  const toggle = (b: SweepBalance) => {
    const k = key(b);
    const next = new Set(picked);
    if (next.has(k)) {
      next.delete(k);
    } else {
      next.add(k);
      // Coming back on after being edited down to nothing should offer the
      // whole balance again, not the nothing it was left at.
      if (!(Number(amounts[k]) > 0)) {
        setAmounts((prev) => ({ ...prev, [k]: fmt4(b.amount) }));
      }
    }
    setPicked(next);
    setError("");
    Haptics.selectionAsync().catch(() => {});
  };

  /**
   * Leg by leg, in sequence.
   *
   * Signing is invisible, so running them in parallel would only race the gas
   * sponsor for no gain anybody can see. One at a time also means the track
   * moves in steps somebody can follow.
   */
  const run = useCallback(async () => {
    if (!enough || running) return;
    setRunning(true);
    setError("");

    let prepared;
    try {
      prepared = await prepareSweep(
        selected.map((b) => ({ asset: b.asset, chain: b.chain, amount: amountFor(b) })),
      );
    } catch (e: any) {
      setRunning(false);
      setError(e?.response?.data?.error || "Could not start that sweep.");
      return;
    }

    setLegs(prepared.legs.map((l) => ({ ...l, status: "waiting" as const })));

    let landed = 0;
    for (const leg of prepared.legs) {
      setLegs((ls) => ls.map((l) => (l.chain === leg.chain ? { ...l, status: "sending" } : l)));

      try {
        let signature = "";
        let publicKey = "";
        let signedRaw: string | undefined;

        if (leg.chain === "SOL") {
          ({ signature, publicKey } = await signSolanaTransaction(leg.signingMessage));
        } else if (leg.chain === "TON") {
          // Ed25519, same key as Solana. The hash is of a cell rather than a
          // transaction message, which changes nothing on this side.
          ({ signature, publicKey } = await signTonTransaction(leg.signingMessage));
        } else {
          ({ signature, publicKey, signedRaw } = await signEvmTransaction(
            leg.signingMessage,
            leg.txRequest,
          ));
        }

        const r = await submitSweepLeg({
          sweepId: prepared.sweepId,
          chain: leg.chain,
          signature,
          publicKey,
          signedRaw,
        });

        const ok = r.status === "landed";
        if (ok) {
          landed += leg.amount;
          setLandedTotal(landed);
        }
        setLegs((ls) =>
          ls.map((l) => (l.chain === leg.chain ? { ...l, status: ok ? "landed" : "failed" } : l)),
        );
      } catch {
        setLegs((ls) => ls.map((l) => (l.chain === leg.chain ? { ...l, status: "failed" } : l)));
      }
    }

    Haptics.notificationAsync(
      landed > 0
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Error,
    ).catch(() => {});
    refreshBalances(true);
    refreshTransactions();
  }, [enough, running, selected, refreshBalances, refreshTransactions]);

  const stages = useMemo(() => {
    const out: any[] = [
      { label: "Initiated", kind: "sent" as const, color: colors.foreground + "B3" },
      {
        label: allDone
          ? `${doneCount} of ${legs.length}`
          : `Collecting ${doneCount} of ${legs.length}`,
        kind: "dot" as const,
        color: STAGE_PENDING,
      },
    ];
    if (allDone) {
      out.push(
        anyLanded
          ? { label: "Landed", kind: "badge" as const, color: STAGE_DONE }
          : { label: "Failed", kind: "failed" as const, color: STAGE_FAILED },
      );
    }
    return out;
  }, [allDone, anyLanded, doneCount, legs.length, colors.foreground]);

  // ── the header carries the state ──────────────────────────
  const head = running
    ? {
        eyebrow: allDone ? (anyLanded ? "SWEPT" : "NOTHING MOVED") : "SWEEPING",
        figure: `$${landedTotal.toFixed(2)}`,
        caption: allDone
          ? anyLanded
            ? `${landedTotal.toFixed(4)} USDC is in your Movement wallet`
            : "No chain would part with its balance"
          : `${doneCount} of ${legs.length} ${legs.length === 1 ? "chain has" : "chains have"} answered`,
      }
    : {
        eyebrow: "SWEEP",
        figure: `$${total.toFixed(2)}`,
        caption: "into one USDC balance on Movement",
      };

  /**
   * When the allowance returns, in as few words as it takes.
   *
   * Without this the footer reads "0 of 3 left this week" and stops, which is
   * the sentence that made a spent allowance look like a broken feature - the
   * tag had vanished from the home screen and nothing anywhere said it would
   * come back. Today and tomorrow are named rather than dated, because a date
   * two days out is something to work out and "tomorrow" is not.
   */
  const resetWord = (() => {
    if (!quote?.resetsAt) return null;
    const at = new Date(quote.resetsAt);
    if (Number.isNaN(at.getTime())) return null;

    const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((midnight(at) - midnight(new Date())) / 86_400_000);
    if (days <= 0) return "today";
    if (days === 1) return "tomorrow";
    return at.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  })();

  const dotFor = (st: LegState["status"]) =>
    st === "landed" ? STAGE_DONE : st === "failed" ? STAGE_FAILED : STAGE_PENDING;

  const body = () => {
    // ── WATCHING ──
    if (running) {
      return (
        <View>
          <View style={[s.trackBox, { backgroundColor: colors.background }]}>
            <StageTrack stages={stages} />
          </View>

          <View style={s.list}>
            {legs.map((l, i) => (
              <LegRow
                key={l.chain}
                leg={l}
                first={i === 0}
                colors={colors}
                dot={dotFor(l.status)}
              />
            ))}
          </View>

          {allDone ? (
            <TouchableOpacity
              style={[s.cta, { backgroundColor: colors.primary }]}
              onPress={close}
              activeOpacity={0.85}
            >
              <Text style={[s.ctaText, { color: colors.primaryForeground }]}>Done</Text>
            </TouchableOpacity>
          ) : (
            <View style={[s.holdOn, { borderColor: colors.border }]}>
              <Ionicons name="lock-closed-outline" size={13} color={colors.mutedForeground} />
              <Text style={[s.holdOnText, { color: colors.mutedForeground }]}>
                Keep this open until every chain has answered
              </Text>
            </View>
          )}
        </View>
      );
    }

    if (loading) {
      return (
        <View style={s.centre}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      );
    }

    if (!quote || quote.balances.length === 0) {
      return (
        <View style={s.centre}>
          <Text style={[s.emptyText, { color: colors.mutedForeground }]}>
            Nothing to sweep. Sweep gathers USDC or USDT balances of $5 or less on Arc, Solana, Base or BNB Chain. Use Swap for bigger ones.
          </Text>
        </View>
      );
    }

    // ── CHOOSING ──
    return (
      <View>
        <ScrollView style={{ maxHeight: 268 }} showsVerticalScrollIndicator={false} bounces={false}>
          <View style={s.list}>
            {quote.balances.map((b, i) => {
              const on = picked.has(key(b));
              return (
                <TouchableOpacity
                  key={key(b)}
                  style={[
                    s.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                    !on && { opacity: 0.42 },
                  ]}
                  activeOpacity={0.6}
                  onPress={() => toggle(b)}
                >
                  <View style={s.rowTop}>
                    <Mark asset={b.asset} chain={b.chain} border={colors.card} />
                    <View style={s.rowNameCol}>
                      <Text style={[s.rowName, { color: colors.foreground }]} numberOfLines={1}>
                        {assetLabel(b.asset)}
                      </Text>
                      <Text style={[s.rowSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {on
                          ? `of ${fmt4(b.amount)}`
                          : `${CHAIN_NAME[b.chain] || b.chain} · ${b.amount.toFixed(4)}`}
                      </Text>
                    </View>

                    {/* Off, the row states what is there. On, it becomes the
                        control for how much of it to move - one segmented
                        unit rather than a button, a box and a chip strung
                        across a second line. */}
                    {on ? (
                      <View style={[s.step, { borderColor: colors.border }]}>
                        <TouchableOpacity
                          style={s.stepBtn}
                          onPress={() => nudge(b, -1)}
                          activeOpacity={0.6}
                          hitSlop={6}
                        >
                          <Feather name="minus" size={14} color={colors.mutedForeground} />
                        </TouchableOpacity>
                        <TextInput
                          value={amounts[key(b)] ?? fmt4(b.amount)}
                          onChangeText={(v: string) => {
                            // One dot, digits only. A second dot makes
                            // Number() return NaN and the row would drop out
                            // of the total with nothing on screen to say why.
                            const clean = v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
                            setAmounts((prev) => ({ ...prev, [key(b)]: clean }));
                            setError("");
                          }}
                          keyboardType="decimal-pad"
                          selectTextOnFocus
                          placeholder="0"
                          placeholderTextColor={colors.mutedForeground}
                          style={[
                            s.stepInput,
                            { color: colors.foreground, borderColor: colors.border },
                          ]}
                        />
                        <TouchableOpacity
                          style={s.stepBtn}
                          onPress={() => nudge(b, 1)}
                          activeOpacity={0.6}
                          hitSlop={6}
                        >
                          <Feather name="plus" size={14} color={colors.mutedForeground} />
                        </TouchableOpacity>
                        {/* The last segment of the same control rather than a
                            button beside it, so the row carries one object
                            and not three. */}
                        <TouchableOpacity
                          style={[s.maxSeg, { borderLeftColor: colors.border }]}
                          onPress={() => {
                            setAmounts((prev) => ({ ...prev, [key(b)]: fmt4(b.amount) }));
                            setError("");
                            Haptics.selectionAsync().catch(() => {});
                          }}
                          activeOpacity={0.6}
                        >
                          <Text style={[s.maxSegText, { color: colors.primary }]}>MAX</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <Text style={[s.rowAmt, { color: colors.foreground }]}>
                        ${b.amount.toFixed(2)}
                      </Text>
                    )}

                    {on ? (
                      <Ionicons name="checkmark-circle" size={23} color={colors.primary} />
                    ) : (
                      <View style={[s.ring, { borderColor: colors.border }]} />
                    )}
                  </View>

                  {on && amountFor(b) < minFor(b.chain) && (
                    <Text style={[s.rowWarn, { color: colors.mutedForeground }]}>
                      {`The least you can sweep from ${CHAIN_NAME[b.chain] || b.chain} is ${minFor(b.chain)}.`}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>

        {!!error && <Text style={[s.err, { color: colors.destructive }]}>{error}</Text>}

        <TouchableOpacity
          style={[s.cta, { backgroundColor: colors.primary, opacity: !enough || noneLeft ? 0.4 : 1 }]}
          onPress={run}
          disabled={!enough || noneLeft}
          activeOpacity={0.85}
        >
          <Text style={[s.ctaText, { color: colors.primaryForeground }]}>
            {noneLeft
              ? "No sweeps left this week"
              : !enough
              ? "Pick a balance to sweep"
              : selected.length === 1
              ? `Sweep $${total.toFixed(2)}`
              : `Sweep $${total.toFixed(2)} from ${selected.length}`}
          </Text>
        </TouchableOpacity>

        {/* Pips and a few words, both counted from what the server sent.
            Nothing here names the weekly number, so raising it is one edit in
            one file. The rule about failed swaps not counting was explaining a
            generosity nobody had asked about and nobody could act on - if it
            ever matters, the pip that stayed lit says it without the
            sentence. */}
        <View style={[s.allowance, { backgroundColor: colors.background }]}>
          <View style={s.pips}>
            {Array.from({ length: quote.perWeek }).map((_, i) => (
              <View
                key={i}
                style={[s.pip, { backgroundColor: i < quote.left ? colors.primary : colors.border }]}
              />
            ))}
          </View>
          <Text style={[s.allowanceText, { color: colors.mutedForeground }]}>
            {quote.left} of {quote.perWeek} left this week
            {quote.left === 0 && resetWord ? ` · back ${resetWord}` : ""}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* The list you were looking at, still there but out of focus. */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: anim }]}>
        {Platform.OS !== "web" ? (
          <BlurView
            intensity={theme === "dark" ? 34 : 26}
            tint={theme === "dark" ? "dark" : "light"}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: theme === "dark" ? "rgba(0,0,0,0.42)" : "rgba(0,0,0,0.22)" },
          ]}
        />
      </Animated.View>

      <Pressable style={StyleSheet.absoluteFill} onPress={close} />

      <View style={s.dock} pointerEvents="box-none">
        <Animated.View
          style={[
            s.sheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingBottom: bottomPad,
              opacity: anim,
              transform: [
                { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [440, 0] }) },
              ],
            },
          ]}
        >
          <View style={[s.grip, { backgroundColor: colors.border }]} />

          <Text style={[s.eyebrow, { color: colors.mutedForeground }]}>{head.eyebrow}</Text>
          <Text
            style={[s.figure, { color: colors.foreground }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {head.figure}
          </Text>
          <Text style={[s.caption, { color: colors.mutedForeground }]}>{head.caption}</Text>

          {body()}
        </Animated.View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  dock: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  grip: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 20 },

  // ── the header is the state ──
  eyebrow: { fontSize: 10.5, fontFamily: "Inter_700Bold", letterSpacing: 1.5 },
  figure: {
    fontSize: 38,
    lineHeight: 45,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -1.6,
    marginTop: 4,
  },
  caption: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 2 },

  centre: { alignItems: "center", justifyContent: "center", paddingVertical: 36 },
  emptyText: { fontSize: 13.5, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },

  list: { marginTop: 20 },
  row: { paddingVertical: 13 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  /* The running list, which is read rather than operated - so it is tighter
     than the picker above it and gives each leg one line. */
  legRow: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 11 },
  legName: { flex: 1, fontSize: 14.5, lineHeight: 19, fontFamily: "Inter_600SemiBold", letterSpacing: -0.2 },
  legChain: { fontSize: 12.5, fontFamily: "Inter_400Regular", letterSpacing: 0 },
  // The dot keeps its size; the halo grows out from behind it, so the row
  // does not reflow while it breathes.
  dotWrap: { width: 8, height: 8, alignItems: "center", justifyContent: "center" },
  halo: { position: "absolute", width: 8, height: 8, borderRadius: 4 },
  legBar: { position: "absolute", left: 0, bottom: 0, height: 1.5, borderRadius: 1 },
  // Narrow on purpose: the stepper beside it is the wider thing on this row,
  // and an asset name is two or three characters.
  rowNameCol: { flex: 1, minWidth: 0 },

  /* One bordered unit with hairline divisions, rather than three controls
     with gaps between them. The divisions come from the input's own side
     borders, so there is nothing to keep aligned. */
  /* Sized to its contents rather than stretched.
     It used to take all the room left on the row, so a figure of 1 sat in
     the middle of an expanse of nothing. Eight monospace characters is the
     longest it holds - 64.1668 and its like - and the control is now that
     wide plus its buttons. */
  step: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1, borderRadius: 9, height: 30, overflow: "hidden",
  },
  stepBtn: { width: 26, height: "100%", alignItems: "center", justifyContent: "center" },
  stepInput: {
    width: 62, height: "100%", textAlign: "center", padding: 0,
    fontSize: 12.5, fontFamily: "JetBrainsMono_500Medium",
    borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth,
  },
  maxSeg: {
    height: "100%", paddingHorizontal: 9,
    alignItems: "center", justifyContent: "center",
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  maxSegText: { fontSize: 10, lineHeight: 13, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
  rowWarn: { fontSize: 11.5, lineHeight: 16, fontFamily: "Inter_400Regular", marginTop: 7, marginLeft: 46 },

  mark: { width: 38, height: 38 },
  markToken: { width: 38, height: 38, borderRadius: 19 },
  markBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 2,
    overflow: "hidden",
  },
  markChain: { width: "100%", height: "100%", borderRadius: 7 },

  rowName: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold", letterSpacing: -0.2 },
  rowSub: { fontSize: 11.5, lineHeight: 15, fontFamily: "Inter_400Regular", marginTop: 1 },
  rowAmt: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.3,
  },
  ring: { width: 23, height: 23, borderRadius: 12, borderWidth: 2 },

  trackBox: { borderRadius: 18, padding: 16, marginTop: 20 },
  legState: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  legWord: { fontSize: 12.5, fontFamily: "Inter_500Medium" },

  err: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 14 },
  cta: { height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center", marginTop: 22 },
  ctaText: { fontSize: 15.5, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },
  allowance: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 9,
    marginTop: 16,
    paddingLeft: 11,
    paddingRight: 13,
    paddingVertical: 7,
    borderRadius: 999,
  },
  pips: { flexDirection: "row", gap: 4 },
  pip: { width: 6, height: 6, borderRadius: 3 },
  allowanceText: { fontSize: 11.5, fontFamily: "Inter_600SemiBold", letterSpacing: -0.1 },

  holdOn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 22,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  holdOnText: { fontSize: 12, fontFamily: "Inter_500Medium" },
});
