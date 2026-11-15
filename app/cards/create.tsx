import React, { useState } from "react";
import {
  View, Text, StyleSheet, Pressable, Platform, TextInput, ActivityIndicator,
  KeyboardAvoidingView, ScrollView, useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { CardFace } from "@/components/CardFace";
import { createCard, type CardKind } from "@/services/cards";

const LIME = "#81FB02";

function Press({ style, children, ...rest }: React.ComponentProps<typeof Pressable> & { style?: any }) {
  return (
    <Pressable {...rest} style={({ pressed }) => [style, { transform: [{ scale: pressed ? 0.97 : 1 }], opacity: pressed ? 0.9 : 1 }]}>
      {children as any}
    </Pressable>
  );
}

export default function CreateCardScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [kind, setKind] = useState<CardKind>("everyday");
  const [name, setName] = useState("Online shopping");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [needsTopup, setNeedsTopup] = useState(false);

  const holder = `${user?.firstName || ""} ${user?.lastName || ""}`.trim().toUpperCase();

  const submit = async () => {
    if (loading || !name.trim()) return;
    setLoading(true);
    setError("");
    setNeedsTopup(false);
    try {
      await createCard(kind, name.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace("/cards" as any);
    } catch (e: any) {
      const d = e?.response?.data;
      setError(d?.error || "Couldn't create the card. Try again.");
      setNeedsTopup(d?.code === "FEE_REQUIRED");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setLoading(false);
    }
  };

  const option = (k: CardKind, icon: string, title: string, sub: string) => {
    const on = kind === k;
    return (
      <Press
        onPress={() => {
          setKind(k);
          Haptics.selectionAsync().catch(() => {});
        }}
        style={[s.option, { backgroundColor: colors.card, borderColor: on ? LIME : colors.border, borderWidth: on ? 1.5 : 1 }]}
      >
        <View style={s.optionIcon}>
          <Ionicons name={icon as any} size={20} color={LIME} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.optionTitle, { color: colors.foreground }]}>{title}</Text>
          <Text style={[s.optionSub, { color: colors.mutedForeground }]}>{sub}</Text>
        </View>
        <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={22} color={on ? LIME : colors.mutedForeground} />
      </Press>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ flex: 1, paddingTop: topPad }}>
        <View style={s.header}>
          <Press onPress={() => router.back()} style={[s.round, { backgroundColor: colors.card }]} hitSlop={8}>
            <Ionicons name="chevron-back" size={20} color={colors.foreground} />
          </Press>
          <Text style={[s.title, { color: colors.foreground }]}>New card</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: "center", marginTop: 4 }}>
            <CardFace width={width - 80} name={name || "Card"} last4={null} holder={holder} oneTime={kind === "one-time"} />
          </View>

          <Text style={[s.section, { color: colors.mutedForeground }]}>TYPE</Text>
          <View style={{ gap: 10 }}>
            {option("everyday", "infinite-outline", "Everyday", "Stays active for shopping and subscriptions")}
            {option("one-time", "shield-checkmark-outline", "One-time", "Closes after one payment. For sites you don't trust")}
          </View>

          <Text style={[s.section, { color: colors.mutedForeground }]}>NAME IT</Text>
          <View style={[s.input, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="create-outline" size={18} color={colors.mutedForeground} />
            <TextInput
              value={name}
              onChangeText={setName}
              maxLength={40}
              placeholder="Online shopping"
              placeholderTextColor={colors.mutedForeground}
              style={[s.inputText, { color: colors.foreground }]}
            />
          </View>

          {!!error && (
            <View style={[s.error, { backgroundColor: colors.card }]}>
              <Ionicons name="information-circle-outline" size={18} color="#f59e0b" />
              <Text style={[s.errorText, { color: colors.foreground }]}>{error}</Text>
            </View>
          )}
        </ScrollView>

        <View style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 14, gap: 10 }}>
          {needsTopup ? (
            <Press onPress={() => router.push("/cards/topup" as any)} style={s.cta}>
              <Text style={s.ctaText}>Top up first</Text>
              <View style={s.ctaArrow}><Ionicons name="arrow-forward" size={18} color={LIME} /></View>
            </Press>
          ) : (
            <Press onPress={submit} disabled={loading || !name.trim()} style={[s.cta, (!name.trim()) && { opacity: 0.5 }]}>
              {loading ? <ActivityIndicator color="#0a0a0a" /> : <Text style={s.ctaText}>Create card</Text>}
              {!loading && <View style={s.ctaArrow}><Ionicons name="arrow-forward" size={18} color={LIME} /></View>}
            </Press>
          )}
          <Text style={[s.small, { color: colors.mutedForeground }]}>
            The card fee comes out of your card balance. USD only, valid for 2 years.
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 10 },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontFamily: "Inter_700Bold" },
  section: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.6, marginTop: 24, marginBottom: 10, marginLeft: 2 },
  option: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 18 },
  optionIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(129,251,2,0.1)", alignItems: "center", justifyContent: "center" },
  optionTitle: { fontSize: 15.5, fontFamily: "Inter_700Bold" },
  optionSub: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 2 },
  input: { flexDirection: "row", alignItems: "center", gap: 10, height: 54, borderRadius: 16, borderWidth: 1, paddingHorizontal: 16 },
  inputText: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", height: "100%" },
  error: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, padding: 14, marginTop: 18 },
  errorText: { flex: 1, fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_500Medium" },
  cta: { height: 58, borderRadius: 29, backgroundColor: LIME, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 16, fontFamily: "Inter_800ExtraBold", color: "#0a0a0a" },
  ctaArrow: { position: "absolute", right: 6, top: 6, width: 46, height: 46, borderRadius: 23, backgroundColor: "#0a0a0a", alignItems: "center", justifyContent: "center" },
  small: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
});
