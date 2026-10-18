import React, { useEffect, useRef } from "react";
import { StyleSheet, Animated, Easing, View } from "react-native";

const BG = "#0a0a0a";
const ACCENT = "#81FB02";

/**
 * The opening.
 *
 * One mark, one wordmark, one line - entering together and leaving together.
 * What was here before had five token logos orbiting a ring, a pulsing logo
 * and a glow behind it: four separate animations competing for a second and a
 * half, which reads as a screensaver rather than a brand.
 *
 * Everything is native-driven and pure JS, so it still ships over the air.
 */
export function AnimatedSplash({ onFinish }: { onFinish: () => void }) {
  const markIn = useRef(new Animated.Value(0)).current;
  const lineIn = useRef(new Animated.Value(0)).current;
  const tagIn = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const sequence = Animated.sequence([
      // The mark arrives with weight, not a bounce.
      Animated.timing(markIn, {
        toValue: 1,
        duration: 520,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: true,
      }),
      Animated.parallel([
        // A rule that draws itself: the only thing on screen that says the app
        // is doing something, and it says it without spinning.
        Animated.timing(lineIn, {
          toValue: 1,
          duration: 620,
          delay: 120,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
          useNativeDriver: true,
        }),
        Animated.timing(tagIn, {
          toValue: 1,
          duration: 520,
          delay: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(420),
      // Out on a slight lift, so the app feels like it is underneath rather
      // than replacing it.
      Animated.timing(exit, {
        toValue: 1,
        duration: 420,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    let finished = false;
    const finishOnce = () => {
      if (finished) return;
      finished = true;
      onFinish();
    };

    sequence.start(finishOnce);
    // Backstop: never let a stalled or interrupted animation strand the splash.
    const timer = setTimeout(finishOnce, 4000);

    return () => {
      clearTimeout(timer);
      sequence.stop();
    };
  }, []);

  const opacity = exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const lift = exit.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });

  return (
    <Animated.View pointerEvents="none" style={[styles.container, { opacity }]}>
      <Animated.View style={{ alignItems: "center", transform: [{ scale: lift }] }}>
        <Animated.Image
          source={require("@/assets/images/newlogofull.png")}
          style={[
            styles.lockup,
            {
              opacity: markIn,
              transform: [
                { scale: markIn.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
              ],
            },
          ]}
          resizeMode="contain"
        />

        <View style={styles.lineTrack}>
          <Animated.View
            style={[
              styles.line,
              {
                opacity: lineIn,
                transform: [{ scaleX: lineIn }],
              },
            ]}
          />
        </View>

        <Animated.Text style={[styles.tag, { opacity: tagIn }]}>
          THE SMARTER WAY TO MOVE MONEY
        </Animated.Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
  },
  /**
   * The lockup is a square file with the mark and wordmark sitting in a band
   * across its middle, so fitting it to a wide box would shrink it to the box
   * height. It gets a square box instead, and the empty space above and below
   * is pulled back in so the rule underneath sits where it looks right.
   */
  lockup: { width: 300, height: 300, marginTop: -104, marginBottom: -104 },
  // Fixed width so the rule grows from the middle out, rather than the track
  // resizing under it.
  lineTrack: { width: 64, height: 2, marginTop: 10, overflow: "hidden" },
  line: { width: "100%", height: 2, borderRadius: 1, backgroundColor: ACCENT },
  tag: {
    marginTop: 18,
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: 2.4,
    fontFamily: "Inter_600SemiBold",
    color: "#6b6b6b",
  },
});
