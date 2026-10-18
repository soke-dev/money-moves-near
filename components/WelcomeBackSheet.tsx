/**
 * What changed, for an account that was here before the rebuild.
 *
 * A returning user signs in and finds three things different: no password, a
 * verification they have already passed being asked for again, and a wallet
 * address that is not the one they had. Each reads as a fault unless someone
 * says otherwise, so this says it once, on the first sign-in.
 *
 * It is built as two columns of a ledger - what came with you, what is
 * different - because that is the question actually being asked. The obvious
 * alternative, three icon tiles in a card, buries the reassurance in the same
 * shape as the warnings.
 *
 * Not dismissible by tapping outside: it is the only place the wallet change
 * is explained, and the export screen is the only route back to the old one.
 */
import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, Platform, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/context/ThemeContext";

const LOCKUP = require("@/assets/images/logo-lockup.png");
const WALLET = require("@/assets/images/wallet-filled-money-tool.png");

const KEPT = ["Your transaction history", "Loyalty points and rank", "Saved bank accounts"];

const CHANGED: { head: string; body: string }[] = [
  {
    head: "No password",
    body: "Sign in with a code we email you.",
  },
  {
    head: "A new self-custodial wallet",
    body: "Your old one still holds whatever was in it. Export it to MetaMask, Phantom, Nightly or any other wallet to move those assets out.",
  },
  {
    head: "Verify your ID",
    body: "Verify your ID with our KYC partner to fund with naira and raise your transaction limits.",
  },
];

export function WelcomeBackSheet({
  visible,
  onDone,
  onExportWallet,
}: {
  visible: boolean;
  onDone: () => void;
  onExportWallet: () => void;
}) {
  const colors = useColors();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  if (!visible) return null;

  return (
    <Modal transparent animationType="slide" visible statusBarTranslucent>
      <View style={s.overlay}>
        <View style={[s.sheet, { backgroundColor: colors.background, paddingBottom: bottomPad + 18 }]}>
          <View style={[s.handle, { backgroundColor: colors.border }]} />

          {/* The lockup is drawn with "money" in white, which vanishes on the
              light background - so in that theme the whole thing takes the
              foreground colour and reads as one solid mark instead. */}
          <View style={s.brand}>
            <Image
              source={LOCKUP}
              style={[s.lockup, !isDark && { tintColor: colors.foreground }]}
              resizeMode="contain"
            />
            <Text style={[s.version, { color: colors.mutedForeground }]}>v2</Text>
          </View>

          <Text style={[s.title, { color: colors.foreground }]}>
            We rebuilt{"\n"}Money Moves
          </Text>

          {/* The reassurance first, and in the brand colour, because "did I
              lose anything" is the question underneath all of this. */}
          <View style={s.kept}>
            {KEPT.map((line) => (
              <View key={line} style={s.keptRow}>
                <Feather name="check" size={14} color={colors.primary} />
                <Text style={[s.keptText, { color: colors.foreground }]}>{line}</Text>
              </View>
            ))}
            <Text style={[s.keptNote, { color: colors.mutedForeground }]}>came with you</Text>
          </View>

          <View style={[s.rule, { backgroundColor: colors.border }]} />

          <Text style={[s.changedLabel, { color: colors.mutedForeground }]}>WHAT IS DIFFERENT</Text>

          {CHANGED.map((c, i) => (
            <View key={c.head} style={s.changeRow}>
              <Text style={[s.changeNo, { color: colors.mutedForeground }]}>
                {String(i + 1).padStart(2, "0")}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.changeHead, { color: colors.foreground }]}>{c.head}</Text>
                <Text style={[s.changeBody, { color: colors.mutedForeground }]}>{c.body}</Text>
              </View>
            </View>
          ))}

          <TouchableOpacity
            style={[s.primary, { backgroundColor: colors.primary }]}
            onPress={onDone}
            activeOpacity={0.85}
          >
            <Text style={[s.primaryText, { color: colors.primaryForeground }]}>Got it</Text>
          </TouchableOpacity>

          {/* Offered here because this is the moment someone wonders where
              their old balance went. */}
          <TouchableOpacity style={s.secondary} onPress={onExportWallet} activeOpacity={0.7}>
            {/* The same mark the Export wallet row in Settings carries, so the
                two are recognisably the same destination. */}
            <Image
              source={WALLET}
              style={[s.secondaryIcon, { tintColor: colors.mutedForeground }]}
              resizeMode="contain"
            />
            <Text style={[s.secondaryText, { color: colors.mutedForeground }]}>
              Export my old wallet
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 12 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 22 },

  // The lockup, and the release stamped beside it at the height of its
  // wordmark - the way a version sits next to a name on a product, rather
  // than in a pill of its own.
  brand: { flexDirection: "row", alignItems: "center", gap: 9 },
  lockup: { width: 154, height: 22 },
  version: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_700Bold", letterSpacing: 0.3 },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -1,
    marginTop: 14,
  },

  kept: { marginTop: 20, gap: 9 },
  keptRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  keptText: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
  // Sits under the list like a caption on a column, rather than heading it.
  keptNote: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular", marginLeft: 23 },

  rule: { height: StyleSheet.hairlineWidth, marginVertical: 22 },

  changedLabel: {
    fontSize: 10,
    lineHeight: 13,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.4,
    marginBottom: 14,
  },
  changeRow: { flexDirection: "row", gap: 14, marginBottom: 16 },
  // A number, not a badge: it orders the list without dressing it up.
  changeNo: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_700Bold", width: 20 },
  changeHead: { fontSize: 14.5, lineHeight: 19, fontFamily: "Inter_700Bold" },
  changeBody: { fontSize: 12.5, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 2 },

  primary: { height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center", marginTop: 8 },
  primaryText: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  secondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    marginTop: 2,
  },
  secondaryIcon: { width: 15, height: 15 },
  secondaryText: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
});
