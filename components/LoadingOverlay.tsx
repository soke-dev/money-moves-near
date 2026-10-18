import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Platform,
  Image,
} from "react-native";
import { BlurView } from "expo-blur";
import Svg, { Circle } from "react-native-svg";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  label?: string;
}

/**
 * The ring is drawn rather than bordered.
 *
 * It used to be a square View with borderTopColor set, which is the usual
 * trick and gives a quarter arc with two hard corners. Those corners are what
 * made it read as ticking round rather than sweeping: the eye catches each
 * square edge as it passes. An SVG arc with a round cap has no edge to catch,
 * so the same rotation now reads as continuous.
 *
 * Two arcs, not one. The lead arc eases in and out of every revolution, which
 * gives the motion a pulse instead of a machine's constant speed - the turn is
 * seamless because an inOut curve has zero velocity at both ends, so 360 meets
 * 0 without a jolt. On its own that pause at the top of the cycle would look
 * like a stall, so a thinner arc turns the other way at a steady speed behind
 * it, and something is always moving.
 *
 * Everything animated here is a transform or an opacity, so all of it runs on
 * the native driver. That is the whole point: this overlay is on screen
 * precisely while the JS thread is busy signing, fetching or hashing, and an
 * indicator that stutters during the work it is covering for is worse than
 * none.
 */
const SIZE = 66;
const STROKE = 2.5;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;
const LEAD = C * 0.36;
const TRAIL = C * 0.1;

export function LoadingOverlay({ visible, label = "Just a moment" }: Props) {
  const colors = useColors();
  const lead = useRef(new Animated.Value(0)).current;
  const trail = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;

  // Kept mounted through the fade out. Returning null the moment `visible`
  // went false used to throw the exit animation away before a frame of it had
  // drawn, so the card vanished instead of leaving.
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      const spins = [
        Animated.loop(
          Animated.timing(lead, {
            toValue: 1,
            duration: 1500,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ),
        Animated.loop(
          Animated.timing(trail, {
            toValue: 1,
            duration: 2600,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        ),
      ];
      spins.forEach((a) => a.start());
      Animated.parallel([
        Animated.timing(fade, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(rise, {
          toValue: 1,
          damping: 16,
          stiffness: 210,
          mass: 0.7,
          useNativeDriver: true,
        }),
      ]).start();
      return () => spins.forEach((a) => a.stop());
    }

    Animated.parallel([
      Animated.timing(fade, {
        toValue: 0,
        duration: 160,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(rise, {
        toValue: 0,
        duration: 160,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [visible]);

  if (!mounted) return null;

  const spin = (v: Animated.Value, back = false) =>
    v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", back ? "-360deg" : "360deg"] });

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, s.container, { opacity: fade }]}
      pointerEvents="auto"
    >
      {Platform.OS !== "web" ? (
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.6)" }]} />
      )}

      <Animated.View
        style={[
          s.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            transform: [
              { scale: rise.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
            ],
          },
        ]}
      >
        <View style={s.ring}>
          <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
            <Circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              stroke={colors.muted}
              strokeWidth={1.5}
              fill="none"
            />
          </Svg>

          <Animated.View
            style={[StyleSheet.absoluteFill, { transform: [{ rotate: spin(trail, true) }] }]}
          >
            <Svg width={SIZE} height={SIZE}>
              <Circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                stroke={colors.primary}
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={`${TRAIL} ${C - TRAIL}`}
                strokeOpacity={0.35}
                fill="none"
              />
            </Svg>
          </Animated.View>

          <Animated.View
            style={[StyleSheet.absoluteFill, { transform: [{ rotate: spin(lead) }] }]}
          >
            <Svg width={SIZE} height={SIZE}>
              <Circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                stroke={colors.primary}
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={`${LEAD} ${C - LEAD}`}
                fill="none"
              />
            </Svg>
          </Animated.View>

          <Image source={require("@/assets/images/logo-badge.png")} style={s.logo} />
        </View>

        <Text style={[s.label, { color: colors.foreground }]}>{label}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  container: { zIndex: 999, alignItems: "center", justifyContent: "center" },
  card: {
    paddingHorizontal: 30,
    paddingVertical: 26,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    gap: 18,
    minWidth: 196,
  },
  ring: {
    width: SIZE,
    height: SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  label: { fontSize: 14.5, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
});
