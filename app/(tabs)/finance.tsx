import React from "react";
import { View, Text, StyleSheet, Image, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Path } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/context/ThemeContext";
import { useApp } from "@/context/AppContext";
import { FONT_SCALE } from "@/constants/transfer";

/**
 * Finance — the shape of it, before any of it works.
 *
 * Two products, neither built. It said so in a list: two rows a third of the
 * way down a tab, each with a COMING SOON badge and a chevron pointing at a
 * screen that does not exist, and two thirds of the tab left black under them.
 *
 * So the two things are the page rather than entries on it. Each takes half
 * the screen whatever the screen is, which is what removes the dead space -
 * not more content, the same content given the room it was being denied. The
 * chevrons are gone: a row that opens nothing should not look like it does.
 */

/**
 * The label and the small print are monospaced, which is what gives this
 * screen its technical feel. Only Inter is bundled, so this is the system face
 * rather than a new font to load.
 */
const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

/**
 * The rates the two tiles work their figures out from.
 *
 * They are illustrations, and both tiles are worded so they read as one - Earn
 * says "if it were earning", Saving says "example". Neither is an offer, and
 * nothing on this screen is a quote. When the real numbers are settled, these
 * four constants are the only edit.
 */
const EARN_RATE = 0.09;              // a year, on an open balance
/**
 * Saving pays nothing, so its example quotes no rate: money put away is money
 * you get back. What the figure shows is what putting a sum aside every month
 * comes to - addition, which needs no promise behind it.
 */
const SAVE_EXAMPLE_MONTHLY = 5_000;
const SAVE_EXAMPLE_MONTHS = 6;

/** What the Earn tile falls back to before anyone has a balance. */
const EARN_EXAMPLE_NGN = 100_000;

/**
 * Whole naira, and no mark.
 *
 * The mark is drawn beside the figure as a glyph, so the string must not carry
 * one; and kobo on a projection is precision the number does not have.
 */
const naira = (n: number) => Math.round(n).toLocaleString("en-NG");

