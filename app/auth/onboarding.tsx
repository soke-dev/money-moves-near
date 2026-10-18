import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Platform,
  Image,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import Svg, { Circle } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/context/ThemeContext";

const MAX_MOBILE_W = 480;
const ONBOARDING_KEY = "mm_onboarded";

/* ─── Slide data ─── */
interface Slide {
  id: string;
  heading: string;
  sub: string;
  /** Render illustration for this slide */
  illustration: (colors: ReturnType<typeof useColors>) => React.ReactNode;
}

/**
 * A row of the real thing.
 *
 * These slides used to be illustrations of the app rather than the app: coins
 * drifting past each other, bubbles, a Feather glyph in a tinted circle per
 * feature. It photographed like every other fintech intro because it was made
 * of the same parts, and it taught nothing - a floating USDT logo does not tell
 * anyone what happens when they press a button.
 *
 * So each slide shows a fragment of a screen they are about to use, drawn the
 * way that screen draws it: the same card, the same hairline, the same marks
 * and the same figures. It is recognisable when they get there, which is the
 * whole point of showing it first.
 */
function ProofCard({
  colors,
  children,
}: {
  colors: ReturnType<typeof useColors>;
  children: React.ReactNode;
}) {
  return <View style={[s.proof, { backgroundColor: colors.card }]}>{children}</View>;
}

/** Label left, figure right - the shape every ledger in this app uses. */
function ProofLine({
  colors,
  k,
  v,
  strong,
  accent,
}: {
  colors: ReturnType<typeof useColors>;
  k: string;
  v: string;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <View style={s.proofLine}>
      <Text style={[s.proofK, { color: strong ? colors.foreground : colors.mutedForeground }]}>{k}</Text>
      <Text
        style={[
          strong ? s.proofVStrong : s.proofV,
          { color: accent ? colors.primary : strong ? colors.foreground : colors.mutedForeground },
        ]}
      >
        {v}
      </Text>
    </View>
  );
}

/** A transaction row, exactly as the list draws one. */
function ProofRow({
  colors,
  mark,
  title,
  sub,
  amount,
  accent,
  last,
}: {
  colors: ReturnType<typeof useColors>;
  mark: any;
  title: string;
  sub: string;
  amount: string;
  accent?: boolean;
  last?: boolean;
}) {
  const { isDark } = useTheme();
  return (
    <View
      style={[
        s.proofRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
      ]}
    >
      <View style={s.proofMarkSlot}>
        <Image
          source={mark}
          style={[s.proofMark, { tintColor: isDark ? "#FFFFFF" : "#000000" }]}
          resizeMode="contain"
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.proofTitle, { color: colors.foreground }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[s.proofSub, { color: colors.mutedForeground }]} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <Text style={[s.proofAmt, { color: accent ? colors.primary : colors.foreground }]}>{amount}</Text>
    </View>
  );
}

