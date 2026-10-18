import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  Modal,
  Animated,
  KeyboardAvoidingView,
  ScrollView,
  Keyboard,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

const MAX_LENGTH = 200;

export default function ReportTransactionScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { referenceId } = useLocalSearchParams<{ referenceId: string }>();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const sheetAnim = useRef(new Animated.Value(400)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const checkAnim = useRef(new Animated.Value(0)).current;

  const canSubmit = description.trim().length > 0 && !submitting;

  const animateSuccess = () => {
    sheetAnim.setValue(400);
    overlayAnim.setValue(1);
    checkAnim.setValue(0);
    setShowSuccess(true);
    Animated.spring(sheetAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }).start(() => {
      Animated.spring(checkAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 5 }).start();
    });
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    Keyboard.dismiss();
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 1500));
    setSubmitting(false);
    animateSuccess();
  };

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.foreground }]}>Report transaction</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={topPad + 56}
      >
        <ScrollView
          contentContainerStyle={[s.content, { paddingBottom: bottomPad + 90 }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[s.subtitle, { color: colors.mutedForeground }]}>
            Complete the form below to report this transaction.
          </Text>

          <Text style={[s.label, { color: colors.foreground }]}>Reference ID</Text>
          <View style={[s.refBox, { backgroundColor: colors.muted }]}>
            <Text style={[s.refText, { color: colors.mutedForeground }]}>
              {referenceId || "N/A"}
            </Text>
          </View>

          <Text style={[s.label, { color: colors.foreground }]}>Tell us more</Text>
          <View style={[s.textareaWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <TextInput
              style={[s.textarea, { color: colors.foreground }]}
              placeholder="Explain the issue"
              placeholderTextColor={colors.mutedForeground}
              multiline
              maxLength={MAX_LENGTH}
              value={description}
              onChangeText={setDescription}
              textAlignVertical="top"
            />
          </View>
          <Text style={[s.charCount, { color: colors.mutedForeground }]}>
            {description.length}/{MAX_LENGTH}
          </Text>
        </ScrollView>

        <View style={[s.bottomBar, { paddingBottom: bottomPad + 16, backgroundColor: colors.background }]}>
          <TouchableOpacity
            style={[s.sendBtn, { backgroundColor: colors.foreground, opacity: canSubmit ? 1 : 0.5 }]}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            <Text style={[s.sendBtnText, { color: colors.background }]}>
              {submitting ? "Sending..." : "Send"}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Success Bottom Sheet */}
      {showSuccess && (
        <Modal transparent animationType="none" visible>
          <View style={s.overlay}>
            <Animated.View style={[s.dimBg, { opacity: overlayAnim }]} />
            <Animated.View
              style={[s.sheet, { backgroundColor: colors.card, paddingBottom: bottomPad + 24, transform: [{ translateY: sheetAnim }] }]}
            >
              <View style={s.handle} />

              <Animated.View style={[s.checkOuter, { borderColor: "#22c55e44", transform: [{ scale: checkAnim }] }]}>
                <View style={s.checkInner}>
                  <Feather name="check" size={32} color="#fff" />
                </View>
              </Animated.View>

              <Text style={[s.successTitle, { color: colors.foreground }]}>Report Submitted</Text>
              <Text style={[s.successSub, { color: colors.mutedForeground }]}>
                We've received your report and will review it shortly. You'll be notified of any updates.
              </Text>

              <TouchableOpacity
                style={[s.doneBtn, { backgroundColor: colors.foreground }]}
                onPress={() => {
                  setShowSuccess(false);
                  router.back();
                }}
              >
                <Text style={[s.doneBtnText, { color: colors.background }]}>Done</Text>
              </TouchableOpacity>
            </Animated.View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  content: { paddingHorizontal: 20, paddingTop: 8 },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginBottom: 28,
  },
  label: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 8,
  },
  refBox: {
    height: 52,
    borderRadius: 12,
    justifyContent: "center",
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  refText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  textareaWrap: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    minHeight: 140,
  },
  textarea: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    minHeight: 110,
  },
  charCount: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 6,
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  sendBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },

  /* Success sheet */
  overlay: { flex: 1, justifyContent: "flex-end" },
  dimBg: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.85)" },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: "#ccc", marginBottom: 32 },
  checkOuter: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 3,
    alignItems: "center", justifyContent: "center", marginBottom: 20,
  },
  checkInner: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: "#22c55e",
    alignItems: "center", justifyContent: "center",
  },
  successTitle: { fontSize: 22, fontFamily: "Inter_700Bold", marginBottom: 8 },
  successSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20, marginBottom: 32, paddingHorizontal: 8 },
  doneBtn: { width: "100%", height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  doneBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
