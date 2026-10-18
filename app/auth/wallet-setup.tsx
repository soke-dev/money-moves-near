import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";

/**
 * Onboarding step: create the self-custodial 12-word wallet, then route to the
 * backup screen.
 *
 * NOTE: The Web3Auth "email wallet" option was removed here — the embedded
 * wallet is being rebuilt on Dynamic.xyz (see config/dynamic.ts). Keeping this
 * screen free of any @web3auth import is required, because Expo Router eagerly
 * evaluates every route module at boot, and loading @web3auth's torus deps
 * crashes the bundle (missing Buffer / url.pathToFileURL under Metro).
 */
export default function WalletSetup() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { finishWalletSetup, walletType } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Safety net: an email (Dynamic/EMBEDDED) wallet must NEVER create a mnemonic
  // here — it would overwrite the embedded wallet's addresses on the backend and
  // orphan the user's funds. Bounce straight home if we somehow land here.
  // Unconditional now: this screen has nothing left to offer anybody.
  useEffect(() => {
    router.replace("/(tabs)" as any);
  }, []);

  /**
   * There is nothing to proceed to.
   *
   * 12-word wallets are no longer created here, or anywhere. The screen is left
   * in place rather than deleted so any build or deep link that still reaches
   * it lands somewhere sensible instead of a blank route - and the one thing it
   * must never do again is call finishWalletSetup("MNEMONIC"), which is how an
   * email account ended up with a second wallet over the top of its own.
   */
  const proceed = async () => {
    router.replace("/(tabs)" as any);
  };

  const points = [
    "Full self-custody. You receive a 12-word recovery phrase — the only way to restore this wallet.",
    "You are responsible for keeping it safe. If you lose it, your funds cannot be recovered.",
    "On the next screen you'll write it down and confirm it.",
  ];

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.iconCircle, { backgroundColor: colors.primary + "20" }]}>
          <Feather name="key" size={30} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>Set up your wallet</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Self-custodial — only you control your funds.
        </Text>
      </View>

      <View style={{ gap: 14, marginBottom: 20 }}>
        {points.map((p, i) => (
          <View key={i} style={styles.pointRow}>
            <Feather name="check-circle" size={18} color={colors.primary} style={{ marginTop: 1 }} />
            <Text style={[styles.pointText, { color: colors.mutedForeground }]}>{p}</Text>
          </View>
        ))}
      </View>

      {!!err && (
        <View style={[styles.noteBox, { backgroundColor: "#EF444422" }]}>
          <Feather name="alert-triangle" size={15} color="#EF4444" style={{ marginTop: 1 }} />
          <Text style={[styles.noteText, { color: "#EF4444" }]}>{err}</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: busy ? 0.7 : 1 }]}
        onPress={proceed}
        disabled={busy}
        activeOpacity={0.85}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.primaryForeground} />
        ) : (
          <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
            {err ? "Try again" : "Create wallet"}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20, justifyContent: "center" },
  header: { alignItems: "center", marginBottom: 28 },
  iconCircle: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", marginBottom: 8, textAlign: "center" },
  subtitle: { fontSize: 14, fontFamily: "Inter_500Medium", textAlign: "center", lineHeight: 20, paddingHorizontal: 8 },
  pointRow: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingHorizontal: 4 },
  pointText: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 20 },
  noteBox: { flexDirection: "row", gap: 9, alignItems: "flex-start", borderRadius: 12, padding: 12, marginBottom: 14 },
  noteText: { flex: 1, fontSize: 12.5, fontFamily: "Inter_500Medium", lineHeight: 18 },
  primaryBtn: { borderRadius: 16, paddingVertical: 16, alignItems: "center", justifyContent: "center" },
  primaryBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
