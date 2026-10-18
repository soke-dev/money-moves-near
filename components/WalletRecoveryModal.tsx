import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  TextInput,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import {
  isValidMnemonic,
  deriveAddresses,
  formatAddressesForSave,
  saveMnemonic,
} from "@/services/wallet-core";
import { restoreFromBackup } from "@/services/wallet-backup";
import { getBalances, initializeWallets, saveWalletAddresses } from "@/services/wallet";

type Step = "choose" | "cloud" | "manual" | "no-wallet";

interface Props {
  visible: boolean;
  onComplete: () => void;
  onCancel: () => void;
  onCreateNew?: () => void;
}

export function WalletRecoveryModal({ visible, onComplete, onCancel, onCreateNew }: Props) {
  const colors = useColors();
  const [step, setStep] = useState<Step>("choose");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cloud restore
  const [cloudPassword, setCloudPassword] = useState("");

  // Manual restore
  const [manualWords, setManualWords] = useState(Array(12).fill(""));

  const resetState = () => {
    setStep("choose");
    setLoading(false);
    setError(null);
    setCloudPassword("");
    setManualWords(Array(12).fill(""));
  };

  const finishRestore = async (mnemonic: string) => {
    // Derive addresses from the provided mnemonic
    const addresses = deriveAddresses(mnemonic);
    const formatted = formatAddressesForSave(addresses);

    // Verify the derived addresses match the user's existing wallet on the backend
    const { wallets } = await getBalances();
    const existingAddrs = wallets.filter((w) => !!w.address);
    if (existingAddrs.length === 0) {
      const err = new Error("No wallet exists for this account.");
      (err as any).code = "NO_WALLET_ON_ACCOUNT";
      throw err;
    }
    if (existingAddrs.length > 0) {
      const derivedMap: Record<string, string> = {};
      for (const f of formatted) {
        derivedMap[f.chain] = f.address.toLowerCase();
      }
      const mismatches = existingAddrs.filter(
        (w) => derivedMap[w.chain] && derivedMap[w.chain] !== w.address!.toLowerCase()
      );
      if (mismatches.length > 0) {
        console.log("[RESTORE] address mismatch detected", {
          derived: derivedMap,
          backend: Object.fromEntries(existingAddrs.map((w) => [w.chain, w.address])),
          mismatches: mismatches.map((w) => ({
            chain: w.chain,
            backend: w.address,
            derived: derivedMap[w.chain],
          })),
        });
        throw new Error("The public address derived from this phrase doesn't match your account. Please double-check and try again.");
      }
    }

    // Persist mnemonic on device first (most critical step)
    await saveMnemonic(mnemonic);

    // Save addresses to backend (best-effort)
    try { await initializeWallets(); } catch {}
    try { await saveWalletAddresses(formatted); } catch {}

    resetState();
    onComplete();
  };

  // ─── Cloud Restore ──────────────────────────────────────────
  const handleCloudRestore = async () => {
    if (!cloudPassword) {
      setError("Enter your backup password.");
      return;
    }
    setLoading(true);
    setError(null);
    await new Promise((r) => setTimeout(r, 50));
    try {
      const mnemonic = await restoreFromBackup(cloudPassword);
      if (!isValidMnemonic(mnemonic)) {
        setError("Decryption succeeded but the data is not a valid recovery phrase. Wrong backup file?");
        return;
      }
      await finishRestore(mnemonic);
    } catch (err: any) {
      if (err?.code === "NO_WALLET_ON_ACCOUNT") {
        setError(null);
        setStep("no-wallet");
      } else if (err?.message === "PICKER_CANCELLED") {
        // User cancelled picker — do nothing
      } else if (err?.message === "WRONG_PASSWORD") {
        setError("Wrong password. Please try again.");
      } else if (err?.message === "INVALID_BACKUP_FILE") {
        setError("This doesn't look like a Money Moves backup file.");
      } else {
        setError(err?.message || "Restore failed.");
      }
    } finally {
      setLoading(false);
    }
  };

  // ─── Manual Restore ─────────────────────────────────────────
  const handleManualRestore = async () => {
    const mnemonic = manualWords.map((w) => w.trim().toLowerCase()).join(" ");
    setLoading(true);
    setError(null);
    // Defer to next tick so the spinner renders before CPU-heavy work
    await new Promise((r) => setTimeout(r, 50));
    if (!isValidMnemonic(mnemonic)) {
      setError("Invalid recovery phrase. Please check all 12 words.");
      setLoading(false);
      return;
    }
    try {
      await finishRestore(mnemonic);
    } catch (err: any) {
      if (err?.code === "NO_WALLET_ON_ACCOUNT") {
        setError(null);
        setStep("no-wallet");
      } else {
        setError(err?.message || "Restore failed.");
      }
    } finally {
      setLoading(false);
    }
  };

  // ─── RENDER: Choose method ──────────────────────────────────
  const renderChoose = () => (
    <>
      <View style={styles.iconWrap}>
        <View style={[styles.iconCircle, { backgroundColor: colors.primary + "20" }]}>
          <Feather name="refresh-cw" size={36} color={colors.primary} />
        </View>
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>Restore Wallet</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Choose how you'd like to restore your wallet on this device.
      </Text>

      <TouchableOpacity
        style={[styles.optionCard, { borderColor: colors.border }]}
        onPress={() => { setError(null); setStep("cloud"); }}
      >
        <View style={[styles.optionIcon, { backgroundColor: colors.primary + "15" }]}>
          <Feather name="download-cloud" size={22} color={colors.primary} />
        </View>
        <View style={styles.optionText}>
          <Text style={[styles.optionTitle, { color: colors.foreground }]}>From Cloud Backup</Text>
          <Text style={[styles.optionDesc, { color: colors.mutedForeground }]}>
            Restore from Google Drive, iCloud, or any cloud storage.
          </Text>
        </View>
        <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.optionCard, { borderColor: colors.border }]}
        onPress={() => { setError(null); setStep("manual"); }}
      >
        <View style={[styles.optionIcon, { backgroundColor: "#F59E0B20" }]}>
          <Feather name="edit-3" size={22} color="#F59E0B" />
        </View>
        <View style={styles.optionText}>
          <Text style={[styles.optionTitle, { color: colors.foreground }]}>Enter Recovery Phrase</Text>
          <Text style={[styles.optionDesc, { color: colors.mutedForeground }]}>
            Type your 12-word recovery phrase manually.
          </Text>
        </View>
        <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
        <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
      </TouchableOpacity>
    </>
  );

  // ─── RENDER: Cloud restore ──────────────────────────────────
  const renderCloud = () => (
    <>
      <Text style={[styles.title, { color: colors.foreground }]}>Cloud Restore</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Select your backup file and enter the password you used when creating the backup.
      </Text>

      <TextInput
        style={[styles.input, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]}
        placeholder="Backup password"
        placeholderTextColor={colors.mutedForeground}
        secureTextEntry
        value={cloudPassword}
        onChangeText={setCloudPassword}
      />

      {error && <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>}

      <TouchableOpacity
        style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
        onPress={handleCloudRestore}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={colors.primaryForeground} size="small" />
        ) : (
          <>
            <Feather name="download-cloud" size={18} color={colors.primaryForeground} />
            <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Select Backup File</Text>
          </>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelBtn} onPress={() => { setError(null); setStep("choose"); }}>
        <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Back</Text>
      </TouchableOpacity>
    </>
  );

  // ─── RENDER: Manual restore ─────────────────────────────────
  const renderManual = () => (
    <>
      <Text style={[styles.title, { color: colors.foreground }]}>Enter Recovery Phrase</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Type each of your 12 words in order.
      </Text>

      <View style={styles.wordInputGrid}>
        {[0, 2, 4, 6, 8, 10].map((rowStart) => (
          <View key={rowStart} style={styles.wordInputRow}>
            {[rowStart, rowStart + 1].map((i) => (
              <View key={i} style={styles.wordInputWrap}>
                <Text style={[styles.wordInputNum, { color: colors.mutedForeground }]}>{i + 1}</Text>
                <TextInput
                  style={[styles.wordInput, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]}
                  value={manualWords[i]}
                  onChangeText={(t) => {
                    const words = t.trim().split(/\s+/);
                    if (words.length > 1) {
                      const copy = [...manualWords];
                      for (let j = 0; j < 12; j++) {
                        if (j < words.length) copy[i + j < 12 ? i + j : j] = words[j];
                      }
                      setManualWords(copy);
                    } else {
                      const copy = [...manualWords];
                      copy[i] = t;
                      setManualWords(copy);
                    }
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="..."
                  placeholderTextColor={colors.mutedForeground}
                />
              </View>
            ))}
          </View>
        ))}
      </View>

      {error && <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>}

      <TouchableOpacity
        style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
        onPress={handleManualRestore}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={colors.primaryForeground} size="small" />
        ) : (
          <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Restore Wallet</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelBtn} onPress={() => { setError(null); setStep("choose"); }}>
        <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Back</Text>
      </TouchableOpacity>
    </>
  );

  // ─── RENDER: No wallet on account ───────────────────────────
  const renderNoWallet = () => (
    <>
      <View style={styles.iconWrap}>
        <View style={[styles.iconCircle, { backgroundColor: "#F59E0B20" }]}>
          <Feather name="alert-triangle" size={36} color="#F59E0B" />
        </View>
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>No Wallet Found</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        There's no wallet linked to this account. Would you like to create a new wallet instead?
      </Text>

      <TouchableOpacity
        style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
        onPress={() => {
          resetState();
          if (onCreateNew) onCreateNew();
          else onComplete();
        }}
      >
        <Feather name="plus-circle" size={18} color={colors.primaryForeground} />
        <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Create New Wallet</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelBtn} onPress={() => { setError(null); setStep("choose"); }}>
        <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Back</Text>
      </TouchableOpacity>
    </>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={styles.handle} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {step === "choose" && renderChoose()}
            {step === "cloud" && renderCloud()}
            {step === "manual" && renderManual()}
            {step === "no-wallet" && renderNoWallet()}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "92%",
    paddingBottom: 40,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#ccc",
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 8,
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  iconWrap: {
    alignItems: "center",
    marginTop: 8,
    marginBottom: 16,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
  },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  optionTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  optionDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  input: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    marginBottom: 16,
  },
  errorText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    marginBottom: 12,
  },
  primaryBtn: {
    height: 56,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryBtnText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  cancelBtn: {
    alignItems: "center",
    paddingVertical: 14,
  },
  cancelText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  wordInputGrid: {
    gap: 8,
    marginBottom: 20,
  },
  wordInputRow: {
    flexDirection: "row",
    gap: 8,
  },
  wordInputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  wordInputNum: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    width: 18,
    textAlign: "right",
  },
  wordInput: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
});
