import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, Linking, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { openStore, runningVersion } from "@/services/store-update";

const SUPPORT_EMAIL = "support@usemoneymoves.xyz";

/**
 * What the app becomes once the server has refused this build.
 *
 * It replaces the navigator rather than sitting over it, so nothing the screens
 * underneath do on their way out - a sheet, a redirect - can land on top. No
 * close and no back: every call would get the same 426, so there is nothing
 * behind it to go back to.
 *
 * The money line is there because a finance app that stops working reads as
 * money that has stopped too. Nothing about updating touches either.
 */
export function UpdateRequired({ required }: { required: string }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const ios = Platform.OS === "ios";

  return (
    <View
      style={[
        s.screen,
        { backgroundColor: colors.background, paddingTop: insets.top + 48, paddingBottom: insets.bottom + 12 },
      ]}
    >
      <ScrollView contentContainerStyle={s.content} bounces={false} showsVerticalScrollIndicator={false}>
        <Image
          source={require("@/assets/images/logo-badge.png")}
          style={[s.icon, { borderColor: colors.border }]}
          accessibilityLabel="Money Moves"
        />
        <Text style={[s.title, { color: colors.foreground }]}>Time to update</Text>
        <Text style={[s.body, { color: colors.mutedForeground }]}>
          This version of Money Moves is no longer supported. Update from the {ios ? "App Store" : "Play Store"} to
          carry on.
        </Text>

        <View style={[s.card, { backgroundColor: colors.card }]}>
          <View style={[s.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
            <Text style={[s.rowLabel, { color: colors.mutedForeground }]}>On this phone</Text>
            <Text style={[s.rowValue, { color: colors.foreground }]}>{runningVersion()}</Text>
          </View>
          <View style={s.row}>
            <Text style={[s.rowLabel, { color: colors.mutedForeground }]}>Required</Text>
            <Text style={[s.rowValue, { color: colors.primary }]}>{required}</Text>
          </View>
        </View>

        <View style={s.safe}>
          <Feather name="shield" size={18} color={colors.primary} style={s.safeIcon} />
          <Text style={[s.safeText, { color: colors.mutedForeground }]}>
            <Text style={[s.safeLead, { color: colors.foreground }]}>Your money is safe.</Text> Updating doesn't
            touch your balance or your history.
          </Text>
        </View>
      </ScrollView>

      <TouchableOpacity style={[s.btn, { backgroundColor: colors.primary }]} onPress={openStore} activeOpacity={0.85}>
        <Text style={[s.btnText, { color: colors.primaryForeground }]}>
          {ios ? "Update on the App Store" : "Update on Google Play"}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={s.support}
        onPress={() =>
          Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Updating Money Moves")}`).catch(
            () => {},
          )
        }
      >
        <Text style={[s.supportText, { color: colors.foreground }]}>Contact support</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24 },
  content: { flexGrow: 1, paddingBottom: 24 },
  icon: { width: 72, height: 72, borderRadius: 18, borderWidth: 1 },
  title: { fontSize: 30, lineHeight: 36, fontFamily: "Inter_700Bold", letterSpacing: -0.6, marginTop: 28 },
  body: { fontSize: 15, lineHeight: 22, fontFamily: "Inter_400Regular", marginTop: 10 },
  card: { borderRadius: 16, paddingHorizontal: 16, marginTop: 28 },
  row: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowLabel: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  rowValue: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  safe: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginTop: 20 },
  safeIcon: { marginTop: 1 },
  safeText: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  safeLead: { fontFamily: "Inter_600SemiBold" },
  btn: { height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 16, lineHeight: 22, fontFamily: "Inter_600SemiBold" },
  support: { alignSelf: "center", paddingVertical: 16, paddingHorizontal: 20, marginTop: 2 },
  supportText: { fontSize: 16, lineHeight: 22, fontFamily: "Inter_700Bold" },
});
