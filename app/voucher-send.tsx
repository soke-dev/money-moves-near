import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import QRCode from "react-native-qrcode-svg";
import { useVoucherShare } from "@/hooks/useVoucherShare";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { signMovementTransaction, ensureSigningSession } from "@/services/wallet-core";
import {
  prepareVoucher,
  submitVoucher,
  VOUCHER_QR_PREFIX,
  type PreparedVoucher,
} from "@/services/voucher";

/**
 * Sending a voucher: your own money, split between people who have the code.
 *
 * Three steps in one screen rather than three routes, because the middle one
 * is a decision about the first and going "back" between them should not mean
 * losing what you typed.
 *
 * The money only leaves at step two. Everything before that is arithmetic the
 * server did, and the amounts are not fixed until the transfer is signed -
 * which is why Reshuffle lives beside Create and not after it.
 */
export default function SendVoucherScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const { walletBalances, refreshBalances } = useApp();

  const [pot, setPot] = useState("");
  // One, not five. Sending to a single person is the ordinary case, and a
  // default of five meant everybody who wanted that had to press minus four
  // times before they could start.
  const [people, setPeople] = useState(1);
  const [lucky, setLucky] = useState(true);
  /**
   * Who may claim, and how often.
   *
   * Both default to the narrowest sensible thing - open to everyone, once
   * each - because that is what the voucher did before these existed and it
   * is what most people mean when they do not think about it.
   */
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [perUser, setPerUser] = useState(1);
  const [tail, setTail] = useState("");

  const [plan, setPlan] = useState<PreparedVoucher | null>(null);
  const [done, setDone] = useState<{ code: string; endsAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const { shareVoucher, shareCard, sharing } = useVoucherShare();

  /**
   * The Movement USDCx row, which is the only balance a voucher can be funded
   * from - escrow lives on Movement and the transfer never leaves it.
   *
   * USDCx by name, and the legacy row only if there is no USDCx row at all.
   * Movement carries two: USDCx, which is the native token everything uses,
   * and a USDC row left over from the bridged asset. Accepting either and
   * taking whichever came back first is what made an account holding 8.04
   * USDCx read "You have 0.00" - the old row was created two months earlier,
   * so it is the one that sorts first, and it has been empty the whole time.
   */
  const moveRows = walletBalances.filter((b) => b.chain === "MOVE");
  const usdc =
    (moveRows.find((b) => b.asset === "USDCx") ?? moveRows.find((b) => b.asset === "USDC"))
      ?.balance ?? 0;
  const amount = Number(pot) || 0;
  const MAX_POT = plan?.limits.maxPot ?? 100;
  const MAX_PEOPLE = plan?.limits.maxWinners ?? 20;
  const MIN_SLICE = plan?.limits.minSlice ?? 0.1;

  /**
   * The floor, not the cap, is what usually stops somebody.
   *
   * Said while they are still adjusting rather than after a refusal: "2 split
   * 20 ways" is arithmetic they can fix by moving either number, and they can
   * only do that if they can see which one is in the way.
   */
  const MAX_PER_USER = plan?.limits.maxPerUser ?? 3;
  /**
   * Nobody may claim more times than the pot is cut.
   *
   * Pulled down rather than refused: the person is dragging the people count
   * about while they decide, and a refusal for a combination they are halfway
   * through setting is a dead end. The server checks it again anyway.
   */
  const perUserCap = Math.min(MAX_PER_USER, people);
  useEffect(() => {
    if (perUser > perUserCap) setPerUser(perUserCap);
  }, [perUserCap, perUser]);

  const tooThin = amount > 0 && amount < MIN_SLICE * people;
  const tooBig = amount > MAX_POT;
  const tooMuch = amount > usdc;
  const ready = amount > 0 && !tooThin && !tooBig && !tooMuch && !busy;
  const each = people > 0 ? amount / people : 0;

  async function seeTheSplit() {
    setBusy(true);
    setErr("");
    try {
      // A lapsed wallet session signs out here, before the server opens a row it couldn't then close.
      await ensureSigningSession();
      const p = await prepareVoucher({
        pot: amount,
        winners: people,
        lucky,
        spread: "mixed",
        code: tail.trim() || undefined,
        verifiedOnly,
        perUserClaims: perUser,
      });
      setPlan(p);
      Haptics.selectionAsync().catch(() => {});
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Could not work that out.");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!plan) return;
    setBusy(true);
    setErr("");
    try {
      const { signature, publicKey } = await signMovementTransaction(plan.signingMessage);
      const out = await submitVoucher({ prepareId: plan.prepareId, signature, publicKey });
      setDone({ code: out.voucher.code, endsAt: out.voucher.endsAt });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      refreshBalances(true).catch(() => {});
    } catch (e: any) {
      // A prepare is spent whether or not the signing worked, so the plan goes
      // with it - otherwise Create would fire at an id the server has dropped.
      setPlan(null);
      setErr(
        e?.response?.data?.error ||
          "That did not go through, so nothing was created and your balance is untouched.",
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  const header = (label: string, back: () => void) => (
    <View style={s.header}>
      <TouchableOpacity onPress={back} hitSlop={12}>
        <Feather name="arrow-left" size={22} color={colors.foreground} />
      </TouchableOpacity>
      <Text style={[s.title, { color: colors.foreground }]}>{label}</Text>
    </View>
  );

  /* ── Made ──────────────────────────────────────────────────────── */
  if (done) {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <View style={[s.header, { justifyContent: "flex-end" }]}>
          <TouchableOpacity onPress={() => router.replace("/(tabs)")} hitSlop={12}>
            <Text style={[s.link, { color: colors.mutedForeground }]}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ alignItems: "center", paddingHorizontal: 20 }}>
          <View style={[s.disc, { backgroundColor: colors.primary }]}>
            <Feather name="check" size={28} color={colors.primaryForeground} />
          </View>
          <Text style={[s.big, { color: colors.foreground }]}>Ready to share</Text>
          <Text style={[s.lede, { color: colors.mutedForeground }]}>
            {amount.toFixed(2)} USDC waiting for the first {people}{" "}
            {people === 1 ? "person" : "people"} who scan or type it.
          </Text>

          {/* Prefixed, so a scanner knows it is a voucher and not a username. */}
          <View style={s.qr}>
            <QRCode value={`${VOUCHER_QR_PREFIX}${done.code}`} size={188} backgroundColor="#fff" />
          </View>

          <Text style={[s.code, { color: colors.foreground }]}>{done.code}</Text>
          <Text style={[s.small, { color: colors.mutedForeground }]}>
            Expires {new Date(done.endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ·
            unclaimed comes back to you
          </Text>
        </ScrollView>

        <View style={[s.dock, { paddingBottom: bottomPad + 14 }]}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {/* A card rather than a sentence. A bare code in a group chat asks
                whoever reads it to trust a string and type it correctly; the
                image carries the scannable version and what it is worth. */}
            <TouchableOpacity
              style={[s.cta, { backgroundColor: colors.primary, flex: 1, opacity: sharing ? 0.6 : 1 }]}
              onPress={() =>
                shareVoucher({
                  code: done.code,
                  qrValue: `${VOUCHER_QR_PREFIX}${done.code}`,
                  amount,
                  people,
                  endsAt: done.endsAt,
                })
              }
              disabled={sharing}
              activeOpacity={0.85}
            >
              {sharing ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <>
                  <Feather name="share" size={18} color={colors.primaryForeground} />
                  <Text style={[s.ctaText, { color: colors.primaryForeground }]}>Share</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.square, { borderColor: colors.border }]}
              onPress={() => {
                Clipboard.setStringAsync(done.code).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              }}
              activeOpacity={0.7}
            >
              <Feather name={copied ? "check" : "copy"} size={19} color={colors.foreground} />
            </TouchableOpacity>
          </View>
        </View>

        {shareCard}
      </View>
    );
  }

  /* ── The split ─────────────────────────────────────────────────── */
  if (plan) {
    const top = plan.amounts[0] ?? 0;
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        {header("The split", () => setPlan(null))}
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }}>
          <Text style={[s.heading, { color: colors.foreground }]}>
            {plan.amounts.length} {plan.amounts.length === 1 ? "slice" : "slices"}
            {lucky ? ", all different" : ", the same each"}
          </Text>
          {lucky && (
            <Text style={[s.lede, { color: colors.mutedForeground, textAlign: "left", marginTop: 7 }]}>
              Shuffled before anyone sees them. Claiming first means nothing — the {top.toFixed(2)} could
              go to any of the {plan.amounts.length}.
            </Text>
          )}

          <View style={[s.card, { backgroundColor: colors.card }]}>
            <View style={s.statRow}>
              {[
                ["SMALLEST", plan.amounts[plan.amounts.length - 1] ?? 0, colors.foreground],
                ["AVERAGE", plan.pot / plan.amounts.length, colors.foreground],
                ["BIGGEST", top, colors.primary],
              ].map(([label, val, tone]) => (
                <View key={label as string}>
                  <Text style={[s.kicker, { color: colors.mutedForeground }]}>{label as string}</Text>
                  <Text style={[s.stat, { color: tone as string }]}>{Number(val).toFixed(2)}</Text>
                </View>
              ))}
            </View>

            {/* A grid rather than bars: this has to read the same at 3 as at 20. */}
            <View style={s.grid}>
              {plan.amounts.map((a, i) => (
                <View
                  key={i}
                  style={[
                    s.chip,
                    {
                      borderColor: i === 0 ? colors.primary : colors.border,
                      backgroundColor: i === 0 ? colors.primary + "1F" : colors.background,
                    },
                  ]}
                >
                  <Text style={[s.chipText, { color: i === 0 ? colors.primary : colors.foreground }]}>
                    {a.toFixed(2)}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <View style={s.line}>
            <Text style={[s.small, { color: colors.mutedForeground }]}>From your balance</Text>
            <Text style={[s.lineValue, { color: colors.foreground }]}>{plan.pot.toFixed(2)} USDC</Text>
          </View>

          <View style={[s.noteRow, { backgroundColor: colors.card }]}>
            <Feather name="clock" size={16} color={colors.mutedForeground} />
            <Text style={[s.noteText, { color: colors.mutedForeground }]}>
              Held for {plan.limits.days} days. Whatever nobody claims comes back to you automatically —
              you do not have to ask.
            </Text>
          </View>

          <Text style={[s.small, { color: colors.mutedForeground, marginTop: 14 }]}>
            Your code will be <Text style={{ color: colors.foreground }}>{plan.code}</Text>
          </Text>

          {!!err && <Text style={[s.err, { color: colors.destructive }]}>{err}</Text>}
        </ScrollView>

        <View style={[s.dock, { paddingBottom: bottomPad + 14 }]}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity
              style={[s.ghostBtn, { borderColor: colors.border }]}
              onPress={seeTheSplit}
              disabled={busy}
              activeOpacity={0.7}
            >
              <Text style={[s.ghostText, { color: colors.foreground }]}>Reshuffle</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.cta, { backgroundColor: colors.primary, flex: 1, opacity: busy ? 0.5 : 1 }]}
              onPress={create}
              disabled={busy}
              activeOpacity={0.85}
            >
              {busy ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[s.ctaText, { color: colors.primaryForeground }]}>Create it</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  /* ── How much, how many ────────────────────────────────────────── */
  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {header("Create a voucher", () => router.back())}
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
        <Text style={[s.kicker, { color: colors.mutedForeground }]}>HOW MUCH</Text>
        <View style={s.amountRow}>
          <TextInput
            value={pot}
            onChangeText={(t) => setPot(t.replace(/[^0-9.]/g, "").slice(0, 7))}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={colors.mutedForeground + "55"}
            style={[s.amount, { color: colors.foreground }]}
          />
          <Text style={[s.unit, { color: colors.mutedForeground }]}>USDC</Text>
        </View>
        {/* Names the chain, because a voucher is funded from Movement and
            nowhere else - somebody holding plenty on Arc and nothing here
            needs to be told which balance is being talked about. */}
        <Text style={[s.small, { color: usdc <= 0 || tooMuch ? colors.destructive : colors.mutedForeground }]}>
          {usdc <= 0
            ? "You have no USDC on Movement"
            : tooMuch
              ? `Not enough USDC on Movement — you have $${usdc.toFixed(2)}`
              : `You have $${usdc.toFixed(2)} · up to $${MAX_POT} per voucher`}
        </Text>


        {/*
          One panel, four rows.
          ─────────────────────────────────────────────────────────────
          This was four sections, each with its own heading and its own pair
          of big tap-cards, stacked down the page. Three identical card pairs
          in a column is a template rather than a layout: it reads as filler,
          it pushed the code field and the button off the screen, and the
          second stepper looked like a copy of the first because it was one.

          Grouped into a single card they read as what they are - the settings
          for one thing - and the whole screen fits without scrolling. The
          binary choices use the same segmented pill the sell screen already
          uses for its tabs, so this looks like the rest of the app rather
          than like a new idea.
        */}
        <View style={[s.panel, { backgroundColor: colors.card, marginTop: 22 }]}>
          <View style={s.row}>
            <Text style={[s.rowLabel, { color: colors.foreground }]}>People</Text>
            <View style={s.rowRight}>
              <TouchableOpacity
                style={[s.tick, { borderColor: colors.border, opacity: people <= 1 ? 0.35 : 1 }]}
                onPress={() => setPeople((n) => Math.max(1, n - 1))}
                disabled={people <= 1}
                accessibilityLabel="Fewer people"
                hitSlop={8}
              >
                <Feather name="minus" size={15} color={colors.foreground} />
              </TouchableOpacity>
              <Text style={[s.rowValue, { color: colors.foreground }]}>{people}</Text>
              <TouchableOpacity
                style={[s.tick, { borderColor: colors.border, opacity: people >= MAX_PEOPLE ? 0.35 : 1 }]}
                onPress={() => setPeople((n) => Math.min(MAX_PEOPLE, n + 1))}
                disabled={people >= MAX_PEOPLE}
                accessibilityLabel="More people"
                hitSlop={8}
              >
                <Feather name="plus" size={15} color={colors.foreground} />
              </TouchableOpacity>
            </View>
          </View>
          <Text style={[s.rowNote, { color: tooThin ? colors.warning : colors.mutedForeground }]}>
            {tooThin
              ? `Too thin — everyone gets at least ${MIN_SLICE}`
              : amount > 0
                ? lucky
                  ? `${each.toFixed(2)} each on average · up to ${MAX_PEOPLE}`
                  : `${each.toFixed(2)} each · up to ${MAX_PEOPLE}`
                : `Up to ${MAX_PEOPLE}`}
          </Text>

          <View style={[s.rule, { backgroundColor: colors.border }]} />

          <View style={s.row}>
            <Text style={[s.rowLabel, { color: colors.foreground }]}>Split</Text>
            <View style={[s.seg, { backgroundColor: colors.muted }]}>
              {[
                { on: true, t: "Lucky dip" },
                { on: false, t: "Same each" },
              ].map((o) => (
                <TouchableOpacity
                  key={o.t}
                  onPress={() => setLucky(o.on)}
                  activeOpacity={0.8}
                  style={[s.segTab, lucky === o.on && { backgroundColor: colors.card }]}
                >
                  <Text
                    style={[
                      s.segText,
                      { color: lucky === o.on ? colors.foreground : colors.mutedForeground },
                    ]}
                  >
                    {o.t}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <Text style={[s.rowNote, { color: colors.mutedForeground }]}>
            {lucky
              ? "Everyone gets a different amount. One gets the most."
              : "Everyone gets the same amount."}
          </Text>

          <View style={[s.rule, { backgroundColor: colors.border }]} />

          <View style={s.row}>
            <Text style={[s.rowLabel, { color: colors.foreground }]}>Who can claim</Text>
            <View style={[s.seg, { backgroundColor: colors.muted }]}>
              {[
                { on: false, t: "Anyone" },
                { on: true, t: "Verified" },
              ].map((o) => (
                <TouchableOpacity
                  key={o.t}
                  onPress={() => setVerifiedOnly(o.on)}
                  activeOpacity={0.8}
                  style={[s.segTab, verifiedOnly === o.on && { backgroundColor: colors.card }]}
                >
                  <Text
                    style={[
                      s.segText,
                      { color: verifiedOnly === o.on ? colors.foreground : colors.mutedForeground },
                    ]}
                  >
                    {o.t}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <Text style={[s.rowNote, { color: colors.mutedForeground }]}>
            {verifiedOnly
              ? "Only accounts that have passed identity checks."
              : "Any Money Moves account with the code."}
          </Text>

          <View style={[s.rule, { backgroundColor: colors.border }]} />

          <View style={s.row}>
            <Text style={[s.rowLabel, { color: colors.foreground }]}>Times each</Text>
            <View style={s.rowRight}>
              <TouchableOpacity
                style={[s.tick, { borderColor: colors.border, opacity: perUser <= 1 ? 0.35 : 1 }]}
                onPress={() => setPerUser((n) => Math.max(1, n - 1))}
                disabled={perUser <= 1}
                accessibilityLabel="Fewer claims each"
                hitSlop={8}
              >
                <Feather name="minus" size={15} color={colors.foreground} />
              </TouchableOpacity>
              <Text style={[s.rowValue, { color: colors.foreground }]}>{perUser}</Text>
              <TouchableOpacity
                style={[s.tick, { borderColor: colors.border, opacity: perUser >= perUserCap ? 0.35 : 1 }]}
                onPress={() => setPerUser((n) => Math.min(perUserCap, n + 1))}
                disabled={perUser >= perUserCap}
                accessibilityLabel="More claims each"
                hitSlop={8}
              >
                <Feather name="plus" size={15} color={colors.foreground} />
              </TouchableOpacity>
            </View>
          </View>
          {/* Said plainly, because "5 people" stops being true the moment one
              of them can claim twice. */}
          <Text style={[s.rowNote, { color: colors.mutedForeground }]}>
            {perUser === 1
              ? `Up to ${people} ${people === 1 ? "person" : "people"}, once each`
              : `As few as ${Math.ceil(people / perUser)} could take all ${people}`}
          </Text>
        </View>


        <Text style={[s.kicker, { color: colors.mutedForeground, marginTop: 26 }]}>YOUR CODE (OPTIONAL)</Text>
        <TextInput
          value={tail}
          onChangeText={(t) => setTail(t.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24))}
          placeholder="PARTY"
          placeholderTextColor={colors.mutedForeground + "55"}
          style={[s.codeInput, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
        />
        {/* Their name is the front of it, so nobody can mint a code that looks
            like ours or like somebody else's. */}
        <Text style={[s.small, { color: colors.mutedForeground, marginTop: 7 }]}>
          Your username goes in front, so it is clearly from you. Leave it blank and we will pick one.
        </Text>

        {!!err && <Text style={[s.err, { color: colors.destructive }]}>{err}</Text>}
      </ScrollView>

      <View style={[s.dock, { paddingBottom: bottomPad + 14 }]}>
        <TouchableOpacity
          style={[s.cta, { backgroundColor: colors.primary, opacity: ready ? 1 : 0.45 }]}
          onPress={seeTheSplit}
          disabled={!ready}
          activeOpacity={0.85}
        >
          {/* The button says what is missing before it says what it does.
              "See the split" over an empty amount promises a screen that
              cannot be drawn yet, and the only clue it would not open was that
              it looked slightly faded. */}
          {busy ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[s.ctaText, { color: colors.primaryForeground }]}>
              {amount > 0 ? "See the split" : "Type an amount"}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, height: 44 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  link: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  kicker: { fontSize: 11, letterSpacing: 1.1, fontFamily: "Inter_600SemiBold" },
  amountRow: { flexDirection: "row", alignItems: "baseline", gap: 10, marginTop: 8 },
  amount: { fontSize: 46, fontFamily: "Inter_800ExtraBold", letterSpacing: -2.5, minWidth: 140, padding: 0 },
  unit: { fontSize: 19, fontFamily: "Inter_500Medium" },
  small: { fontSize: 12.5, fontFamily: "Inter_400Regular" },



  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingHorizontal: 2 },
  lineValue: { fontSize: 16, fontFamily: "Inter_700Bold" },

  // One card holding every setting, ruled between rows rather than boxed
  // apart - the four of them describe one voucher, so they read as one thing.
  panel: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingTop: 14,
  },
  rowLabel: { fontSize: 14.5, fontFamily: "Inter_600SemiBold" },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 14 },
  rowValue: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    minWidth: 20,
    textAlign: "center",
    // Tabular so the row does not shuffle sideways between 9 and 10.
    fontVariant: ["tabular-nums"] as const,
  },
  rowNote: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 5, paddingBottom: 14 },
  rule: { height: StyleSheet.hairlineWidth },
  tick: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  // The same segmented pill the sell screen uses for its tabs.
  seg: { flexDirection: "row", borderRadius: 999, padding: 3 },
  segTab: { paddingHorizontal: 13, paddingVertical: 6, borderRadius: 999 },
  segText: { fontSize: 12.5, fontFamily: "Inter_700Bold" },




  codeInput: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    marginTop: 10,
    paddingHorizontal: 16,
    fontSize: 16,
    letterSpacing: 2,
    fontFamily: "Inter_700Bold",
  },

  heading: { fontSize: 20, lineHeight: 26, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.6 },
  card: { borderRadius: 18, padding: 16, marginTop: 18 },
  statRow: { flexDirection: "row", justifyContent: "space-between" },
  stat: { fontSize: 19, fontFamily: "Inter_800ExtraBold", marginTop: 3, fontVariant: ["tabular-nums"] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 15 },
  chip: { borderRadius: 9, borderWidth: 1, paddingVertical: 7, width: 74, alignItems: "center" },
  chipText: { fontSize: 13.5, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },

  noteRow: { flexDirection: "row", gap: 9, alignItems: "flex-start", borderRadius: 14, padding: 13, marginTop: 14 },
  noteText: { flex: 1, fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },

  disc: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginTop: 18 },
  big: { fontSize: 26, fontFamily: "Inter_800ExtraBold", letterSpacing: -1, marginTop: 16 },
  lede: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular", marginTop: 6, textAlign: "center" },
  qr: { backgroundColor: "#fff", padding: 14, borderRadius: 18, marginTop: 22 },
  code: { fontSize: 19, fontFamily: "Inter_700Bold", letterSpacing: 2.5, marginTop: 16 },

  dock: { paddingHorizontal: 20, paddingTop: 10 },
  cta: { height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 9 },
  ctaText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  ghostBtn: { height: 54, paddingHorizontal: 20, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  ghostText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  square: { width: 54, height: 54, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },

  err: { fontSize: 12.5, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 14 },
});
