import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  Animated,
  Easing,
  StyleProp,
  ViewStyle,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

/** Status colours, so a track and the pill above it can never disagree. */
export const STAGE_DONE = "#22c55e";
export const STAGE_PENDING = "#f59e0b";
export const STAGE_FAILED = "#ef4444";

export interface Stage {
  label: string;
  /**
   * How the mark is drawn - a knocked-out disc for the send-off, a dot for the
   * middle, the badge artwork for the end.
   */
  kind: "sent" | "dot" | "badge" | "failed";
  color: string;
}

/**
 * Barber-pole geometry.
 *
 * Enough stripes to overrun the widest connector the layout can produce, since
 * flex:1 means nobody knows how wide that is - cheaper than measuring, and a
 * few dozen 4pt views cost nothing.
 */
const STRIPE_W = 4;
const STRIPE_GAP = 5;
const STRIPE_PERIOD = STRIPE_W + STRIPE_GAP;
const STRIPES = Array.from({ length: 40 }, (_, i) => i);

/** The most stages any flow produces. */
const MAX_STAGES = 4;

/**
 * Where a transaction has got to, on one row.
 *
 * Shared by the transaction sheet and the live progress screen so a purchase
 * looks the same while it is happening as it does afterwards - the same marks
 * in the same places, rather than a spinner that gives way to a summary the
 * user has to re-read.
 */
export function StageTrack({
  stages,
  style,
}: {
  stages: Stage[];
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const idle = colors.foreground + "B3";

  const stageIn = useRef<Animated.Value[]>(
    Array.from({ length: MAX_STAGES }, () => new Animated.Value(0)),
  ).current;
  const crawl = useRef(new Animated.Value(0)).current;

  /**
   * Replays as stages arrive.
   *
   * Keyed on the count rather than on mount, so a stage appearing while the
   * screen is open animates in with the rest instead of popping.
   */
  useEffect(() => {
    Animated.stagger(
      85,
      stageIn.map((v) =>
        Animated.spring(v, {
          toValue: 1,
          damping: 13,
          stiffness: 170,
          mass: 0.7,
          useNativeDriver: true,
        }),
      ),
    ).start();
  }, [stages.length, stageIn]);

  /**
   * The strip shifts by exactly one stripe-and-gap then snaps back, which is
   * what makes an endless crawl out of a loop only a few points long - the
   * frame it resets on is identical to the one it started from.
   */
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(crawl, {
        toValue: 1,
        duration: 700,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [crawl]);

  return (
    <View style={[s.track, style]}>
      {stages.map((stage, i) => (
        <React.Fragment key={stage.label}>
          <Animated.View
            style={[
              s.step,
              {
                opacity: stageIn[i],
                // Grows into place rather than sliding: on one row there is
                // nowhere to slide from that does not shove its neighbours
                // around mid-animation.
                transform: [
                  { scale: stageIn[i].interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
                ],
              },
            ]}
          >
            {stage.kind === "badge" ? (
              <Image
                source={require("@/assets/images/checklist-green.png")}
                style={s.badge}
                resizeMode="contain"
              />
            ) : stage.kind === "sent" ? (
              <View style={[s.disc, { backgroundColor: stage.color }]}>
                <Feather name="arrow-up-right" size={11} color={colors.card} />
              </View>
            ) : stage.kind === "failed" ? (
              <Ionicons name="close-circle" size={18} color={stage.color} />
            ) : (
              <Ionicons name="radio-button-on" size={18} color={stage.color} />
            )}
            <Text style={[s.label, { color: stage.color }]} numberOfLines={1}>
              {stage.label}
            </Text>
          </Animated.View>

          {/* Takes whatever width is left, so the stages spread evenly however
              long their labels are. */}
          {i < stages.length - 1 && (
            <View style={[s.rail, { backgroundColor: colors.foreground + "1F" }]}>
              <Animated.View
                style={[
                  s.stripes,
                  {
                    transform: [
                      {
                        translateX: crawl.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, STRIPE_PERIOD],
                        }),
                      },
                    ],
                  },
                ]}
              >
                {STRIPES.map((k) => (
                  <View key={k} style={[s.stripe, { backgroundColor: colors.foreground + "4D" }]} />
                ))}
              </Animated.View>
            </View>
          )}
        </React.Fragment>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  track: { flexDirection: "row", alignItems: "center" },
  step: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_700Bold", letterSpacing: -0.1 },
  disc: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  badge: { width: 18, height: 18 },

  // Taller than a hairline on purpose: diagonal stripes need something to be
  // diagonal across, and at 3pt they read as noise.
  rail: { flex: 1, height: 7, borderRadius: 3.5, marginHorizontal: 8, overflow: "hidden" },
  // Starts one period to the left, so the strip still covers the rail at the
  // moment the transform has carried it a full period to the right.
  stripes: { position: "absolute", left: -STRIPE_PERIOD, top: -3, bottom: -3, flexDirection: "row" },
  // The skew is what turns a column of bars into a barber pole.
  stripe: { width: STRIPE_W, marginRight: STRIPE_GAP, transform: [{ skewX: "-20deg" }] },
});