const SLIDES: Slide[] = [
  /**
   * The same thing the website says, in the same order.
   *
   * The opener is the landing page's headline and its sentence underneath,
   * word for word. Somebody who read the site and then downloaded the app
   * should arrive at what brought them, not at a different pitch - and "fund
   * in naira, hold in dollars" was a feature wearing the hero's clothes. It is
   * a feature again, second, where it belongs.
   */
  {
    id: "own",
    heading: "Own your wallet.\nSpend anywhere.",
    sub: "Money Moves is a self-custodial finance app that lets you spend crypto like cash. Keep your money in stablecoins and spend it on bills, bank transfers and airtime, from one balance only you control.",
    illustration: (colors) => (
      <ProofCard colors={colors}>
        <ProofRow
          colors={colors}
          mark={require("@/assets/images/bank.png")}
          title="GTBANK ···4821"
          sub="sold 8.12 USDC · 41s"
          amount="₦12,450"
        />
        <ProofRow
          colors={colors}
          mark={require("@/assets/images/user.png")}
          title="From @tobi"
          sub="no gas · just now"
          amount="+8.50"
          accent
        />
        <ProofRow
          colors={colors}
          mark={require("@/assets/images/flash.png")}
          title="Ikeja Electric"
          sub="token 0192 8374 5601"
          amount="− ₦5,000"
          last
        />
      </ProofCard>
    ),
  },
  {
    id: "dollars",
    heading: "Fund in naira.\nHold in dollars.",
    sub: "Transfer from any bank and keep a balance in USDC and USDT that does not move with your local currency, at a rate confirmed before you send.",
    illustration: (colors) => (
      <ProofCard colors={colors}>
        <ProofLine colors={colors} k="You send" v="₦50,000" />
        <ProofLine colors={colors} k="Fee (1%)" v="− ₦500" />
        <ProofLine colors={colors} k="Converted at" v="$1 ≈ ₦1,390" />
        <View style={[s.proofRule, { backgroundColor: colors.border }]} />
        <ProofLine colors={colors} k="You receive" v="35.61 USDC" strong accent />
      </ProofCard>
    ),
  },
  {
    id: "name",
    heading: "Send to a name",
    sub: "Pay anyone on Money Moves by their @username. No 42-character address, and no gas to cover.",
    illustration: (colors) => (
      <ProofCard colors={colors}>
        <ProofRow
          colors={colors}
          mark={require("@/assets/images/user.png")}
          title="Sent to @chidi"
          sub="12.00 USDC · instant"
          amount="− 12.00"
        />
        <ProofRow
          colors={colors}
          mark={require("@/assets/images/user.png")}
          title="From @amaka"
          sub="5.00 USDC · no gas"
          amount="+5.00"
          accent
          last
        />
      </ProofCard>
    ),
  },
  {
    id: "cashout",
    heading: "Cash out at home",
    sub: "Sell your balance and send it to a local bank account. A reference on every payout, in case one drags.",
    illustration: (colors) => (
      <ProofCard colors={colors}>
        <ProofRow
          colors={colors}
          mark={require("@/assets/images/bank.png")}
          title="GTBANK ···4821"
          sub="Sold 35.00 USDC · 2:14pm"
          amount="₦47,250"
        />
        <ProofRow
          colors={colors}
          mark={require("@/assets/images/telephone-call.png")}
          title="MTN"
          sub="Airtime · 0803 ··· 4471"
          amount="− ₦2,000"
          last
        />
      </ProofCard>
    ),
  },
];

/* ─── Circular progress next button ─── */
const RING_SIZE = 64;
const RING_STROKE = 3;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function NextButton({ progress, onPress, colors }: { progress: number; onPress: () => void; colors: any }) {
  const offset = RING_CIRCUMFERENCE * (1 - progress);
  return (
    <TouchableOpacity style={s.nextBtnOuter} onPress={onPress} activeOpacity={0.8}>
      <Svg width={RING_SIZE} height={RING_SIZE} style={s.ringSvg}>
        {/* Background ring */}
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke="#e0e0e0"
          strokeWidth={RING_STROKE}
          fill="none"
        />
        {/* Progress ring */}
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke={colors.foreground}
          strokeWidth={RING_STROKE}
          fill="none"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
        />
      </Svg>
      <View style={[s.nextBtnInner, { backgroundColor: colors.foreground }]}>
        <Feather name="arrow-right" size={22} color={colors.background} />
      </View>
    </TouchableOpacity>
  );
}

