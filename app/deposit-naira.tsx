import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { getFundingLimits, FundingLimits } from "@/services/funding";
import { Keypad } from "@/components/Keypad";
import { FIAT_SETTLES, FIAT_MIN_NGN, FIAT_FEE_RATE } from "@/constants/fiat";
import { FONT_SCALE } from "@/constants/transfer";

/**
 * Our cut, mirrored from FEE_PERCENT in backend/src/routes/funding.ts.
 *
 * It is not shown as a line of its own. The backend credits
 * `naira * (1 - FEE) / fundRate`. The fee was once folded into the quoted rate
 * to make a single number the arithmetic agreed with, at the cost of the fee
 * being invisible - and a deduction nobody was shown is one they find out about
 * by counting what arrived. It is its own line now, beside the rate it is taken
 * before, so all three figures are on screen and they still add up.
 */
/** Presets, trimmed to whatever the account is actually allowed to send. */
const PRESETS = [1000, 2000, 5000, 10000, 20000];

const short = (n: number) => (n >= 1000 ? `${n / 1000}k` : String(n));

export default function DepositNairaScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const { user, walletReady, rates, refreshRates } = useApp();
  const verified = !!user?.verified;

  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");
  /**
   * A beat of "Calculating..." whenever the amount moves.
   *
   * The figure is derived on device and lands instantly, which reads as the
   * number twitching under your thumb as you type. Holding it for a moment
   * makes it a result that arrived rather than digits that flickered.
   */
  const [calculating, setCalculating] = useState(false);
  const calcTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const DEFAULT_LIMITS: FundingLimits = {
    allowed: true,
    perTx: 20000,
    dailyLimit: 200000,
    spentToday: 0,
    remaining: 200000,
  };
  const [limits, setLimits] = useState<FundingLimits>(DEFAULT_LIMITS);

  useEffect(() => {
    if (!rates) refreshRates();
  }, [rates, refreshRates]);

  useEffect(() => {
    if (verified) getFundingLimits().then(setLimits).catch(() => setLimits(DEFAULT_LIMITS));
  }, [verified]);

  const ngn = Number(raw) || 0;

  useEffect(() => {
    if (!ngn) {
      setCalculating(false);
      return;
    }
    setCalculating(true);
    if (calcTimer.current) clearTimeout(calcTimer.current);
    calcTimer.current = setTimeout(() => setCalculating(false), 500);
    return () => {
      if (calcTimer.current) clearTimeout(calcTimer.current);
    };
  }, [ngn]);

  /**
   * One rate, inclusive of the fee, so `ngn / rate` is genuinely what lands.
   */
  const baseRate = rates?.[FIAT_SETTLES.token]?.fundNgn || rates?.[FIAT_SETTLES.token]?.ngn || 0;
  const rate = baseRate > 0 ? baseRate / (1 - FIAT_FEE_RATE) : 0;
  const receives = rate > 0 ? ngn / rate : 0;

  const maxNgn = Math.min(limits.perTx, Math.max(0, Math.floor(limits.remaining)));

  const handleChange = (text: string) => {
    // Leading zeros never mean anything in an amount.
    const digits = text.replace(/[^0-9]/g, "").replace(/^0+(?=[0-9])/, "").slice(0, 9);
    setRaw(digits);
    const val = Number(digits) || 0;
    if (!val) return setError("");
    if (val > limits.perTx) {
      return setError(`Most you can deposit at once is ₦${limits.perTx.toLocaleString()}`);
    }
    if (val > limits.remaining) {
      return setError(
        limits.remaining <= 0
          ? `You have reached today's ₦${limits.dailyLimit.toLocaleString()} limit`
          : `Only ₦${Math.floor(limits.remaining).toLocaleString()} left on today's limit`,
      );
    }
    if (val < FIAT_MIN_NGN) return setError(`Least you can deposit is ₦${FIAT_MIN_NGN.toLocaleString()}`);
    setError("");
  };

  const pick = (amount: number) => {
    Haptics.selectionAsync();
    handleChange(String(amount));
  };

  const ready = ngn >= FIAT_MIN_NGN && !error && rate > 0 && walletReady && !calculating;

  const handleContinue = () => {
    if (!ready) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: "/deposit-naira-transfer",
      params: { ngnAmount: String(ngn), receives: String(receives), rate: String(rate) },
    } as any);
  };

  // Flutterwave will not open an account without a NIN, and a NIN is what
  // verification collects - so this is a hard gate, not a nudge.
  if (!verified) {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.back} hitSlop={12}>
            <Feather name="arrow-left" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[s.title, { color: colors.foreground }]}>Deposit Naira</Text>
        </View>
        {/* Left-aligned and specific, rather than a centred badge over a
            centred paragraph over a centred button. What is being asked for
            and what it takes is the useful part, so it is spelled out as
            steps instead of implied by a shield. */}
        <View style={s.gate}>
          <View style={[s.gateCard, { backgroundColor: colors.card }]}>
            {/* Mark and heading on one line: with the paragraph gone there is
                nothing for a stacked icon to introduce. */}
            <View style={s.gateHead}>
              <View style={[s.gateIcon, { backgroundColor: colors.muted }]}>
                <Image
                  source={require("@/assets/images/id-card.png")}
                  style={[s.gateMark, { tintColor: colors.primary }]}
                  resizeMode="contain"
                />
              </View>
              <Text style={[s.gateTitle, { color: colors.foreground }]}>
                Verify to fund with naira
              </Text>
            </View>

            <View style={[s.gateSteps, { borderTopColor: colors.border }]}>
              {[
                "A photo of your government ID",
                "A face scan to match it",
                "Usually approved within minutes",
              ].map((line, i) => (
                <View key={line} style={s.gateStep}>
                  <View style={[s.gateStepNo, { backgroundColor: colors.muted }]}>
                    <Text style={[s.gateStepNoText, { color: colors.mutedForeground }]}>
                      {i + 1}
                    </Text>
                  </View>
                  <Text style={[s.gateStepText, { color: colors.foreground }]}>{line}</Text>
                </View>
              ))}
            </View>
          </View>

          <TouchableOpacity
            style={[s.gateBtn, { backgroundColor: colors.primary }]}
            onPress={() => router.push("/account/kyc")}
            activeOpacity={0.85}
          >
            <Text style={[s.gateBtnText, { color: colors.primaryForeground }]}>Verify my ID</Text>
          </TouchableOpacity>

        </View>
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.back} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.foreground }]}>Deposit Naira</Text>
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.card, { backgroundColor: colors.card }]}>
          <Text style={[s.cardLabel, { color: colors.mutedForeground }]}>How much?</Text>

          {/* The sign is a glyph, not a text character - the app's naira mark
              has a crossbar the system font renders inconsistently. */}
          <View style={s.amountRow}>
            <Image
              source={require("@/assets/images/nairaiconnew.png")}
              style={[s.nairaSign, { tintColor: ngn > 0 ? colors.foreground : colors.mutedForeground }]}
            />
            {/* Text, not an input. The keypad below is the only way in, so
                there is nothing to focus and no system keyboard to raise over
                the button. */}
            <Text style={[s.amountInput, { color: raw ? colors.foreground : colors.mutedForeground }]}>
              {raw ? Number(raw).toLocaleString("en-NG") : "0"}
            </Text>
          </View>

          <Text style={[s.limitLine, { color: error ? "#ef4444" : colors.mutedForeground }]}>
            {error || `Between ₦${FIAT_MIN_NGN.toLocaleString()} and ₦${maxNgn.toLocaleString()}.`}
          </Text>

          <View style={s.chips}>
            {PRESETS.filter((p) => p <= maxNgn).map((p) => {
              const on = ngn === p;
              return (
                <TouchableOpacity
                  key={p}
                  style={[s.chip, { backgroundColor: on ? colors.primary : colors.muted }]}
                  onPress={() => pick(p)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[s.chipText, { color: on ? colors.primaryForeground : colors.mutedForeground }]}
                  >
                    {short(p)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={[s.card, { backgroundColor: colors.card }]}>
          <View style={s.line}>
            <Text style={[s.lineLabel, { color: colors.mutedForeground }]}>
              Fee ({Math.round(FIAT_FEE_RATE * 100)}%)
            </Text>
            <Text style={[s.lineValue, { color: colors.foreground }]}>
              {ngn ? `− ₦${Math.round(ngn * FIAT_FEE_RATE).toLocaleString()}` : "—"}
            </Text>
          </View>

          <View style={s.line}>
            <Text style={[s.lineLabel, { color: colors.mutedForeground }]}>Converted at</Text>
            <Text style={[s.lineValue, { color: colors.foreground }]}>
              {baseRate > 0 ? `$1 ≈ ₦${Math.round(baseRate).toLocaleString()}` : "Loading..."}
            </Text>
          </View>

          <View style={s.line}>
            <Text style={[s.lineLabel, { color: colors.mutedForeground }]}>You receive</Text>
            <Text style={[s.lineValue, { color: colors.foreground }]}>
              {!ngn
                ? "—"
                : calculating || rate <= 0
                ? "Calculating..."
                : `≈ $${receives.toFixed(2)}`}
            </Text>
          </View>

          {/* True of us specifically: the amount is worked out when the transfer
              lands, not when this screen is drawn. Saying so here is cheaper
              than explaining a few-cent difference afterwards. */}
          <Text style={[s.note, { color: colors.mutedForeground }]}>
            The final amount follows the rate at the moment your transfer lands, so it can move a
            little either way.
          </Text>
        </View>
      </ScrollView>

      {/* Button above the keypad, both always in view: nothing to dismiss,
          nothing to lift out of the way. */}
      <View style={[s.bottomBar, { paddingBottom: bottomPad + 10, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[s.cta, { backgroundColor: ready ? colors.primary : colors.muted }]}
          onPress={handleContinue}
          disabled={!ready}
          activeOpacity={0.85}
        >
          <Text style={[s.ctaText, { color: ready ? colors.primaryForeground : colors.mutedForeground }]}>
            Deposit
          </Text>
        </TouchableOpacity>

        <Keypad
          style={s.pad}
          onKey={(d) => handleChange(raw + d)}
          onBackspace={() => handleChange(raw.slice(0, -1))}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 12, marginBottom: 10 },
  back: { position: "absolute", left: 20 },
  title: { fontSize: 18, lineHeight: 24, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.4 },

  content: { paddingHorizontal: 20 },
  card: { borderRadius: 20, padding: 18, marginBottom: 14 },
  cardLabel: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },

  amountRow: { flexDirection: "row", alignItems: "flex-end", gap: 4, marginTop: 6 },
  /**
   * Sized to the digits, not to its own canvas.
   *
   * The glyph's ink fills 448 of its 512px box, so a 26pt frame puts the mark
   * at roughly the cap height of the 36pt figures beside it - a touch shorter,
   * which is how a currency sign is meant to sit.
   */
  // Box, not glyph: `contain` scales the mark's transparent margin too, so
  // it fills about two thirds of what is set here. 39 lands it on the cap
  // height of the 36pt figure; the lift puts it on their baseline.
  nairaSign: { width: 39 * FONT_SCALE, height: 39 * FONT_SCALE, resizeMode: "contain", marginRight: -5 * FONT_SCALE, marginBottom: 4 * FONT_SCALE },
  amountInput: {
    flex: 1,
    fontSize: 36,
    lineHeight: 44,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -1.1,
    padding: 0,
  },

  limitLine: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 9 },

  chips: { flexDirection: "row", gap: 8, marginTop: 14 },
  chip: { flex: 1, paddingVertical: 9, borderRadius: 999, alignItems: "center" },
  chipText: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_600SemiBold" },

  line: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  lineLabel: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  // A step above the body bold, so the two figures that matter carry the screen.
  lineValue: { fontSize: 15.5, lineHeight: 20, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },
  note: { fontSize: 12.5, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 2 },

  bottomBar: { paddingHorizontal: 20, paddingTop: 12 },
  pad: { marginTop: 12 },
  cta: { height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },

  gate: { flex: 1, paddingHorizontal: 16, paddingTop: 24 },
  gateCard: { alignSelf: "stretch", borderRadius: 22, padding: 20 },
  gateIcon: { width: 46, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  gateMark: { width: 24, height: 24 },
  gateHead: { flexDirection: "row", alignItems: "center", gap: 13 },
  gateTitle: {
    flex: 1,
    fontSize: 19,
    lineHeight: 25,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.4,
  },
  gateSteps: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 18, paddingTop: 16, gap: 12 },
  gateStep: { flexDirection: "row", alignItems: "center", gap: 11 },
  gateStepNo: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  gateStepNoText: { fontSize: 11.5, lineHeight: 15, fontFamily: "Inter_700Bold" },
  gateStepText: { flex: 1, fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_500Medium" },
  gateBtn: {
    alignSelf: "stretch",
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  gateBtnText: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
});
