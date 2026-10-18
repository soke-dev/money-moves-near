import React, { useState } from "react";
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { declareNin } from "@/services/funding";

/**
 * Asks for the NIN their ID did not carry.
 *
 * A Nigerian passport does not print the national number anywhere a scanner
 * can read - the machine-readable zone leaves that field empty - so somebody
 * who verified with one is fully approved and still cannot be given a payment
 * account. Re-verifying never fixes it, because the number is not on the
 * document. Asking is the only way through.
 *
 * Shared by both places that open a payment account, so the explanation and
 * the rules about what the bank accepts live in one place rather than drifting
 * apart in two.
 *
 * It is a question, not an error. The wording avoids anything that sounds like
 * the person did something wrong: they verified correctly, with a real
 * passport, and the gap is ours to explain.
 */
export default function NinPrompt({
  visible,
  message,
  onCancel,
  onSaved,
}: {
  visible: boolean;
  /** What the server said it needs. Falls back to our own wording. */
  message?: string | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const colors = useColors();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  /**
   * Eleven digits and no leading zero.
   *
   * Flutterwave reads the NIN as a number, so one starting with 0 is ten
   * digits to it and is refused every time. Checking here means somebody is
   * told by the field rather than by a failed deposit.
   */
  const ready = /^[1-9]\d{10}$/.test(value);

  const save = async () => {
    if (busy || !ready) return;
    setErr("");
    setBusy(true);
    try {
      await declareNin(value);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setValue("");
      onSaved();
    } catch (e: any) {
      setErr(
        e?.response?.data?.error ||
          "We could not save that. Please check the number and try again.",
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={s.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[s.card, { backgroundColor: colors.card }]}>
          <View style={[s.disc, { backgroundColor: colors.primary }]}>
            <Feather name="hash" size={20} color={colors.primaryForeground} />
          </View>

          <Text style={[s.title, { color: colors.foreground }]}>One more number</Text>
          <Text style={[s.body, { color: colors.mutedForeground }]}>
            {message || "Your bank needs your National Identity Number to open a payment account"}
            {" — and a passport doesn't print it anywhere we can read."}
          </Text>

          <TextInput
            value={value}
            onChangeText={(t) => {
              setValue(t.replace(/\D/g, "").slice(0, 11));
              if (err) setErr("");
            }}
            keyboardType="number-pad"
            placeholder="00000000000"
            placeholderTextColor={colors.mutedForeground + "55"}
            maxLength={11}
            autoFocus
            style={[
              s.input,
              {
                color: colors.foreground,
                backgroundColor: colors.background,
                borderColor: err ? colors.destructive : ready ? colors.primary : colors.border,
              },
            ]}
          />

          <Text style={[s.note, { color: err ? colors.destructive : colors.mutedForeground }]}>
            {err || "11 digits, from your NIN slip or the NIMC app."}
          </Text>

          <TouchableOpacity
            style={[s.cta, { backgroundColor: colors.primary, opacity: ready && !busy ? 1 : 0.45 }]}
            onPress={save}
            disabled={!ready || busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[s.ctaText, { color: colors.primaryForeground }]}>Continue</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={onCancel} disabled={busy} style={s.cancel}>
            <Text style={[s.cancelText, { color: colors.mutedForeground }]}>Not now</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  card: { borderRadius: 26, paddingHorizontal: 22, paddingTop: 26, paddingBottom: 18 },
  disc: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  title: {
    fontSize: 19,
    lineHeight: 25,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.4,
    textAlign: "center",
    marginTop: 14,
  },
  body: {
    fontSize: 13.5,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 10,
  },
  // Wide tracking and a centred line, so eleven digits can be checked against a
  // slip at a glance rather than read as one long number.
  input: {
    width: "100%",
    height: 58,
    borderRadius: 16,
    borderWidth: 1.5,
    marginTop: 20,
    textAlign: "center",
    fontSize: 20,
    letterSpacing: 4,
    fontFamily: "Inter_700Bold",
  },
  note: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: "Inter_400Regular",
    marginTop: 10,
    textAlign: "center",
  },
  cta: {
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  ctaText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  cancel: { height: 44, alignItems: "center", justifyContent: "center", marginTop: 2 },
  cancelText: { fontSize: 13.5, fontFamily: "Inter_600SemiBold" },
});
