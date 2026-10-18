import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, ActivityIndicator, Alert, Image } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { SettingRow, SettingGroup } from "@/components/SettingsRow";
import { approveBusinessLink, declineBusinessLink, getBusinessLinks, unlinkBusiness, type BusinessLink } from "@/services/business-links";

/**
 * Businesses that want their payments to land in this account.
 *
 * A business on Money Moves Business asks by username; nothing is linked until
 * the account's owner approves it here. A linked business can be unlinked any
 * time, from here - it only ever sends money in, never takes it out.
 */
export default function LinkedBusinessesScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [links, setLinks] = useState<BusinessLink[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState("");

  const load = useCallback(() => {
    getBusinessLinks()
      .then((l) => {
        setLinks(l);
        setProblem("");
      })
      .catch(() => {
        setLinks((cur) => cur ?? []);
        setProblem("Couldn't load your linked businesses. Pull back and try again.");
      });
  }, []);

  // Read again whenever the screen comes back into view - a request may have arrived meanwhile.
  useFocusEffect(load);

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    setProblem("");
    try {
      await fn();
      load();
    } catch (e: any) {
      setProblem(e?.response?.data?.error || "That didn't go through. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  };

  const unlink = (l: BusinessLink) =>
    Alert.alert(`Unlink ${l.businessName}?`, "Its payments stop landing in your account. You can be linked again only if it asks and you approve.", [
      { text: "Keep linked", style: "cancel" },
      { text: "Unlink", style: "destructive", onPress: () => void act(l.id, () => unlinkBusiness(l.id)) },
    ]);

  const waiting = (links ?? []).filter((l) => l.status === "PENDING");
  const linked = (links ?? []).filter((l) => l.status === "APPROVED");
  const mark = <Feather name="briefcase" size={18} color={colors.foreground} />;

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.foreground }]}>Linked businesses</Text>
        <View style={{ width: 24 }} />
      </View>

      <Text style={[s.lead, { color: colors.mutedForeground }]}>
        Businesses on Money Moves Business can ask for their payments to land in your account. Nothing is linked until you approve it, and a linked
        business can only send money in - never take it out.
      </Text>

      {links === null ? (
        <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          {waiting.length > 0 && (
            <SettingGroup label="WAITING FOR YOU">
              {waiting.map((l, i) => (
                <View key={l.id} style={[s.request, i < waiting.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
                  <Text style={[s.name, { color: colors.foreground }]}>{l.businessName}</Text>
                  <Text style={[s.sub, { color: colors.mutedForeground }]}>Wants its payments to land in your Money Moves account.</Text>
                  <View style={s.buttons}>
                    <TouchableOpacity
                      disabled={busy === l.id}
                      onPress={() => void act(l.id, () => approveBusinessLink(l.id))}
                      style={[s.button, { backgroundColor: colors.primary }]}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.buttonText, { color: colors.primaryForeground }]}>{busy === l.id ? "…" : "Approve"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      disabled={busy === l.id}
                      onPress={() => void act(l.id, () => declineBusinessLink(l.id))}
                      style={[s.button, { borderWidth: 1, borderColor: colors.border }]}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.buttonText, { color: colors.foreground }]}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </SettingGroup>
          )}

          <SettingGroup label="LINKED">
            {linked.length === 0 ? (
              <Text style={[s.empty, { color: colors.mutedForeground }]}>No businesses are linked to your account.</Text>
            ) : (
              linked.map((l, i) => (
                <SettingRow
                  key={l.id}
                  // The business's own logo when it has one, filling the square; a briefcase otherwise.
                  mark={l.businessLogo ? <Image source={{ uri: l.businessLogo }} resizeMode="contain" style={s.logo} /> : mark}
                  title={l.businessName}
                  subtitle="Its payments land in your account"
                  onPress={() => unlink(l)}
                  last={i === linked.length - 1}
                  right={<Text style={[s.unlink, { color: colors.destructive }]}>{busy === l.id ? "…" : "Unlink"}</Text>}
                />
              ))
            )}
          </SettingGroup>

          {!!problem && <Text style={[s.problem, { color: colors.destructive }]}>{problem}</Text>}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  logo: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#fff" },
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  lead: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular", paddingHorizontal: 22, paddingBottom: 4 },
  request: { paddingHorizontal: 16, paddingVertical: 14 },
  name: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  sub: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 3 },
  buttons: { flexDirection: "row", gap: 10, marginTop: 12 },
  button: { flex: 1, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  empty: { fontSize: 13, fontFamily: "Inter_400Regular", padding: 16 },
  unlink: { fontSize: 13, fontFamily: "Inter_500Medium" },
  problem: { fontSize: 13, fontFamily: "Inter_400Regular", paddingHorizontal: 22, marginTop: 16 },
});