/* ─── Main Screen ─── */
export default function OnboardingScreen() {
  const colors = useColors();
  const { isDark, toggleTheme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowW } = useWindowDimensions();
  const SCREEN_W = Platform.OS === "web" ? Math.min(windowW, MAX_MOBILE_W) : windowW;
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const flatListRef = useRef<FlatList>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const isLast = currentIndex === SLIDES.length - 1;
  const progress = (currentIndex + 1) / SLIDES.length;

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      setCurrentIndex(viewableItems[0].index ?? 0);
    }
  }).current;
  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const finishOnboarding = useCallback(async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, "1");
    router.replace("/auth/dynamic-onboarding");
  }, []);

  const goNext = () => {
    if (isLast) return;
    flatListRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
  };

  const renderSlide = ({ item, index }: { item: Slide; index: number }) => (
    <View style={[s.slide, { width: SCREEN_W }]}>
      {/* Text area */}
      <View style={s.textArea}>
        {/* Page dots */}
        <View style={s.dots}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[
                s.dot,
                {
                  backgroundColor: i === index ? colors.foreground : colors.border,
                  width: i === index ? 24 : 8,
                },
              ]}
            />
          ))}
        </View>

        <Text style={[s.heading, { color: colors.foreground }]}>{item.heading}</Text>
        <Text style={[s.sub, { color: colors.mutedForeground }]}>{item.sub}</Text>
      </View>

      {/* Illustration area */}
      <View style={s.illusArea}>{item.illustration(colors)}</View>
    </View>
  );

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
     <View style={[s.innerContainer, { maxWidth: Platform.OS === "web" ? MAX_MOBILE_W : undefined, paddingTop: topPad }]}>
      {/* Top bar — skip + theme toggle */}
      <View style={[s.topBar, { paddingTop: 8 }]}>
        {!isLast ? (
          <TouchableOpacity onPress={finishOnboarding}>
            <Text style={[s.skipText, { color: colors.mutedForeground }]}>Skip</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
        <TouchableOpacity
          onPress={toggleTheme}
          style={[s.themeBtn, { borderColor: colors.border }]}
        >
          <Feather name={isDark ? "sun" : "moon"} size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      {/* Slides */}
      <FlatList
        ref={flatListRef}
        data={SLIDES}
        renderItem={renderSlide}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        scrollEventThrottle={32}
        getItemLayout={(_, index) => ({ length: SCREEN_W, offset: SCREEN_W * index, index })}
        style={{ flex: 1, maxWidth: SCREEN_W }}
      />

      {/* Bottom area */}
      <View style={[s.bottomArea, { paddingBottom: bottomPad + 20, width: SCREEN_W }]}>
        {isLast ? (
          <View style={s.authButtons}>
            <TouchableOpacity
              style={[s.primaryBtn, { backgroundColor: colors.foreground }]}
              onPress={async () => {
                await AsyncStorage.setItem(ONBOARDING_KEY, "1");
                router.push("/auth/dynamic-onboarding");
              }}
              activeOpacity={0.85}
            >
              <Text style={[s.primaryBtnText, { color: colors.background }]}>Get Started</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <NextButton progress={progress} onPress={goNext} colors={colors} />
        )}
      </View>
     </View>
    </View>
  );
}

/* ─── Styles ─── */
const s = StyleSheet.create({
  /* The product, quoted. Same card, same hairline, same figures as the screens
     these fragments come from - so arriving at one is recognising it. */
  proof: { width: "100%", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  proofLine: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingVertical: 9,
  },
  proofK: { fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_400Regular" },
  proofV: { fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_500Medium" },
  proofVStrong: { fontSize: 16, lineHeight: 22, fontFamily: "Inter_700Bold" },
  proofRule: { height: StyleSheet.hairlineWidth, marginVertical: 4 },

  proofRow: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 13 },
  proofMarkSlot: { width: 28, alignItems: "center" },
  proofMark: { width: 19, height: 19 },
  proofTitle: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
  proofSub: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular", marginTop: 1 },
  proofAmt: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_600SemiBold" },


  container: { flex: 1, alignItems: Platform.OS === "web" ? "center" : undefined },
  innerContainer: { flex: 1, width: "100%" },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    zIndex: 10,
  },
  skipText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  themeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  /* Slide */
  slide: {
    flex: 1,
  },
  illusArea: {
    flex: 1,
    minHeight: 300,
  },
  textArea: {
    paddingHorizontal: 28,
    paddingTop: 16,
    paddingBottom: 20,
  },

  /* Dots */
  dots: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 24,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },

  /* Heading */
  heading: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    lineHeight: 40,
    letterSpacing: -0.5,
    marginBottom: 12,
  },
  sub: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },

  /* Bottom */
  bottomArea: {
    alignItems: "center",
    paddingTop: 8,
  },

  /* Next button */
  nextBtnOuter: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  ringSvg: {
    position: "absolute",
  },
  nextBtnInner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },

  /* Auth buttons (last slide) */
  authButtons: {
    width: "100%",
    paddingHorizontal: 24,
    gap: 12,
  },
  primaryBtn: {
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  secondaryBtn: {
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { fontSize: 17, fontFamily: "Inter_600SemiBold" },

  /* ─── Illustration shared ─── */

  /* Coins */

  /* Naira */

  /* Arrows */

  /* Wallet badge */

  /* Chain coins */

  /* Center logo */

  /* Bank */

  /* Bills */

  /* Last slide logo */
});
