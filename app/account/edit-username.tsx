import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Platform, Keyboard,
  TouchableWithoutFeedback, ActivityIndicator, Animated,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { checkUsername } from "@/services/user";
import { ts } from "@/constants/transfer";

export default function EditUsernameScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, updateUser } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [username, setUsername] = useState(user?.username || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [availMsg, setAvailMsg] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trimmed = username.trim();
  const hasChanged = trimmed !== (user?.username || "");
  const canSave = hasChanged && available === true && !saving;

  /**
   * The save button rides the keyboard.
   *
   * This is what the custom Done bar was standing in for: something useful
   * above the keys. The real action fits there, so the bar is not needed and
   * the button is never stranded behind the keyboard.
   */
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const [toastVisible, setToastVisible] = useState(false);
  const toastAnim = useRef(new Animated.Value(-80)).current;

  const showToast = useCallback(() => {
    setToastVisible(true);
    Animated.timing(toastAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start();
    setTimeout(() => {
      Animated.timing(toastAnim, { toValue: -80, duration: 300, useNativeDriver: true }).start(() => {
        setToastVisible(false);
        router.back();
      });
    }, 1500);
  }, [toastAnim, router]);

  // Debounced availability check
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!trimmed || trimmed.length < 3 || trimmed === user?.username) {
      setAvailable(null);
      setAvailMsg("");
      setChecking(false);
      return;
    }

    setChecking(true);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await checkUsername(trimmed);
        setAvailable(res.available);
        setAvailMsg(res.available ? "Available" : res.reason || "That username is taken");
      } catch {
        setAvailable(null);
        setAvailMsg("");
      } finally {
        setChecking(false);
      }
    }, 500);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [trimmed, user?.username]);

  const handleSave = async () => {
    if (!canSave) return;
    Keyboard.dismiss();
    setSaving(true);
    try {
      await updateUser({ username: trimmed });
      showToast();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Could not update your username");
    } finally {
      setSaving(false);
    }
  };

  // One line under the field, carrying whichever state the field is in. The
  // rules sit there when there is nothing to report, so the screen never has a
  // badge appear and shove the layout down.
  const noteColor =
    error || available === false ? colors.destructive
      : available === true ? colors.primary
        : colors.mutedForeground;
  const note =
    error || availMsg || "Letters, numbers and underscores. At least 3 characters.";

  const borderColor =
    error || available === false ? colors.destructive
      : available === true ? colors.primary
        : colors.border;

  return (
    <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {toastVisible && (
        <Animated.View style={[s.toast, { top: topPad + 8, transform: [{ translateY: toastAnim }] }]}>
          <Feather name="check" size={18} color="#fff" />
          <Text style={s.toastText}>Username updated</Text>
        </Animated.View>
      )}

      <View style={ts.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[ts.headerTitle, { color: colors.foreground }]}>Username</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Tapping the page puts the keyboard away, which is why there is no
          custom Done bar above it any more. */}
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={s.body}>
          <Text style={[s.lead, { color: colors.mutedForeground }]}>
            People can send you money with your username instead of a wallet address.
          </Text>

          <View style={[s.inputRow, { backgroundColor: colors.card, borderColor }]}>
            <Text style={[s.at, { color: colors.mutedForeground }]}>@</Text>
            <TextInput
              style={[s.input, { color: colors.foreground }]}
              value={username}
              // Invalid characters are dropped as they are typed rather than
              // rejected on save: the rule is the keyboard, not an error.
              onChangeText={(v) => {
                setUsername(v.replace(/[^a-zA-Z0-9_]/g, ""));
                if (error) setError("");
              }}
              placeholder="username"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              maxLength={30}
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
            {checking ? (
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            ) : available === true ? (
              <Feather name="check" size={18} color={colors.primary} />
            ) : available === false ? (
              <Feather name="x" size={18} color={colors.destructive} />
            ) : null}
          </View>

          <Text style={[s.note, { color: noteColor }]}>{note}</Text>
        </View>
      </TouchableWithoutFeedback>

      {/* One button. Back already discards, so a second full-size button only
          gave the screen a decision it did not have. */}
      <View
        style={[
          ts.bottomBar,
          {
            bottom: kbHeight,
            paddingBottom: kbHeight > 0 ? 14 : bottomPad + 16,
            backgroundColor: colors.background,
          },
        ]}
      >
        <TouchableOpacity
          style={[ts.primaryBtn, { backgroundColor: canSave ? colors.primary : colors.muted }]}
          onPress={handleSave}
          disabled={!canSave}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Text
              style={[
                ts.primaryBtnText,
                { color: canSave ? colors.primaryForeground : colors.mutedForeground },
              ]}
            >
              Save changes
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: 20, paddingTop: 6 },
  lead: { fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_400Regular", marginBottom: 22 },

  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 58,
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 16,
  },
  at: { fontSize: 17, lineHeight: 23, fontFamily: "Inter_600SemiBold" },
  input: { flex: 1, height: "100%", fontSize: 17, fontFamily: "Inter_600SemiBold", padding: 0 },
  note: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 10, marginLeft: 4 },

  toast: {
    position: "absolute", left: 20, right: 20, zIndex: 20,
    backgroundColor: "#22c55e", borderRadius: 30, paddingVertical: 12, paddingHorizontal: 20,
    flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 8,
    elevation: 6,
  },
  toastText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
