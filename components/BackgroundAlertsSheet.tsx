import React, { useState } from "react";
import { Linking, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

/**
 * Open this app's page in the phone's own settings.
 *
 * Linking.openSettings is part of React Native itself, so it needs no native
 * module the installed build might not have. From that page the battery and
 * background switches are one tap away on every Android skin we have seen.
 */
export function openAppSettings(): void {
  Linking.openSettings().catch(() => {});
}

const STEPS = [
  "Tap Open settings",
  "Go to Battery and choose Unrestricted or No restrictions",
  "If you see Auto-start or Allow background activity, turn it on",
];

/**
 * Asks Android users to let notifications through when the app is closed.
 *
 * The notifications themselves are sent correctly, but many phones - Tecno,
 * Infinix, itel and Xiaomi especially - stop delivering them to an app that has
 * been swiped away, to save battery. Nothing the app sends can get past that;
 * the person has to allow it once, and has no reason to know they should.
 *
 * One line and one button. The steps wait behind "How do I do this?" for
 * whoever needs them, rather than greeting everyone with a list.
 */
export function BackgroundAlertsSheet({ bottomInset, onClose }: { bottomInset: number; onClose: () => void }) {
  const colors = useColors();
  const [showSteps, setShowSteps] = useState(false);

  return (
    <Modal transparent animationType="slide" visible statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable style={s.backdrop} onPress={onClose} />
        <View style={[s.sheet, { backgroundColor: colors.card, paddingBottom: bottomInset + 20 }]}>
          <View style={s.handle} />

          <View style={[s.mark, { backgroundColor: colors.primary + "1F" }]}>
            <Feather name="bell" size={36} color={colors.primary} />
            <View style={[s.badgeRing, { backgroundColor: colors.card }]}>
              <View style={[s.badge, { backgroundColor: colors.primary }]}>
                <Feather name="check" size={13} color={colors.primaryForeground} />
              </View>
            </View>
          </View>

          <Text style={[s.title, { color: colors.foreground }]}>Turn on background alerts</Text>
          <Text style={[s.body, { color: colors.mutedForeground }]}>
            So deposits and payouts reach you even when Money Moves is closed.
          </Text>

          <TouchableOpacity
            style={[s.primary, { backgroundColor: colors.primary }]}
            onPress={() => {
              openAppSettings();
              onClose();
            }}
            activeOpacity={0.85}
          >
            <Text style={[s.primaryText, { color: colors.primaryForeground }]}>Open settings</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.how, { borderColor: colors.border }]}
            onPress={() => setShowSteps((v) => !v)}
            activeOpacity={0.75}
            accessibilityState={{ expanded: showSteps }}
          >
            <Text style={[s.howText, { color: colors.foreground }]}>How do I do this?</Text>
            <Feather name={showSteps ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
          </TouchableOpacity>

          {showSteps && (
            <View style={[s.steps, { backgroundColor: colors.background }]}>
              {STEPS.map((step, i) => (
                <View key={step} style={s.step}>
                  <View style={[s.num, { backgroundColor: colors.primary + "24" }]}>
                    <Text style={[s.numText, { color: colors.primary }]}>{i + 1}</Text>
                  </View>
                  <Text style={[s.stepText, { color: colors.foreground }]}>{step}</Text>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity style={s.secondary} onPress={onClose} activeOpacity={0.7}>
            <Text style={[s.secondaryText, { color: colors.mutedForeground }]}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.72)" },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
    alignItems: "center",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(150,150,150,0.4)",
    marginBottom: 28,
  },
  mark: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center" },
  badgeRing: {
    position: "absolute",
    right: -2,
    bottom: 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
    marginTop: 22,
    textAlign: "center",
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "Inter_400Regular",
    marginTop: 8,
    maxWidth: 300,
    textAlign: "center",
  },
  primary: {
    alignSelf: "stretch",
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 28,
  },
  primaryText: { fontSize: 16, lineHeight: 20, fontFamily: "Inter_700Bold" },
  how: {
    alignSelf: "stretch",
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  howText: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  steps: { alignSelf: "stretch", borderRadius: 14, padding: 16, gap: 12, marginTop: 10 },
  step: { flexDirection: "row", alignItems: "center", gap: 12 },
  num: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  numText: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_700Bold" },
  stepText: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: "Inter_500Medium" },
  secondary: { alignSelf: "stretch", height: 44, alignItems: "center", justifyContent: "center", marginTop: 6 },
  secondaryText: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
});
