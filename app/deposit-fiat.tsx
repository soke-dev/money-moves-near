import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { FIAT_COUNTRIES } from "@/constants/fiat";

/**
 * Which currency the money is coming from.
 *
 * Two countries and no search box: a field that filters a list shorter than the
 * keyboard covering it is furniture. It goes back in when the list is long
 * enough to need it.
 */
export default function DepositFiatScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.back} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.foreground }]}>Deposit fiat</Text>
      </View>

      <ScrollView
        contentContainerStyle={[s.list, { paddingBottom: bottomPad + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[s.sectionLabel, { color: colors.mutedForeground }]}>COUNTRIES</Text>

        {FIAT_COUNTRIES.map((c) => (
          <TouchableOpacity
            key={c.code}
            style={[s.row, { backgroundColor: colors.card }, !c.live && s.rowSoon]}
            activeOpacity={c.live ? 0.75 : 1}
            disabled={!c.live}
            onPress={() => router.push(c.route as any)}
          >
            <Image source={c.flag} style={s.flag} resizeMode="cover" />
            <View style={{ flex: 1 }}>
              <Text style={[s.rowTitle, { color: colors.foreground }]}>
                {c.country} · {c.currency}
              </Text>
              <Text style={[s.rowSub, { color: colors.mutedForeground }]}>{c.method}</Text>
            </View>
            {/* What the row does, or why it cannot do it yet. */}
            <View
              style={[
                s.tag,
                { backgroundColor: c.live ? colors.primary : "transparent", borderColor: colors.border },
                !c.live && s.tagSoon,
              ]}
            >
              <Text
                style={[
                  s.tagText,
                  { color: c.live ? colors.primaryForeground : colors.mutedForeground },
                ]}
              >
                {c.live ? "Deposit" : "Soon"}
              </Text>
            </View>
          </TouchableOpacity>
        ))}

        <Text style={[s.foot, { color: colors.mutedForeground }]}>
          Deposits usually arrive within minutes
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 12, marginBottom: 10 },
  back: { position: "absolute", left: 20 },
  title: { fontSize: 17, lineHeight: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },

  list: { paddingHorizontal: 20 },
  sectionLabel: {
    fontSize: 10.5,
    lineHeight: 14,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.4,
    marginBottom: 12,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    padding: 14,
    borderRadius: 18,
    marginBottom: 10,
  },
  // Dimmed and inert. The row still answers the question it was listed for.
  rowSoon: { opacity: 0.5 },
  // Both flags are cropped to their disc, so one radius fits both.
  flag: { width: 40, height: 40, borderRadius: 20 },
  rowTitle: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  rowSub: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 2 },

  tag: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999 },
  tagSoon: { borderWidth: StyleSheet.hairlineWidth },
  tagText: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_600SemiBold" },

  foot: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 18,
  },
});
