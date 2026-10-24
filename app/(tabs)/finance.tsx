import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  Platform,
  TouchableOpacity,
  Modal,
  Pressable,
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import Svg, { Circle, Path } from "react-native-svg";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/context/ThemeContext";

/**
 * Finance: four tiles, two to a row, the way Bills lays its cards out, in this
 * tab's own clothes - the dot field behind, monospaced small print, oversized
 * artwork clipped by each tile.
 *
 * Swap and Business open things; Saving and Earn are still being built and say
 * so. Each tile is the Bills card's height; stretched to fill the screen they
 * read as posters rather than as things to tap.
 */

/**
 * The label and the small print are monospaced, which is what gives this
 * screen its technical feel. Only Inter is bundled, so this is the system face
 * rather than a new font to load.
 */
const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

/** The marketing site, opened on its Business view. */
const BUSINESS_SITE = "https://usemoneymoves.xyz/?for=business";

export default function FinanceScreen() {
  const colors = useColors();
  const { isDark } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const [showBusiness, setShowBusiness] = useState(false);

  /**
   * The lit tile, lit for the theme it is in: deep greens against black, pale
   * ones under near-black type in the light.
   */
  const litWash: readonly [string, string, string] = isDark
    ? ["#22380FCC", "#131F0BE6", colors.card]
    : ["#D9F2B0", "#EAF8D6", colors.card];
  const artOpacity = isDark ? 0.1 : 0.17;

  const tileBody = (opts: { status: string; statusColor: string; title: string; sub: string; live?: boolean }) => (
    <>
      <View style={s.tileTop}>
        <Text style={[s.status, { color: opts.statusColor }]} numberOfLines={1}>
          {opts.status}
        </Text>
      </View>
      <View>
        <View style={s.titleRow}>
          <Text style={[s.title, { color: colors.foreground }]} numberOfLines={1}>
            {opts.title}
          </Text>
          {opts.live && <Feather name="arrow-up-right" size={18} color={colors.foreground} />}
        </View>
        <Text style={[s.sub, { color: colors.mutedForeground }]} numberOfLines={2}>
          {opts.sub}
        </Text>
      </View>
    </>
  );

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      {/* A faint vector field behind everything: a dot grid with two arcs
          sweeping up through it, at a few percent opacity. */}
      <View style={[s.pattern, { height: topPad + 320 }]} pointerEvents="none">
        <Svg width="100%" height="100%" viewBox="0 0 390 320">
          {Array.from({ length: 9 }).map((_, r) =>
            Array.from({ length: 12 }).map((__, c) => (
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
        <Text style={[s.label, { color: colors.mutedForeground }]}>THE SMARTER WAY TO GROW</Text>

        <View style={s.row}>
          {/* ── Swap: the lit one, because it is the one that works today. */}
          <TouchableOpacity style={s.cell} activeOpacity={0.85} onPress={() => router.push("/swap" as any)}>
            <LinearGradient
              colors={litWash}
              locations={[0, 0.55, 1]}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={s.tile}
            >
              <Feather name="repeat" size={ART} color={colors.primary} style={[s.art, { opacity: artOpacity }]} />
              {tileBody({
                status: "ANY COIN, ANY CHAIN",
                statusColor: colors.primary,
                title: "Swap",
                sub: "Move between coins and chains",
                live: true,
              })}
            </LinearGradient>
          </TouchableOpacity>

          {/* ── Money Moves Business: explained in a sheet, then the website. */}
          <TouchableOpacity style={s.cell} activeOpacity={0.85} onPress={() => setShowBusiness(true)}>
            <View style={[s.tile, { backgroundColor: colors.card }]}>
              <Image
                source={require("@/assets/images/store.png")}
                style={[s.art, s.artImg, { tintColor: colors.primary, opacity: artOpacity }]}
              />
              {tileBody({
                status: "MONEY MOVES",
                statusColor: colors.mutedForeground,
                title: "Business",
                sub: "Accept payments, settle instantly",
                live: true,
              })}
            </View>
          </TouchableOpacity>
        </View>

        <View style={s.row}>
          {/* ── Still being built: no press, no chevron. */}
          <View style={s.cell}>
            <View style={[s.tile, { backgroundColor: colors.card }]}>
              <Image
                source={require("@/assets/images/piggy-bank.png")}
                style={[s.art, s.artImg, { tintColor: colors.primary, opacity: artOpacity }]}
              />
              {tileBody({
                status: "COMING SOON",
                statusColor: colors.mutedForeground,
                title: "Saving",
                sub: "Put money away for later",
              })}
            </View>
          </View>

          <View style={s.cell}>
            <View style={[s.tile, { backgroundColor: colors.card }]}>
              <Ionicons name="leaf" size={ART} color={colors.primary} style={[s.art, { opacity: artOpacity }]} />
              {tileBody({
                status: "COMING SOON",
                statusColor: colors.mutedForeground,
                title: "Earn",
                sub: "Grow the money you hold",
              })}
            </View>
          </View>
        </View>
      </View>

      {/* Money Moves Business, as a card floating clear of the edges, the same
          way Home's sheets do it. It fades in with the modal rather than
          sliding: a Reanimated layout animation inside a Modal is the suspected
          cause of the October Android crash, so none is used here. */}
      {showBusiness && (
        <Modal transparent animationType="fade" visible statusBarTranslucent onRequestClose={() => setShowBusiness(false)}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowBusiness(false)}>
            {Platform.OS === "ios" ? (
              <BlurView intensity={22} tint="dark" style={StyleSheet.absoluteFill} />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.62)" }]} />
            )}
          </Pressable>

          <View style={s.sheetDock} pointerEvents="box-none">
            <View
              style={[
                s.sheet,
                { backgroundColor: colors.card, borderColor: colors.border, marginBottom: (insets.bottom || 12) + 10 },
              ]}
            >
              <View style={s.sheetHead}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.sheetEyebrow, { color: colors.primary }]}>MONEY MOVES BUSINESS</Text>
                  <Text style={[s.sheetTitle, { color: colors.foreground }]}>Accept payments. Settle instantly.</Text>
                </View>
                <TouchableOpacity
                  style={[s.sheetClose, { backgroundColor: colors.background }]}
                  onPress={() => setShowBusiness(false)}
                  hitSlop={8}
                >
                  <Feather name="x" size={16} color={colors.foreground} />
                </TouchableOpacity>
              </View>

              <Text style={[s.sheetBody, { color: colors.mutedForeground }]}>
                The payments platform for businesses and freelancers. Accept stablecoins and local fiat from your
                customers, with every payment settled instantly to your self custody wallet or your bank account.
              </Text>

              <View style={[s.points, { borderColor: colors.border }]}>
                {[
                  "Checkout, payment links and invoices",
                  "Instant settlement in stablecoins or local fiat",
                  "Self custody, so your funds stay under your control",
                  "Developer API and plugins for your website",
                ].map((line, i) => (
                  <View
                    key={line}
                    style={[s.point, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
                  >
                    <Feather name="check" size={15} color={colors.primary} />
                    <Text style={[s.pointText, { color: colors.foreground }]}>{line}</Text>
                  </View>
                ))}
              </View>

              <TouchableOpacity
                style={[s.cta, { backgroundColor: colors.primary }]}
                activeOpacity={0.85}
                onPress={() => {
                  setShowBusiness(false);
                  Linking.openURL(BUSINESS_SITE).catch(() => {});
                }}
              >
                <Text style={[s.ctaText, { color: colors.primaryForeground }]}>Visit website</Text>
                <Feather name="arrow-up-right" size={17} color={colors.primaryForeground} />
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const TILE_H = 152;
const ART = 96;

const s = StyleSheet.create({
  root: { flex: 1 },
  pattern: { position: "absolute", top: 0, left: 0, right: 0 },

  // A column, not a scroller: four tiles fit on any phone.
  page: { flex: 1, paddingHorizontal: 16 },

  label: {
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 2.2,
    paddingHorizontal: 8,
    marginBottom: 14,
  },

  // The Bills card size, so the two grids in the app read as one family.
  row: { flexDirection: "row", gap: 12, marginBottom: 12 },
  cell: { flex: 1 },
  tile: {
    height: TILE_H,
    borderRadius: 20,
    padding: 16,
    justifyContent: "space-between",
    overflow: "hidden",
  },
  // Oversized and clipped by the tile, so it reads as texture rather than as an icon.
  art: { position: "absolute", right: -16, top: -14 },
  artImg: { width: ART, height: ART, resizeMode: "contain" },

  tileTop: { minHeight: 14 },
  status: { fontFamily: MONO, fontSize: 9.5, lineHeight: 13, letterSpacing: 1.4 },

  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  title: { fontSize: 23, lineHeight: 29, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.8, flexShrink: 1 },
  sub: { fontFamily: MONO, fontSize: 11, lineHeight: 15, marginTop: 4 },

  sheetDock: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    marginHorizontal: 12,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  sheetHead: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  sheetEyebrow: { fontFamily: MONO, fontSize: 10, lineHeight: 14, letterSpacing: 1.6 },
  sheetTitle: { fontSize: 21, lineHeight: 27, fontFamily: "Inter_700Bold", letterSpacing: -0.5, marginTop: 6 },
  sheetClose: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  sheetBody: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular", marginTop: 10 },
  points: { marginTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  point: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  pointText: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_500Medium", flex: 1 },
  cta: {
    marginTop: 18,
    height: 54,
    borderRadius: 27,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  ctaText: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },
});
