import React, { useState } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";

/**
 * Shown once, at first wallet setup (and again after an admin resets the
 * wallet). Creates the self-custodial 12-word wallet.
 *
 * NOTE: The Web3Auth "email wallet" option was removed — the embedded wallet is
 * being rebuilt on Dynamic.xyz (see config/dynamic.ts). This component must not
 * import @web3auth: it's reachable from the (tabs) route, which Expo Router
 * evaluates at boot, and loading torus deps crashes the bundle under Metro.
 */
export function WalletTypeChooser({
  visible,
  onDone,
}: {
  visible: boolean;
  onDone: () => void;
}) {
  const colors = useColors();
  const { finishWalletSetup } = useApp();
  const [busy, setBusy] = useState(false);

  const chooseMnemonic = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await finishWalletSetup("MNEMONIC");
      onDone();
    } catch (e: any) {
      Alert.alert("Couldn't set up wallet", e?.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={[styles.iconCircle, { backgroundColor: colors.primary + "20" }]}>
            <Feather name="shield" size={30} color={colors.primary} />
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>Set up your wallet</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Your wallet is self-custodial. You'll get a 12-word recovery phrase — the only way to
            restore it — so keep it safe.
          </Text>

          {/* 12-word phrase */}
          <TouchableOpacity
            style={[styles.option, { borderColor: colors.border, backgroundColor: colors.background }]}
            onPress={chooseMnemonic}
            disabled={busy}
            activeOpacity={0.85}
          >
            <View style={[styles.optIcon, { backgroundColor: colors.primary + "18" }]}>
              {busy ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Feather name="key" size={20} color={colors.primary} />
              )}
            </View>
            <View style={styles.optText}>
              <Text style={[styles.optTitle, { color: colors.foreground }]}>12-word phrase</Text>
              <Text style={[styles.optSub, { color: colors.mutedForeground }]}>
                Full self-custody. You safeguard a 12-word recovery phrase.
              </Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: { width: "100%", maxWidth: 380, borderRadius: 24, padding: 24, alignItems: "center" },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 6, textAlign: "center" },
  subtitle: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    lineHeight: 19,
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  option: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginTop: 12,
  },
  optIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  optText: { flex: 1 },
  optTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  optSub: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 2 },
});
