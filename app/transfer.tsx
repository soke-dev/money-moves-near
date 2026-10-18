import React from "react";
import { View, Text, TouchableOpacity, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { ts } from "@/constants/transfer";
import { StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";

export default function TransferScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={ts.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[ts.headerTitle, { color: colors.foreground }]}>Transfer Funds</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={s.chooseContent}>
        <TouchableOpacity
          style={[s.chooseOption, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push("/sell" as any)}
        >
          <View style={[s.chooseIcon, { backgroundColor: colors.primary + "22" }]}>
            <Feather name="credit-card" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={[s.chooseTitle, { color: colors.foreground }]}>Bank Transfer</Text>
              <View style={[s.comingSoonBadge, { backgroundColor: colors.primary + "22" }]}>
                <Text style={[s.comingSoonText, { color: colors.primary }]}>Gasless ⚡</Text>
              </View>
            </View>
            <Text style={[s.chooseSub, { color: colors.mutedForeground }]}>
              Sell crypto and receive naira in your bank
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>

        {/* Above the on-chain option, and the send sheet on the home
            screen lists them in this same order. Sending to a username is
            what most people came here to do; asking for a wallet address
            first put the harder of the two on top. */}
        <TouchableOpacity
          style={[s.chooseOption, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push("/username-lookup" as any)}
        >
          <View style={[s.chooseIcon, { backgroundColor: colors.primary + "22" }]}>
            <Feather name="users" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={[s.chooseTitle, { color: colors.foreground }]}>Send to Username</Text>
              <View style={[s.comingSoonBadge, { backgroundColor: "#22c55e22" }]}>
                <Text style={[s.comingSoonText, { color: "#22c55e" }]}>Instant · Free</Text>
              </View>
            </View>
            <Text style={[s.chooseSub, { color: colors.mutedForeground }]}>
              Send to another Money Moves user instantly
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.chooseOption, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push("/withdraw-select" as any)}
        >
          <View style={[s.chooseIcon, { backgroundColor: "#2775CA22" }]}>
            <Feather name="send" size={22} color="#2775CA" />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={[s.chooseTitle, { color: colors.foreground }]}>Withdraw Crypto</Text>
              <View style={[s.comingSoonBadge, { backgroundColor: "#22c55e22" }]}>
                <Text style={[s.comingSoonText, { color: "#22c55e" }]}>0% Fee · Gasless</Text>
              </View>
            </View>
            <Text style={[s.chooseSub, { color: colors.mutedForeground }]}>
              Send crypto to another wallet on-chain
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  chooseContent: { padding: 20, gap: 12 },
  chooseOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
  },
  chooseIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  chooseTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  chooseSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  comingSoonBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  comingSoonText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
});
