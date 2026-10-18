import React, { useEffect, useState } from "react";
import {
  Keyboard,
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";

/**
 * Bottom sheet shown once after sign-up. Pre-fills the auto-generated username
 * so the user can keep it or pick their own. Fully skippable — friends pay by
 * username, and it can be changed anytime in the profile.
 *
 * Notes:
 *  - Every text style sets an explicit lineHeight. With a custom font (Inter),
 *    iOS clips glyphs without it, which made this sheet render blank while its
 *    full-screen backdrop still swallowed every touch.
 *  - No useSafeAreaInsets() here: inside a Modal there is no SafeAreaProvider,
 *    so the values are unreliable. A fixed bottom padding is used instead.
 *  - The Android keyboard is handled by hand, and not by useKeyboardHeight.
 *    That hook returns 0 on Android on purpose, because Expo resizes the
 *    activity window for the keyboard already. A Modal is not that window - it
 *    is a Dialog with its own, and a translucent one does not get resized - so
 *    inside here Android needs the lift the rest of the app does not.
 *  - The backdrop dismisses, so a mis-rendered sheet can never trap the user.
 */
export function UsernameSheet({
  visible,
  initialUsername,
  onDone,
}: {
  visible: boolean;
  initialUsername: string;
  onDone: (saved: boolean) => void;
}) {
  const colors = useColors();

  /**
   * How far the Android keyboard covers, and nothing on iOS.
   *
   * iOS resizes the modal's own window, so KeyboardAvoidingView below is enough
   * there; adding this as well would lift the sheet twice.
   */
  const [androidKeyboard, setAndroidKeyboard] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "android" || !visible) return;
    const show = Keyboard.addListener("keyboardDidShow", (e) =>
      setAndroidKeyboard(e?.endCoordinates?.height ?? 0),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () => setAndroidKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
      setAndroidKeyboard(0);
    };
  }, [visible]);
  const { updateUser } = useApp();
  const [name, setName] = useState(initialUsername);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    const v = name.trim();
    if (v.length < 3) {
      setErr("Username must be at least 3 characters.");
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(v)) {
      setErr("Only letters, numbers, and underscores.");
      return;
    }
    if (v === initialUsername) {
      onDone(false);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await updateUser({ username: v });
      onDone(true);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "That username is taken. Try another.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent animationType="slide" visible={visible} statusBarTranslucent>
      {/* flex-end, or the sheet stacks from the top of a full-height flex
          container and arrives halfway up the screen with the rounded top
          corners cutting into nothing. Every other sheet in the app sets it on
          its overlay; this one's overlay is the keyboard view. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "flex-end" }}
      >
        {/* Backdrop — tapping it skips, so the sheet can never trap the user. */}
        <Pressable style={styles.backdrop} onPress={() => !busy && onDone(false)} />

        <View style={[styles.sheet, { backgroundColor: colors.card, marginBottom: androidKeyboard }]}>
          <View style={styles.handle} />
          <View style={[styles.iconCircle, { backgroundColor: colors.primary }]}>
            <Feather name="at-sign" size={26} color={colors.primaryForeground} />
          </View>

          <Text style={[styles.title, { color: colors.foreground }]}>Choose a username</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            This is how friends find and pay you. You can change it anytime.
          </Text>

          <View
            style={[
              styles.inputRow,
              { backgroundColor: colors.background, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.at, { color: colors.mutedForeground }]}>@</Text>
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              value={name}
              onChangeText={(t) => {
                setName(t.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 20));
                setErr(null);
              }}
              placeholder="username"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />
          </View>

          {!!err && <Text style={styles.err}>{err}</Text>}

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: busy ? 0.7 : 1 }]}
            onPress={save}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
                Save username
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.skipBtn} onPress={() => onDone(false)} disabled={busy}>
            <Text style={[styles.skipText, { color: colors.mutedForeground }]}>Not now</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 28,
    alignItems: "center",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(150,150,150,0.4)",
    marginBottom: 18,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 21,
    lineHeight: 28,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
    marginBottom: 6,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 13.5,
    lineHeight: 19,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    width: "100%",
  },
  at: { fontSize: 18, lineHeight: 24, fontFamily: "Inter_600SemiBold", marginRight: 2 },
  // No lineHeight on TextInput — iOS clips/offsets the text when it is set.
  input: { flex: 1, height: 52, fontSize: 16, fontFamily: "Inter_600SemiBold" },
  err: {
    color: "#EF4444",
    fontSize: 12.5,
    lineHeight: 17,
    fontFamily: "Inter_500Medium",
    alignSelf: "flex-start",
    marginTop: 8,
  },
  primaryBtn: {
    width: "100%",
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  primaryBtnText: { fontSize: 16, lineHeight: 22, fontFamily: "Inter_600SemiBold" },
  skipBtn: { paddingVertical: 14, marginTop: 2 },
  skipText: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
});
