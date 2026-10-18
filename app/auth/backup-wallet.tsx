import React, { useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { exportMnemonic } from "@/services/wallet-core";

type Step = "intro" | "reveal" | "verify";

export default function BackupWalletScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, walletReady } = useApp();

  const [step, setStep] = useState<Step>("intro");
  const [words, setWords] = useState<string[]>([]);
  const [loadingMnemonic, setLoadingMnemonic] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const [verifyIndices, setVerifyIndices] = useState<number[]>([]);
  const [verifyOptions, setVerifyOptions] = useState<string[][]>([]);
  const [verifyAnswers, setVerifyAnswers] = useState<string[]>(["", "", ""]);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  // Wait for wallet to be ready, then load mnemonic from secure storage
  useEffect(() => {
    let cancelled = false;
    const tryLoad = async () => {
      if (!walletReady || words.length > 0) return;
      setLoadingMnemonic(true);
      try {
        const m = await exportMnemonic();
        if (!cancelled) setWords(m.split(" "));
      } catch {
        if (!cancelled) {
          // Wallet not yet saved — retry on next walletReady change
        }
      } finally {
        if (!cancelled) setLoadingMnemonic(false);
      }
    };
    tryLoad();
    return () => {
      cancelled = true;
    };
  }, [walletReady]);

  const handleReveal = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setRevealed(true);
  };

  const startVerify = () => {
    // Pick 3 unique indices, build 4 shuffled options per slot
    const indices: number[] = [];
    while (indices.length < 3) {
      const r = Math.floor(Math.random() * words.length);
      if (!indices.includes(r)) indices.push(r);
    }
    indices.sort((a, b) => a - b);

    const opts = indices.map((idx) => {
      const correct = words[idx];
      const wrong: string[] = [];
      while (wrong.length < 3) {
        const r = Math.floor(Math.random() * words.length);
        if (r !== idx && !wrong.includes(words[r])) wrong.push(words[r]);
      }
      return [correct, ...wrong].sort(() => Math.random() - 0.5);
    });

    setVerifyIndices(indices);
    setVerifyOptions(opts);
    setVerifyAnswers(["", "", ""]);
    setVerifyError(null);
    setStep("verify");
  };

  const handleConfirmVerify = async () => {
    for (let i = 0; i < 3; i++) {
      if (verifyAnswers[i] !== words[verifyIndices[i]]) {
        setVerifyError("One or more words are incorrect. Please try again.");
        setVerifyAnswers(["", "", ""]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        return;
      }
    }
    // All correct — mark backed up and offer cloud backup next
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const backupKey = user ? `@walletBackedUp_${user.id}` : "@walletBackedUp";
    await AsyncStorage.setItem(backupKey, "true");
    router.replace("/auth/cloud-backup" as any);
  };

  // ─── Intro step: forced lead-in explaining why ─────────────
  const renderIntro = () => (
    <View style={styles.centerColumn}>
      <View style={[styles.iconCircle, { backgroundColor: colors.primary + "20" }]}>
        <Feather name="shield" size={44} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>
        Secure Your Wallet
      </Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Money Moves is self-custodial. Your 12-word recovery phrase is the
        ONLY way to restore your wallet. Write it down and verify it now —
        you can&apos;t skip this step.
      </Text>

      <View style={[styles.warningBox, { backgroundColor: colors.destructive + "15" }]}>
        <Feather name="alert-triangle" size={18} color={colors.destructive} />
        <Text style={[styles.warningText, { color: colors.destructive }]}>
          Lose your phrase, lose your funds. We cannot recover it for you.
        </Text>
      </View>

      <View style={[styles.checkList, { borderColor: colors.border }]}>
        <View style={styles.checkItem}>
          <Feather name="check-circle" size={18} color={colors.primary} />
          <Text style={[styles.checkItemText, { color: colors.foreground }]}>
            Have pen and paper ready
          </Text>
        </View>
        <View style={styles.checkItem}>
          <Feather name="check-circle" size={18} color={colors.primary} />
          <Text style={[styles.checkItemText, { color: colors.foreground }]}>
            Somewhere private — no screenshots
          </Text>
        </View>
        <View style={styles.checkItem}>
          <Feather name="check-circle" size={18} color={colors.primary} />
          <Text style={[styles.checkItemText, { color: colors.foreground }]}>
            Never share these 12 words with anyone
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={[
          styles.primaryBtn,
          {
            backgroundColor: walletReady && words.length > 0 ? colors.primary : colors.muted,
          },
        ]}
        onPress={() => setStep("reveal")}
        disabled={!walletReady || words.length === 0}
      >
        {loadingMnemonic || !walletReady || words.length === 0 ? (
          <>
            <ActivityIndicator size="small" color={colors.mutedForeground} />
            <Text style={[styles.primaryBtnText, { color: colors.mutedForeground }]}>
              Preparing your wallet…
            </Text>
          </>
        ) : (
          <>
            <Feather name="arrow-right" size={18} color={colors.primaryForeground} />
            <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
              I&apos;m ready — show my phrase
            </Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );

  // ─── Reveal step: show the 12 words ───────────────────────
  const renderReveal = () => (
    <>
      <View style={[styles.iconCircle, { backgroundColor: "#F59E0B20", alignSelf: "center" }]}>
        <Feather name="alert-triangle" size={36} color="#F59E0B" />
      </View>

      <Text style={[styles.title, { color: colors.foreground }]}>
        Your Recovery Phrase
      </Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Write down these 12 words in order. Store them somewhere safe and offline.
      </Text>

      {revealed ? (
        <View style={styles.grid}>
          {words.map((w, i) => (
            <View
              key={i}
              style={[styles.wordCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={[styles.wordIndex, { color: colors.mutedForeground }]}>
                {i + 1}
              </Text>
              <Text style={[styles.wordText, { color: colors.foreground }]}>
                {w}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.revealBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={handleReveal}
        >
          <Feather name="eye" size={24} color={colors.mutedForeground} />
          <Text style={[styles.revealText, { color: colors.mutedForeground }]}>
            Tap to reveal recovery phrase
          </Text>
        </TouchableOpacity>
      )}

      {revealed && (
        <TouchableOpacity
          style={styles.checkRow}
          onPress={() => setConfirmed((v) => !v)}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.checkbox,
              {
                borderColor: confirmed ? colors.primary : colors.border,
                backgroundColor: confirmed ? colors.primary : "transparent",
              },
            ]}
          >
            {confirmed && <Feather name="check" size={14} color={colors.primaryForeground} />}
          </View>
          <Text style={[styles.checkText, { color: colors.foreground }]}>
            I&apos;ve written down all 12 words in order
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[
          styles.primaryBtn,
          {
            backgroundColor: confirmed ? colors.primary : colors.muted,
            marginTop: 16,
          },
        ]}
        onPress={startVerify}
        disabled={!confirmed}
      >
        <Feather
          name="arrow-right"
          size={18}
          color={confirmed ? colors.primaryForeground : colors.mutedForeground}
        />
        <Text
          style={[
            styles.primaryBtnText,
            { color: confirmed ? colors.primaryForeground : colors.mutedForeground },
          ]}
        >
          Continue to verification
        </Text>
      </TouchableOpacity>
    </>
  );

  // ─── Verify step: prove 3 random words ────────────────────
  const renderVerify = () => (
    <>
      <View style={[styles.iconCircle, { backgroundColor: colors.primary + "20", alignSelf: "center" }]}>
        <Feather name="check-square" size={36} color={colors.primary} />
      </View>

      <Text style={[styles.title, { color: colors.foreground }]}>
        Verify Your Phrase
      </Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Pick the correct word for each position to prove you saved it.
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
                      backgroundColor: selected ? colors.primary + "15" : colors.card,
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

      {verifyError ? (
        <Text style={[styles.errorText, { color: colors.destructive }]}>{verifyError}</Text>
      ) : null}

      <TouchableOpacity
        style={[
          styles.primaryBtn,
          {
            backgroundColor: verifyAnswers.every(Boolean) ? colors.primary : colors.muted,
          },
        ]}
        onPress={handleConfirmVerify}
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
          Confirm &amp; Finish
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.textBtn}
        onPress={() => {
          setRevealed(true);
          setConfirmed(false);
          setStep("reveal");
        }}
      >
        <Text style={[styles.textBtnLabel, { color: colors.mutedForeground }]}>
          View phrase again
        </Text>
      </TouchableOpacity>
    </>
  );

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: topPad + 16,
          paddingBottom: bottomPad + 16,
        },
      ]}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {step === "intro" && renderIntro()}
        {step === "reveal" && renderReveal()}
        {step === "verify" && renderVerify()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20 },
  scroll: { paddingBottom: 40 },
  centerColumn: { alignItems: "center" },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    marginTop: 8,
  },
  title: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
    paddingHorizontal: 6,
  },
  warningBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 14,
    borderRadius: 12,
    marginBottom: 20,
    gap: 10,
    alignSelf: "stretch",
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    lineHeight: 18,
  },
  checkList: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 12,
    marginBottom: 24,
    alignSelf: "stretch",
  },
  checkItem: { flexDirection: "row", alignItems: "center", gap: 10 },
  checkItemText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 20,
  },
  wordCard: {
    width: "30%",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  wordIndex: { fontSize: 12, fontFamily: "Inter_600SemiBold", minWidth: 16 },
  wordText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  revealBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    marginBottom: 20,
    gap: 8,
  },
  revealText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkText: { fontSize: 14, flex: 1, fontFamily: "Inter_500Medium" },
  primaryBtn: {
    height: 56,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    alignSelf: "stretch",
  },
  primaryBtnText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  verifyLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 10 },
  optionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  optionChip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  optionChipText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  errorText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    marginBottom: 12,
  },
  textBtn: { alignItems: "center", paddingVertical: 14, marginTop: 4 },
  textBtnLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
