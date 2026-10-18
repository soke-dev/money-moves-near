import React, { useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";

interface LevelRow {
  label: string;
  value: string;
  locked?: boolean;
}

const UNVERIFIED: LevelRow[] = [
  { label: "Bank Transfer — Daily", value: "₦20,000" },
  { label: "Bank Transfer — Per Tx", value: "₦10,000" },
  { label: "Wallet Transfer", value: "Unlimited" },
  { label: "MM Username — Daily", value: "Locked", locked: true },
  { label: "MM Username — Per Tx", value: "Locked", locked: true },
  { label: "Airtime & Data — Daily", value: "₦3,000" },
  { label: "Airtime & Data — Per Tx", value: "₦1,000" },
  { label: "Betting", value: "Locked", locked: true },
  { label: "Buy Crypto", value: "Locked", locked: true },
];

const VERIFIED: LevelRow[] = [
  { label: "Bank Transfer — Daily", value: "₦2,000,000" },
  { label: "Bank Transfer — Per Tx", value: "₦500,000" },
  { label: "Wallet Transfer", value: "Unlimited" },
  { label: "MM Username — Daily", value: "₦200,000" },
  { label: "MM Username — Per Tx", value: "₦50,000" },
  { label: "Airtime & Data — Daily", value: "₦10,000" },
  { label: "Airtime & Data — Per Tx", value: "₦5,000" },
  { label: "Betting — Daily", value: "₦10,000" },
  { label: "Buy Crypto — Daily", value: "₦200,000" },
  { label: "Buy Crypto — Per Tx", value: "₦20,000" },
];

export default function SpendingLevelsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, refreshUser } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const verified = !!user?.verified;

  useEffect(() => { refreshUser(); }, []);

  const renderCard = (
    title: string,
    rows: LevelRow[],
    isCurrent: boolean,
    accent: string,
  ) => (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: isCurrent ? accent : colors.border }]}>
      {/* Header */}
      <View style={s.cardHeader}>
        <View style={[s.dot, { backgroundColor: accent }]} />
        <Text style={[s.cardTitle, { color: colors.foreground }]}>{title}</Text>
        {isCurrent && (
          <View style={[s.currentBadge, { backgroundColor: accent + "18" }]}>
            <Text style={[s.currentText, { color: accent }]}>Current</Text>
          </View>
        )}
      </View>

      {/* Rows */}
      {rows.map((r, i) => (
        <View
          key={i}
          style={[
            s.row,
            { borderBottomColor: i < rows.length - 1 ? colors.border : "transparent" },
          ]}
        >
          <Text style={[s.rowLabel, { color: colors.mutedForeground }]}>{r.label}</Text>
          {r.locked ? (
            <View style={s.lockedWrap}>
              <Feather name="lock" size={12} color="#ef4444" />
              <Text style={[s.rowValue, { color: "#ef4444" }]}>Requires KYC</Text>
            </View>
          ) : (
            <Text style={[s.rowValue, { color: colors.foreground }]}>{r.value}</Text>
          )}
        </View>
      ))}
    </View>
  );

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.foreground }]}>Spending Levels</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={[s.content, { paddingBottom: bottomPad + 40 }]}>
        {renderCard("Basic", UNVERIFIED, !verified, "#f59e0b")}
        {renderCard("Verified", VERIFIED, verified, colors.primary)}

        {!verified && (
          <TouchableOpacity
            style={[s.upgradeBtn, { backgroundColor: colors.foreground }]}
            onPress={() => router.push("/account/kyc")}
          >
            <Feather name="shield" size={16} color={colors.background} />
            <Text style={[s.upgradeBtnText, { color: colors.background }]}>Verify to Unlock Higher Limits</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16,
  },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  content: { padding: 20, gap: 16 },

  card: { borderRadius: 14, borderWidth: 1.5, overflow: "hidden" },
  cardHeader: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1 },
  currentBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  currentText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  row: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  rowValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  lockedWrap: { flexDirection: "row", alignItems: "center", gap: 4 },

  upgradeBtn: {
    flexDirection: "row", height: 50, borderRadius: 14,
    alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4,
  },
  upgradeBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
