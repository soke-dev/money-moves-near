import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Platform, Keyboard,
  TouchableWithoutFeedback, ActivityIndicator, Animated,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { ts } from "@/constants/transfer";

export default function EditNameScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, updateUser } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  /**
   * Nobody edits their name here any more.
   *
   * It comes off the identity document, because it is what a naira deposit is
   * checked against before crypto is released - a name someone could type
   * would let them type the name on whatever account they wanted to fund from.
   * Verification fills it in; nothing else may.
   *
   * The screen is left in place rather than deleted so that anything still
   * holding the route - a deep link, a back-stack entry, a bundle that has not
   * reloaded - lands somewhere that closes cleanly instead of on a missing
   * route. The API refuses the write regardless.
   */
  useEffect(() => {
    router.replace("/account/profile" as any);
  }, [router]);

  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lastRef = useRef<TextInput>(null);

  const first = firstName.trim();
  const last = lastName.trim();
  // Both are required: the field is "Full name", and the backend rejects an
  // empty string rather than reading it as "clear this".
  const complete = first.length > 0 && last.length > 0;
  const hasChanged = first !== (user?.firstName || "") || last !== (user?.lastName || "");
  const canSave = complete && hasChanged && !saving;

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

  const toastAnim = useRef(new Animated.Value(-80)).current;
  const [toastVisible, setToastVisible] = useState(false);

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

  const handleSave = async () => {
    if (!canSave) return;
    Keyboard.dismiss();
    setSaving(true);
    try {
      await updateUser({ firstName: first, lastName: last });
      showToast();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Could not save your name. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {toastVisible && (
        <Animated.View style={[s.toast, { top: topPad + 8, transform: [{ translateY: toastAnim }] }]}>
          <Feather name="check" size={18} color="#fff" />
          <Text style={s.toastText}>Full name updated</Text>
        </Animated.View>
      )}

      <View style={ts.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[ts.headerTitle, { color: colors.foreground }]}>Full name</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Tapping the page puts the keyboard away; the keyboard's own return key
          saves. Neither needs a custom bar above the keys. */}
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={s.body}>
          <Text style={[s.lead, { color: colors.mutedForeground }]}>
            Anyone sending to your username sees this name before they confirm, so it tells them
            they have the right person.
          </Text>

          <View style={[s.inputRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TextInput
              style={[s.input, { color: colors.foreground }]}
              value={firstName}
              onChangeText={(v) => { setFirstName(v); if (error) setError(""); }}
              placeholder="First name"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="words"
              autoCorrect={false}
              autoFocus
              maxLength={50}
              returnKeyType="next"
              onSubmitEditing={() => lastRef.current?.focus()}
            />
          </View>

          <View style={[s.inputRow, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 12 }]}>
            <TextInput
              ref={lastRef}
              style={[s.input, { color: colors.foreground }]}
              value={lastName}
              onChangeText={(v) => { setLastName(v); if (error) setError(""); }}
              placeholder="Last name"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={50}
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
          </View>

          {/* One line, holding whichever state the form is in, so nothing
              appears and shoves the layout around. */}
          <Text
            style={[s.note, { color: error ? colors.destructive : colors.mutedForeground }]}
            numberOfLines={2}
          >
            {error
              ? error
              : complete
                ? "Senders will see " + first + " " + last
                : "Your first and last name, as people would recognise you."}
          </Text>
        </View>
      </TouchableWithoutFeedback>

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
    height: 58,
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 16,
  },
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