export default function FinanceScreen() {
  const colors = useColors();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const { ngnBalance } = useApp();

  /**
   * The lit tile, lit for the theme it is in.
   *
   * The wash was three fixed greens chosen against black. In light mode they
   * ran dark-green into a white card, and the caption and the COMING SOON mark
   * - both drawn in theme colours meant for a pale ground - landed on the dark
   * half and disappeared. The light set is the same idea at the other end:
   * pale enough for near-black type to sit on it.
   *
   * The artwork carries a little more weight on a pale ground, where a 10%
   * tint has nothing to stand out against.
   */
  const earnWash: readonly [string, string, string] = isDark
    ? ["#22380FCC", "#131F0BE6", colors.card]
    : ["#D9F2B0", "#EAF8D6", colors.card];
  const artOpacity = isDark ? 0.1 : 0.17;

  /**
   * Earn works off the balance the person actually holds, because a number
   * with their own money in it is the one that lands. A new account holds
   * nothing and would be shown a year's earnings of zero, so below a
   * thousand naira the tile borrows a round sum and says so.
   */
  const earnOnOwn = ngnBalance >= 1_000;
  const earnBase = earnOnOwn ? ngnBalance : EARN_EXAMPLE_NGN;
  const earnYear = earnBase * EARN_RATE;

  /** The Saving example: a sum a month, for a term. */
  const saveTotal = SAVE_EXAMPLE_MONTHLY * SAVE_EXAMPLE_MONTHS;

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      {/* A faint vector field behind everything: a dot grid with two arcs
          sweeping up through it, at a few percent opacity. At full strength a
          pattern competes with what sits on it. */}
      <View style={[s.pattern, { height: topPad + 320 }]} pointerEvents="none">
        <Svg width="100%" height="100%" viewBox="0 0 390 320">
          {Array.from({ length: 9 }).map((_, r) =>
            Array.from({ length: 12 }).map((__, c) => (
              /* Opacity falls with depth, so the grid dissolves downward
                 rather than stopping at a hard edge. */
              <Circle
                key={r + "-" + c}
                cx={10 + c * 34}
                cy={14 + r * 34}
                r={1.4}
                fill={colors.primary}
                opacity={0.16 - r * 0.016}
              />
            )),
          )}

          {/* Two rising sweeps - growth, without drawing a literal chart. */}
          <Path
            d="M-20 250 C 80 250, 120 140, 220 120 S 360 60, 420 20"
            stroke={colors.primary}
            strokeWidth={1.2}
            fill="none"
            opacity={0.22}
          />
          <Path
            d="M-20 290 C 100 290, 150 200, 250 175 S 380 120, 420 80"
            stroke={colors.primary}
            strokeWidth={1}
            fill="none"
            opacity={0.12}
          />
        </Svg>
      </View>

      <View style={[s.page, { paddingTop: topPad + 22, paddingBottom: insets.bottom + 104 }]}>
        {/* Echoes the tagline - "The Smarter Way to Move Money" - with the verb
            swapped for what this screen is about. */}
        <Text style={[s.label, { color: colors.mutedForeground }]}>THE SMARTER WAY TO GROW</Text>

        {/* ── Earn ────────────────────────────────────────────────────
            The lit one. The glow used to be a gradient washing the top of the
            screen behind the content; it is the card itself now, so the light
            on the page comes from something rather than from nowhere. */}
        <LinearGradient
          colors={earnWash}
          locations={[0, 0.55, 1]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={s.tile}
        >
          {/* Oversized and clipped by the tile, the way the loyalty card and
              the bills tiles carry their artwork. */}
          <Ionicons name="leaf" size={190} color={colors.primary} style={[s.art, { opacity: artOpacity }]} />

          <Text style={[s.status, { color: colors.primary }]}>COMING SOON</Text>

          <View style={s.tileFoot}>
            <Text style={[s.statCap, { color: colors.mutedForeground }]}>
              {`YOUR ${naira(earnBase)} AT ${(EARN_RATE * 100).toFixed(0)}%`}
            </Text>
            <View style={s.figRow}>
              {/* A glyph, not a text character: the naira mark has a crossbar
                  the system font renders through the letter at this size. */}
              <Image
                source={require("@/assets/images/nairaiconnew.png")}
                style={[s.nairaMark, { tintColor: colors.primary }]}
              />
              <Text style={[s.fig, { color: colors.primary }]} numberOfLines={1}>
                {naira(earnYear)}
              </Text>
            </View>
            <Text style={[s.statFoot, { color: colors.mutedForeground }]}>
              {earnOnOwn ? "A YEAR, ON WHAT YOU HOLD NOW" : "A YEAR \u00B7 EXAMPLE BALANCE"}
            </Text>

            <View style={[s.seam, { backgroundColor: colors.border }]} />

            <Text style={[s.title, { color: colors.foreground }]}>Earn</Text>
            <Text style={[s.sub, { color: colors.mutedForeground }]}>
              Grow the money you hold
            </Text>
          </View>
        </LinearGradient>

        {/* ── Saving ─────────────────────────────────────────────── */}
        <View style={[s.tile, { backgroundColor: colors.card }]}>
          <Image
            source={require("@/assets/images/piggy-bank.png")}
            style={[s.art, s.artImg, { tintColor: colors.primary, opacity: artOpacity }]}
          />

          <Text style={[s.status, { color: colors.mutedForeground }]}>COMING SOON</Text>

          <View style={s.tileFoot}>
            <Text style={[s.statCap, { color: colors.mutedForeground }]}>
              {`PUT ${naira(SAVE_EXAMPLE_MONTHLY)} AWAY A MONTH`}
            </Text>
            <View style={s.figRow}>
              <Image
                source={require("@/assets/images/nairaiconnew.png")}
                style={[s.nairaMark, { tintColor: colors.foreground }]}
              />
              <Text style={[s.fig, { color: colors.foreground }]} numberOfLines={1}>
                {naira(saveTotal)}
              </Text>
            </View>
            <Text style={[s.statFoot, { color: colors.mutedForeground }]}>
              {`IN ${SAVE_EXAMPLE_MONTHS} MONTHS \u00B7 EXAMPLE`}
            </Text>

            <View style={[s.seam, { backgroundColor: colors.border }]} />

            <Text style={[s.title, { color: colors.foreground }]}>Saving</Text>
            <Text style={[s.sub, { color: colors.mutedForeground }]}>
              Put money away for later
            </Text>
          </View>
        </View>

        <Text style={[s.footer, { color: colors.mutedForeground }]}>
          We&apos;re building it. We&apos;ll let you know when it lands.
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  pattern: { position: "absolute", top: 0, left: 0, right: 0 },

  // A column, not a scroller: there is nothing here to scroll to, and a
  // ScrollView over content shorter than the screen is where the empty two
  // thirds came from.
  page: { flex: 1, paddingHorizontal: 16 },

  label: {
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 2.2,
    paddingHorizontal: 8,
    marginBottom: 14,
  },

  // flex: 1 on both, so the two split whatever height the device has and the
  // page fills itself on a small phone and a tall one alike.
  tile: {
    flex: 1,
    borderRadius: 24,
    padding: 20,
    marginBottom: 12,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  art: { position: "absolute", right: -34, top: -26, opacity: 0.1 },
  artImg: { width: 190, height: 190, resizeMode: "contain" },

  // Top-left, opposite the artwork, so the two corners of the tile are doing
  // different jobs and neither is empty.
  status: {
    position: "absolute",
    top: 20,
    left: 20,
    fontFamily: MONO,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.6,
  },

  tileFoot: { gap: 0 },

  statCap: { fontFamily: MONO, fontSize: 9.5, lineHeight: 13, letterSpacing: 1.6 },
  figRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 7 },
  // Box, not glyph: `contain` scales the mark's transparent margin too, so it
  // fills about two thirds of what is set here. 30 lands it on the cap height
  // of the 28pt figure; the lift puts it on their baseline.
  nairaMark: { width: 30 * FONT_SCALE, height: 30 * FONT_SCALE, resizeMode: "contain", marginRight: -4 * FONT_SCALE, marginBottom: 3 * FONT_SCALE },
  fig: { fontSize: 28, lineHeight: 34, fontFamily: "Inter_800ExtraBold", letterSpacing: -1, flexShrink: 1 },
  statFoot: { fontFamily: MONO, fontSize: 10, lineHeight: 14, letterSpacing: 1.1, marginTop: 5 },

  // The figures are what this product would do; the name is what it is called.
  // A rule between them stops the two blocks reading as one paragraph.
  seam: { height: StyleSheet.hairlineWidth, marginTop: 14, marginBottom: 13 },

  title: { fontSize: 26, lineHeight: 32, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.9 },
  sub: { fontFamily: MONO, fontSize: 12, lineHeight: 17, marginTop: 3 },

  // Monospaced like the label, so the two quiet lines on the screen belong to
  // each other.
  footer: {
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    paddingHorizontal: 30,
    marginTop: 4,
  },
});
