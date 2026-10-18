import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Modal,
  Animated,
  Easing,
  StyleSheet,
  Image,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { isDynamicWebViewVisible, subscribeDynamicWebView } from "@/config/dynamic";
import { TokenLogo } from "@/components/TokenLogo";
import { assetLabel } from "@/constants/transfer";

type Variant = "buy" | "sell" | "send" | "withdraw" | "bill";

type Step = { icon: string; text: string };

interface Props {
  visible: boolean;
  variant?: Variant;
  asset?: string;
  chain?: string;
  amount?: string;
  label?: string;
  currentStep?: number;
  steps?: Step[];
}

const CHAIN_LOGOS: Record<string, any> = {
  MOVE: require("@/assets/images/movementnew.jpg"),
  SOL: require("@/assets/images/solana.png"),
  BASE: require("@/assets/images/base logo.png"),
  BEP20: require("@/assets/images/bsc logo.png"),
  ARC: require("@/assets/images/ARC.jpg"),
  TON: require("@/assets/images/toncoin.png"),
  STELLAR: require("@/assets/images/stellar.jpg"),
  MONAD: require("@/assets/images/monad.png"),
  ARB: require("@/assets/images/arbitrumlogo.png"),
  ETH: require("@/assets/images/eth.png"),
};

const DEFAULT_STEPS: Record<Variant, Step[]> = {
  sell: [
    { icon: "radio", text: "Resolving wallet..." },
    { icon: "shield", text: "Preparing transaction..." },
    { icon: "cpu", text: "Signing transaction..." },
    { icon: "send", text: "Broadcasting to network..." },
    { icon: "dollar-sign", text: "Initiating bank transfer..." },
    { icon: "check-circle", text: "Wrapping up..." },
  ],
  buy: [
    { icon: "credit-card", text: "Verifying payment..." },
    { icon: "radio", text: "Resolving wallet..." },
    { icon: "send", text: "Sending tokens to wallet..." },
    { icon: "check-circle", text: "Confirming on blockchain..." },
  ],
  send: [
    { icon: "radio", text: "Resolving wallet..." },
    { icon: "shield", text: "Preparing transfer..." },
    { icon: "cpu", text: "Signing transaction..." },
    { icon: "send", text: "Broadcasting to network..." },
    { icon: "check-circle", text: "Wrapping up..." },
  ],
  withdraw: [
    { icon: "radio", text: "Resolving wallet..." },
    { icon: "shield", text: "Preparing withdrawal..." },
    { icon: "cpu", text: "Signing transaction..." },
    { icon: "send", text: "Broadcasting to network..." },
    { icon: "check-circle", text: "Wrapping up..." },
  ],
  bill: [
    { icon: "radio", text: "Resolving wallet..." },
    { icon: "shield", text: "Preparing payment..." },
    { icon: "cpu", text: "Signing transaction..." },
    { icon: "send", text: "Broadcasting to network..." },
    { icon: "check-circle", text: "Confirming with provider..." },
  ],
};

// Shorten long token amounts (e.g. "0.40659340659340659") to a tidy value with
// at most 3 decimals and no trailing zeros. Already-formatted strings (e.g.
// "₦500" or "1,000.00") aren't plain numbers, so they're returned untouched.
function formatAmount(raw?: string): string | undefined {
  if (!raw) return raw;
  const n = Number(raw);
  if (!isFinite(n)) return raw;
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(3).replace(/\.?0+$/, "");
}

export default function TransactionProcessingOverlay({
  visible,
  variant = "send",
  asset = "USDC",
  chain = "MOVE",
  amount,
  currentStep = 0,
  steps,
}: Props) {
  const colors = useColors();
  const allSteps = steps ?? DEFAULT_STEPS[variant];
  const safeIndex = Math.min(currentStep, allSteps.length - 1);
  const step = allSteps[safeIndex];

  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const stepFade = useRef(new Animated.Value(1)).current;

  const accent = colors.primary;
  const chainLogo = CHAIN_LOGOS[chain];

  // Continuous spinner + gentle logo pulse
  useEffect(() => {
    if (!visible) return;

    const spinLoop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.05, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    spinLoop.start();
    pulseLoop.start();

    return () => {
      spinLoop.stop();
      pulseLoop.stop();
      spin.setValue(0);
      pulse.setValue(1);
    };
  }, [visible]);

  // Smoothly grow the progress bar and cross-fade the step label as steps advance
  useEffect(() => {
    Animated.timing(progress, {
      toValue: (safeIndex + 1) / allSteps.length,
      duration: 450,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    stepFade.setValue(0);
    Animated.timing(stepFade, { toValue: 1, duration: 280, useNativeDriver: true }).start();
  }, [safeIndex, allSteps.length]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const progressWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });

  // Step aside while the Dynamic signer needs the screen.
  //
  // This overlay is a Modal, and on iOS a Modal is its own window sitting above
  // the root view - so it would cover the signing WebView no matter how high we
  // raise that WebView's zIndex, hiding any approval step and leaving the user
  // staring at a spinner they cannot resolve.
  const [signerOnScreen, setSignerOnScreen] = useState(isDynamicWebViewVisible);
  useEffect(() => subscribeDynamicWebView(setSignerOnScreen), []);

  if (!visible || signerOnScreen) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.backdrop} pointerEvents="box-only">
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          {/* ── Spinner + token logo ── */}
          <View style={styles.logoArea}>
            <Animated.View
              style={[
                styles.spinnerArc,
                { borderTopColor: accent, borderRightColor: accent, transform: [{ rotate }] },
              ]}
            />
            <Animated.View
              style={[styles.logoCircle, { backgroundColor: accent + "14", transform: [{ scale: pulse }] }]}
            >
              <TokenLogo symbol={asset} size={44} />
            </Animated.View>
          </View>

          {/* ── Title ── */}
          <Text style={[styles.title, { color: colors.foreground }]}>Processing</Text>

          {/* ── Amount ── */}
          {amount ? (
            <Text style={[styles.amount, { color: colors.foreground }]}>
              {formatAmount(amount)} <Text style={{ color: accent }}>{assetLabel(asset)}</Text>
            </Text>
          ) : null}

          {/* ── Progress bar ── */}
          <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
            <Animated.View style={[styles.progressFill, { backgroundColor: accent, width: progressWidth }]} />
          </View>

          {/* ── Current step (chain logo + status) ── */}
          <Animated.View style={[styles.stepRow, { opacity: stepFade }]}>
            {chainLogo ? (
              <Image source={chainLogo} style={styles.stepChainLogo} resizeMode="cover" />
            ) : (
              <Feather name={step.icon as any} size={13} color={accent} />
            )}
            <Text style={[styles.stepText, { color: colors.mutedForeground }]}>{step.text}</Text>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  card: {
    width: "100%",
    maxWidth: 300,
    borderRadius: 28,
    paddingVertical: 32,
    paddingHorizontal: 28,
    alignItems: "center",
  },
  logoArea: {
    width: 96,
    height: 96,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
  },
  spinnerArc: {
    position: "absolute",
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: "transparent",
  },
  logoCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
  },
  amount: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
    marginTop: 6,
  },
  progressTrack: {
    width: "72%",
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
    marginTop: 22,
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 14,
  },
  stepChainLogo: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  stepText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
});
