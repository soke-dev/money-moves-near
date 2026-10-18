import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Dimensions, Easing, StyleSheet, View } from "react-native";

/**
 * Paper, thrown once.
 *
 * Built from the Animated API rather than a confetti package: this is twenty
 * rectangles falling, and a native module for that would cost a rebuild - so
 * every change to the screen it lives on would stop being an over-the-air
 * update.
 *
 * Every value it animates is opacity or transform, so the whole thing runs on
 * the native driver and keeps going while the JS thread is busy doing what the
 * screen actually came to do: refreshing a balance and reloading a list.
 *
 * It falls once and stops. Looping confetti stops reading as a moment and
 * starts reading as a background.
 */

const COLOURS = ["#81FB02", "#FFFFFF", "#4C7A17", "#C9E8A0"];
const COUNT = 22;
const FALL_MS = 2600;

type Piece = {
  x: number;
  size: number;
  colour: string;
  delay: number;
  drift: number;
  spins: number;
  thin: boolean;
};

export function Confetti({ run = true }: { run?: boolean }) {
  const { width, height } = Dimensions.get("window");
  const t = useRef(new Animated.Value(0)).current;

  /**
   * Fixed on the first render.
   *
   * Randomising inside the render would deal a new hand on every parent
   * update - the balance refresh that follows a claim is several - and the
   * paper would jump sideways mid-fall.
   */
  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: COUNT }, () => ({
        x: Math.random() * width,
        size: 6 + Math.random() * 7,
        colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
        delay: Math.random() * 0.35,
        drift: (Math.random() - 0.5) * 140,
        spins: 1 + Math.random() * 3,
        thin: Math.random() > 0.5,
      })),
    [width],
  );

  useEffect(() => {
    if (!run) return;
    t.setValue(0);
    Animated.timing(t, {
      toValue: 1,
      duration: FALL_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [run, t]);

  if (!run) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((p, i) => {
        // Each piece reads the same clock from its own starting point, so they
        // do not fall as one sheet.
        const span = [p.delay, Math.min(p.delay + 0.75, 1)];
        const fall = t.interpolate({
          inputRange: span,
          outputRange: [-40, height + 60],
          extrapolate: "clamp",
        });
        const sway = t.interpolate({
          inputRange: [span[0], (span[0] + span[1]) / 2, span[1]],
          outputRange: [0, p.drift, 0],
          extrapolate: "clamp",
        });
        const spin = t.interpolate({
          inputRange: span,
          outputRange: ["0deg", `${p.spins * 360}deg`],
          extrapolate: "clamp",
        });
        // Gone before it reaches the bottom, so nothing piles up at the edge.
        const fade = t.interpolate({
          inputRange: [span[0], span[0] + 0.05, span[1] - 0.2, span[1]],
          outputRange: [0, 1, 1, 0],
          extrapolate: "clamp",
        });

        return (
          <Animated.View
            key={i}
            style={{
              position: "absolute",
              left: p.x,
              top: 0,
              width: p.thin ? p.size * 0.45 : p.size,
              height: p.size,
              borderRadius: p.thin ? 1 : 2,
              backgroundColor: p.colour,
              opacity: fade,
              transform: [{ translateY: fall }, { translateX: sway }, { rotate: spin }],
            }}
          />
        );
      })}
    </View>
  );
}
