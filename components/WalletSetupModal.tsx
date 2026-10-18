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
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { exportMnemonic } from "@/services/wallet-core";
import { createBackup } from "@/services/wallet-backup";

interface Props {
  visible: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

/**
 * Backup prompt shown after wallet is auto-created.
 * Offers cloud backup and shows the 12-word phrase.
 */
export function WalletSetupModal({ visible, onComplete, onSkip }: Props) {
  const colors = useColors();
  const [step, setStep] = useState<"prompt" | "words" | "verify" | "backup" | "warn">("prompt");
  const [mnemonic, setMnemonicWords] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupPassword, setBackupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Verify step state
  const [verifyIndices, setVerifyIndices] = useState<number[]>([]);
  const [verifyAnswers, setVerifyAnswers] = useState<string[]>(["", "", ""]);
  const [verifyOptions, setVerifyOptions] = useState<string[][]>([[], [], []]);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const loadWords = async () => {
    setLoading(true);
    try {
      const m = await exportMnemonic();
      setMnemonicWords(m.split(" "));
      setStep("words");
    } catch {
      setError("Could not load recovery phrase.");
    } finally {
      setLoading(false);
    }
  };

  const handleBackup = async () => {
    if (backupPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (backupPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const m = await exportMnemonic();
      await createBackup(m, backupPassword);
      onComplete();
    } catch (err: any) {
      setError(err?.message || "Backup failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    setStep("warn");
  };

  /** Pick 3 random word positions and generate 4 shuffled options for each */
  const startVerify = () => {
    // Pick 3 unique random indices
    const indices: number[] = [];
    while (indices.length < 3) {
      const r = Math.floor(Math.random() * mnemonic.length);
      if (!indices.includes(r)) indices.push(r);
    }
    indices.sort((a, b) => a - b);

    // For each index, create 4 options: the correct word + 3 random wrong words
    const opts = indices.map((idx) => {
      const correct = mnemonic[idx];
      const wrong: string[] = [];
      while (wrong.length < 3) {
        const r = Math.floor(Math.random() * mnemonic.length);
        if (r !== idx && !wrong.includes(mnemonic[r])) wrong.push(mnemonic[r]);
      }
      // Shuffle all 4
      return [correct, ...wrong].sort(() => Math.random() - 0.5);
    });

    setVerifyIndices(indices);
    setVerifyOptions(opts);
    setVerifyAnswers(["", "", ""]);
    setVerifyError(null);
    setStep("verify");
  };

  const handleVerify = () => {
    for (let i = 0; i < 3; i++) {
      if (verifyAnswers[i] !== mnemonic[verifyIndices[i]]) {
        setVerifyError("One or more words are incorrect. Please try again.");
        setVerifyAnswers(["", "", ""]);
        return;
      }
    }
    // All correct — backup verified
    onComplete();
  };

  // ─── Warn: custom skip confirmation ──────────────────────────
  const renderWarn = () => (
    <>
      <View style={styles.iconWrap}>
        <View style={[styles.iconCircle, { backgroundColor: "#EF444420" }]}>
          <Feather name="alert-triangle" size={40} color="#EF4444" />
        </View>
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>Skip Backup?</Text>
      <Text style={[styles.warnBody, { color: colors.mutedForeground }]}>
        Without a backup you may{" "}
        <Text style={{ color: "#EF4444", fontFamily: "Inter_700Bold" }}>permanently lose access</Text>
        {" "}to your wallet if you lose this device.
      </Text>
      <Text style={[styles.warnHint, { color: colors.mutedForeground }]}>
        You can back up later from Settings → Export Wallet.
      </Text>

      <TouchableOpacity
        style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
        onPress={() => setStep("backup")}
      >
        <Feather name="shield" size={18} color={colors.primaryForeground} />
        <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Back Up Now</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.dangerBtn, { borderColor: "#EF4444" }]}
        onPress={onSkip}
      >
        <Text style={styles.dangerBtnText}>Skip Anyway</Text>
      </TouchableOpacity>
    </>
  );

  // \u2500\u2500\u2500 Prompt: "Your wallet is ready" \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const renderPrompt = () => (
    <>
      <View style={styles.iconWrap}>
        <View style={[styles.iconCircle, { backgroundColor: "#10B98120" }]}>
          <Feather name="check-circle" size={40} color="#10B981" />
        </View>
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>Wallet Ready!</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Your multi-chain wallet has been created. Back it up now so you never lose access to your funds.
      </Text>

      <TouchableOpacity
        style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
        onPress={() => setStep("backup")}
      >
        <Feather name="upload-cloud" size={18} color={colors.primaryForeground} />
        <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Back Up to Cloud</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.outlineBtn, { borderColor: colors.border }]}
        onPress={loadWords}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator size="small" color={colors.foreground} />
        ) : (
          <>
            <Feather name="eye" size={18} color={colors.foreground} />
            <Text style={[styles.outlineBtnText, { color: colors.foreground }]}>View Recovery Phrase</Text>
          </>
        )}
      </TouchableOpacity>
      
      <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
        <Text style={[styles.skipText, { color: colors.mutedForeground }]}>I'll do this later</Text>
      </TouchableOpacity>
    </>
  );

  // \u2500\u2500\u2500 Words: show 12-word phrase\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const renderWords = () => (
    <>
      <View style={styles.iconWrap}>
        <View style={[styles.iconCircle, { backgroundColor: "#F59E0B20" }]}>
          <Feather name="alert-triangle" size={36} color="#F59E0B" />
        </View>
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>Recovery Phrase</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Write these 12 words down in order. Never share them with anyone.
      </Text>

      <View style={styles.wordGrid}>
        {mnemonic.map((w, i) => (
          <View key={i} style={[styles.wordChip, { backgroundColor: colors.muted }]}>
            <Text style={[styles.wordNum, { color: colors.mutedForeground }]}>{i + 1}</Text>
            <Text style={[styles.wordText, { color: colors.foreground }]}>{w}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
        onPress={startVerify}
      >
        <Feather name="check-circle" size={18} color={colors.primaryForeground} />
        <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>I've Written It Down</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.outlineBtn, { borderColor: colors.border }]}
        onPress={() => setStep("backup")}
      >
        <Feather name="upload-cloud" size={18} color={colors.foreground} />
        <Text style={[styles.outlineBtnText, { color: colors.foreground }]}>Back Up to Cloud Instead</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
        <Text style={[styles.skipText, { color: colors.mutedForeground }]}>I'll do this later</Text>
      </TouchableOpacity>
    </>
  );

  // \u2500\u2500\u2500 Backup: password + upload \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const renderVerify = () => (
    <>
      <View style={styles.iconWrap}>
        <View style={[styles.iconCircle, { backgroundColor: colors.primary + "20" }]}>
          <Feather name="check-square" size={36} color={colors.primary} />
        </View>
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>Verify Phrase</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Select the correct word for each position to confirm you've saved your recovery phrase.
      </Text>

      {verifyIndices.map((wordIdx, i) => (
        <View key={wordIdx} style={{ marginBottom: 20 }}>
          <Text style={[styles.verifyLabel, { color: colors.foreground }]}>
            Word #{wordIdx + 1}
          </Text>
          <View style={styles.optionsRow}>
            {verifyOptions[i].map((word) => {
              const selected = verifyAnswers[i] === word;
              return (
                <TouchableOpacity
                  key={word}
                  style={[
                    styles.optionChip,
                    {
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primary + "15" : colors.muted,
                    },
                  ]}
                  onPress={() => {
                    const next = [...verifyAnswers];
                    next[i] = word;
                    setVerifyAnswers(next);
                    setVerifyError(null);
                  }}
                >
                  <Text
                    style={[
                      styles.optionChipText,
                      { color: selected ? colors.primary : colors.foreground },
                    ]}
                  >
                    {word}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}

      {verifyError && (
        <Text style={[styles.errorText, { color: colors.destructive }]}>{verifyError}</Text>
      )}

      <TouchableOpacity
        style={[
          styles.primaryBtn,
          {
            backgroundColor: verifyAnswers.every(Boolean) ? colors.primary : colors.muted,
          },
        ]}
        onPress={handleVerify}
        disabled={!verifyAnswers.every(Boolean)}
      >
        <Feather
          name="check"
          size={18}
          color={verifyAnswers.every(Boolean) ? colors.primaryForeground : colors.mutedForeground}
        />
        <Text
          style={[
            styles.primaryBtnText,
            {
              color: verifyAnswers.every(Boolean) ? colors.primaryForeground : colors.mutedForeground,
            },
          ]}
        >
          Confirm
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.skipBtn} onPress={() => setStep("words")}>
        <Text style={[styles.skipText, { color: colors.mutedForeground }]}>Go Back</Text>
      </TouchableOpacity>
    </>
  );

  const renderBackup = () => (
    <>
      <View style={styles.iconWrap}>
        <View style={[styles.iconCircle, { backgroundColor: colors.primary + "20" }]}>
          <Feather name="upload-cloud" size={36} color={colors.primary} />
        </View>
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>Cloud Backup</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Choose a strong password to encrypt your backup. Save the file to Google Drive, iCloud, or any cloud.
      </Text>

      <TextInput
        style={[styles.input, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]}
        placeholder="Backup password (min 8 chars)"
        placeholderTextColor={colors.mutedForeground}
        secureTextEntry
        value={backupPassword}
        onChangeText={setBackupPassword}
      />
      <TextInput
        style={[styles.input, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]}
        placeholder="Confirm password"
        placeholderTextColor={colors.mutedForeground}
        secureTextEntry
        value={confirmPassword}
        onChangeText={setConfirmPassword}
      />

      {error && <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>}

      <TouchableOpacity
        style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
        onPress={handleBackup}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={colors.primaryForeground} size="small" />
        ) : (
          <>
            <Feather name="upload-cloud" size={18} color={colors.primaryForeground} />
            <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Save Backup</Text>
          </>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
        <Text style={[styles.skipText, { color: colors.mutedForeground }]}>Skip for now</Text>
      </TouchableOpacity>
    </>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={styles.handle} />
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {step === "prompt" && renderPrompt()}
            {step === "words" && renderWords()}
            {step === "verify" && renderVerify()}
            {step === "backup" && renderBackup()}
            {step === "warn" && renderWarn()}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
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
  primaryBtn: {
    height: 56,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 10,
  },
  primaryBtnText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  outlineBtn: {
    height: 56,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    marginBottom: 4,
  },
  outlineBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  skipBtn: {
    alignItems: "center",
    paddingVertical: 14,
  },
  skipText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  errorText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    marginBottom: 12,
  },
  input: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    marginBottom: 12,
  },
  wordGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 24,
    justifyContent: "center",
  },
  wordChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    gap: 6,
    minWidth: "28%",
  },
  wordNum: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    width: 18,
  },
  wordText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  warnBody: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 8,
  },
  warnHint: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 24,
  },
  dangerBtn: {
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    marginTop: 4,
  },
  dangerBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#EF4444",
  },
  verifyLabel: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 10,
  },
  optionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionChip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  optionChipText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
