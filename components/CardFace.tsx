import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Path, Circle } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";

/**
 * The card, drawn. Credit-card proportions (85.6 x 53.98), so it scales with
 * the width it is given. Graphite for an everyday card, lime for a one-time.
 *
 * The network mark is Mastercard: Nuvion's other programmes issue on it. If
 * they confirm ours is Visa, this is the one place to change.
 */
export const CARD_RATIO = 53.98 / 85.6;

export function CardFace({
  width,
  name,
  last4,
  holder,
  oneTime = false,
  frozen = false,
}: {
  width: number;
  name: string;
  last4: string | null;
  holder?: string;
  oneTime?: boolean;
  frozen?: boolean;
}) {
  const height = Math.round(width * CARD_RATIO);
  const ink = oneTime ? "#0a0a0a" : "#ffffff";
  const soft = oneTime ? "rgba(10,10,10,0.6)" : "rgba(255,255,255,0.6)";
  const k = width / 350;

  return (
    <View style={[styles.card, { width, height, borderRadius: 18 * k }]}>
      <LinearGradient
        colors={oneTime ? ["#a6ff3f", "#81FB02", "#5fc400"] : ["#2b2b2b", "#151515", "#0b0b0b"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Guilloche: a few long waves, the pattern printed cards carry. */}
      <Svg width={width} height={height} viewBox="0 0 350 221" style={StyleSheet.absoluteFill}>
        {Array.from({ length: 9 }).map((_, i) => (
          <Path
            key={i}
            d={`M-10 ${150 + i * 9} C 80 ${95 + i * 9}, 170 ${215 + i * 9}, 360 ${120 + i * 9}`}
            stroke={oneTime ? "rgba(0,0,0,0.09)" : "rgba(255,255,255,0.05)"}
            strokeWidth={1}
            fill="none"
          />
        ))}
        <Circle cx={330} cy={-10} r={120} stroke={oneTime ? "rgba(0,0,0,0.08)" : "rgba(129,251,2,0.16)"} strokeWidth={1.2} fill="none" />
        <Circle cx={330} cy={-10} r={90} stroke={oneTime ? "rgba(0,0,0,0.06)" : "rgba(129,251,2,0.1)"} strokeWidth={1.2} fill="none" />
      </Svg>

      <View style={[styles.inner, { padding: 20 * k }]}>
        <View style={styles.rowBetween}>
          {/* The lockup, mark and wordmark. White and lime on graphite; a black
              copy on the lime card, where the lime half would vanish. A separate
              file rather than tintColor: Android didn't repaint a tint changed on
              the same image, so switching to one-time left the logo blank. Keyed
              so the switch mounts a fresh image either way. */}
          <Image
            key={oneTime ? "dark" : "light"}
            source={oneTime ? require("@/assets/images/logo-lockup-dark.png") : require("@/assets/images/logo-lockup.png")}
            style={{ width: 132 * k, height: (132 * k * 164) / 1150 }}
            resizeMode="contain"
          />
          <Text style={[styles.label, { fontSize: 10.5 * k, color: soft }]} numberOfLines={1}>
            {oneTime ? "ONE-TIME" : name.toUpperCase()}
          </Text>
        </View>

        {/* The chip. */}
        <LinearGradient
          colors={["#efd98f", "#c9a54b", "#e8cf7a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ width: 40 * k, height: 30 * k, borderRadius: 6 * k, marginTop: 16 * k }}
        />

        <Text style={[styles.number, { fontSize: 18 * k, color: ink, marginTop: 14 * k, letterSpacing: 2 * k }]}>
          ••••  ••••  ••••  {last4 || "••••"}
        </Text>

        <View style={[styles.rowBetween, { marginTop: "auto" }]}>
          <View>
            <Text style={[styles.small, { fontSize: 8.5 * k, color: soft }]}>CARD HOLDER</Text>
            <Text style={[styles.holder, { fontSize: 12.5 * k, color: ink }]} numberOfLines={1}>
              {holder || " "}
            </Text>
          </View>
          <View style={{ flexDirection: "row" }}>
            <View style={{ width: 26 * k, height: 26 * k, borderRadius: 13 * k, backgroundColor: "#EB001B" }} />
            <View style={{ width: 26 * k, height: 26 * k, borderRadius: 13 * k, backgroundColor: "#F79E1B", marginLeft: -10 * k, opacity: 0.92 }} />
          </View>
        </View>
      </View>

      {frozen && (
        <View style={[StyleSheet.absoluteFill, styles.frozen]}>
          <Ionicons name="snow" size={30 * k} color="#cfe8ff" />
          <Text style={[styles.frozenText, { fontSize: 13 * k }]}>Frozen</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: "hidden" },
  inner: { flex: 1 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontFamily: "Inter_600SemiBold", letterSpacing: 1, maxWidth: "50%" },
  number: { fontFamily: "Inter_600SemiBold" },
  small: { fontFamily: "Inter_600SemiBold", letterSpacing: 1 },
  holder: { fontFamily: "Inter_700Bold", letterSpacing: 0.6, marginTop: 2 },
  frozen: { backgroundColor: "rgba(10,20,30,0.55)", alignItems: "center", justifyContent: "center", gap: 6 },
  frozenText: { fontFamily: "Inter_700Bold", color: "#cfe8ff" },
});
