import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { exportMnemonic } from "@/services/wallet-core";
import { createBackup } from "@/services/wallet-backup";

export default function CloudBackupScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const goHome = () => router.replace("/(tabs)");

  const handleSkip = () => {
    Haptics.selectionAsync().catch(() => {});
    goHome();
  };

  const handleBackup = async () => {
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      const mnemonic = await exportMnemonic();
      await createBackup(mnemonic, password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setSaved(true);
    } catch (e: any) {
      setError(e?.message || "Failed to create backup.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setSaving(false);
    }
  };

  const canSubmit = password.length >= 8 && confirmPassword.length >= 8 && !saving;

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
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {saved ? (
          <>
            <View style={[styles.iconCircle, { backgroundColor: colors.primary + "20" }]}>
              <Feather name="check-circle" size={44} color={colors.primary} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Backup saved
            </Text>
            <Text style={[styles.heading, { color: colors.foreground }]}>
              Your encrypted backup file was{Platform.OS === "web" ? " downloaded" : " shared"}. Keep the file and your password somewhere safe — you&apos;ll need both to recover your wallet.
            </Text>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <InstructionRow
                colors={colors}
                icon="alert-triangle"
                text="We can't recover your password. Losing it means losing access to this backup."
              />
              <InstructionRow
                colors={colors}
                icon="settings"
                text="You can always back up again anytime from Account settings."
              />
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              onPress={goHome}
            >
              <Feather name="arrow-right" size={18} color={colors.primaryForeground} />
              <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
                Go to home
              </Text>
            </TouchableOpacity>
          </>
        ) : (
        <>
        <View style={[styles.iconCircle, { backgroundColor: colors.primary + "20" }]}>
          <Feather name="cloud" size={40} color={colors.primary} />
        </View>

        <Text style={[styles.title, { color: colors.foreground }]}>
          Add a Cloud Backup
        </Text>
        <Text style={[styles.heading, { color: colors.foreground }]}>
          Another way to recover your account if you lose your 12 words.
        </Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <InstructionRow
            colors={colors}
            icon="upload-cloud"
            text="The backup file can be saved to any location. We recommend Google Drive or iCloud."
          />
          <InstructionRow
            colors={colors}
            icon="key"
            text="Use a password you'll remember. We can't recover it for you."
          />
          <InstructionRow
            colors={colors}
            icon="shield"
            text="Save it somewhere secure you can access when you need to."
          />
          <InstructionRow
            colors={colors}
            icon="settings"
            text="You can always back up your account later from Account settings."
          />
        </View>

        <Text style={[styles.label, { color: colors.foreground }]}>
          Backup password
        </Text>
        <View style={[styles.inputRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TextInput
            style={[styles.input, { color: colors.foreground }]}
            placeholder="At least 8 characters"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={(t) => { setPassword(t); setError(null); }}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
            <Feather
              name={showPassword ? "eye-off" : "eye"}
              size={18}
              color={colors.mutedForeground}
            />
          </TouchableOpacity>
        </View>

        <Text style={[styles.label, { color: colors.foreground, marginTop: 12 }]}>
          Confirm password
        </Text>
        <View style={[styles.inputRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TextInput
            style={[styles.input, { color: colors.foreground }]}
            placeholder="Re-enter password"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry={!showPassword}
            value={confirmPassword}
            onChangeText={(t) => { setConfirmPassword(t); setError(null); }}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {error ? (
          <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
        ) : null}

        <TouchableOpacity
          style={[
            styles.primaryBtn,
            { backgroundColor: canSubmit ? colors.primary : colors.muted },
          ]}
          onPress={handleBackup}
          disabled={!canSubmit}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <>
              <Feather
                name="upload-cloud"
                size={18}
                color={canSubmit ? colors.primaryForeground : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.primaryBtnText,
                  { color: canSubmit ? colors.primaryForeground : colors.mutedForeground },
                ]}
              >
                Encrypt & save backup
              </Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} disabled={saving}>
          <Text style={[styles.skipBtnText, { color: colors.mutedForeground }]}>
            Skip for now
          </Text>
        </TouchableOpacity>
        </>
        )}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

function InstructionRow({
  colors,
  icon,
  text,
}: {
  colors: ReturnType<typeof useColors>;
  icon: React.ComponentProps<typeof Feather>["name"];
  text: string;
}) {
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: colors.primary + "15" }]}>
        <Feather name={icon} size={16} color={colors.primary} />
      </View>
      <Text style={[styles.rowText, { color: colors.foreground }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20 },
  scroll: { paddingBottom: 40 },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 20,
    marginTop: 8,
  },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    marginBottom: 6,
  },
  heading: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
    paddingHorizontal: 6,
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 12,
    marginBottom: 24,
  },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  rowText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    lineHeight: 19,
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 6,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    height: 50,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  eyeBtn: { padding: 6 },
  errorText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    marginTop: 12,
  },
  primaryBtn: {
    height: 56,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 20,
  },
  primaryBtnText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  skipBtn: { alignItems: "center", paddingVertical: 16, marginTop: 4 },
  skipBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
