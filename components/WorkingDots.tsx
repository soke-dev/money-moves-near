import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

/**
 * Three dots that rise and fall in turn, for a control that is busy but still
 * has something to say.
 *
 * This exists because the alternative - an ActivityIndicator - takes the
 * label's place. A button that said "Create account" goes blank at the exact
 * moment the person starts wondering whether it heard them. The dots sit
 * beside the words instead, so nothing is given up to show the wait.
 *
 * Every dot runs the same sequence, offset by its own delay and padded by the
 * remainder, so all three cycles are exactly PERIOD long and never drift apart
 * over a long wait. Transform and opacity only, so this stays on the native
 * driver - which matters, because the JS thread is usually busy with whatever
 * the button is waiting for.
 */
const PERIOD = 1050;
const STAGGER = 140;
const RISE = 300;

export function WorkingDots({
  color,
  size = 4,
  lift = 4,
}: {
  color: string;
  size?: number;
  lift?: number;
}) {
  const anims = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const loops = anims.map((a, i) => {
      const offset = i * STAGGER;
      return Animated.loop(
        Animated.sequence([
          Animated.delay(offset),
          Animated.timing(a, {
            toValue: 1,
            duration: RISE,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(a, {
            toValue: 0,
            duration: RISE,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay(PERIOD - offset - RISE * 2),
        ]),
      );
    });
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [anims]);

  return (
    <View style={[s.row, { gap: size - 1 }]}>
      {anims.map((a, i) => (
        <Animated.View
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
            opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.28, 1] }),
            transform: [
              { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, -lift] }) },
            ],
          }}
        />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
});
