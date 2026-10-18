import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { checkReferralCode } from "@/services/auth";
import { claimReferralCode } from "@/services/user";

/** The server's CLAIM_WINDOW_DAYS: a code can be added until a week after sign-up. */
const CLAIM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type Check = "idle" | "checking" | "valid" | "invalid" | "blocked" | "own" | "unknown";

/**
 * When the week runs out, as a day people can hold in their head.
 *
 * "Until Tue 6 Oct" rather than "6 days left", which has to be worked out
 * against today and is wrong by tomorrow. On the last day the hour is what
 * matters, so it says that. The count is only a fallback for an account
 * restored from a cache that never held the sign-up date.
 */
function closesLabel(createdAt: string | undefined, daysLeft: number): string {
  const opened = createdAt ? new Date(createdAt).getTime() : NaN;
  if (Number.isFinite(opened)) {
    const closes = new Date(opened + CLAIM_WINDOW_MS);
    if (closes.toDateString() === new Date().toDateString()) {
      return `until ${closes.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} today`;
    }
    return `until ${closes.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`;
  }
  return daysLeft <= 1 ? "within a day" : `within ${daysLeft} days`;
}

/**
 * "Did a friend invite you?" - once per account, on Home.
 *
 * Takes the code itself rather than sending people to the referral page for
 * it: the check as you type and the errors are the sign-up field's and the
 * page's, so a code behaves the same wherever it goes in. Dismissing costs
 * nothing - the page, the Loyalty prompt and the Account row stay for the rest
 * of the week, which the line under the field says.
 *
 * Built like the username sheet, for the same reasons: no safe-area hook
 * inside a Modal (the inset comes in as a prop), and the Android keyboard is
 * lifted by hand because a translucent Modal's window is not resized for it.
 */
export function ReferralPromptSheet({ bottomInset, onClose }: { bottomInset: number; onClose: () => void }) {
  const colors = useColors();
  const { user, refreshUser } = useApp();

  const [androidKeyboard, setAndroidKeyboard] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", (e) => setAndroidKeyboard(e?.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener("keyboardDidHide", () => setAndroidKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const [code, setCode] = useState("");
  const [check, setCheck] = useState<Check>("idle");
  const [inviter, setInviter] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ inviter: string | null } | null>(null);

  const clean = code.replace(/\s+/g, "").toUpperCase();
  // Known here without asking: the lookup cannot tell, since it runs as
  // nobody in particular, and the claim would only refuse it after the tap.
  const own = !!user?.referralCode && clean === user.referralCode.toUpperCase();

  /**
   * Checked a beat after the typing stops, as at sign-up. `alive` drops a slow
   * reply that lands after a newer keystroke, so "MM3F" answering late cannot
   * overwrite the verdict on the full code.
   */
  useEffect(() => {
    if (clean.length < 4 || own) {
      setCheck(own ? "own" : "idle");
      setInviter(null);
      return;
    }
    let alive = true;
    setCheck("checking");
    const t = setTimeout(async () => {
      try {
        const r = await checkReferralCode(clean);
        if (!alive) return;
        if (r.valid) {
          setCheck("valid");
          setInviter(r.inviter ?? null);
        } else {
          setCheck(r.reason ? "blocked" : "invalid");
          setInviter(null);
        }
      } catch {
        if (alive) {
          setCheck("unknown");
          setInviter(null);
        }
      }
    }, 450);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [clean, own]);

  const refused = check === "invalid" || check === "blocked" || check === "own";
  const canAdd = clean.length >= 4 && !refused && !adding;

  const add = async () => {
    if (!canAdd) return;
    Keyboard.dismiss();
    setAdding(true);
    setError(null);
    try {
      const r = await claimReferralCode(clean);
      setAdded({ inviter: r.inviter ?? inviter });
      // Closes the week's other prompts - the Account row, the Loyalty card.
      refreshUser();
    } catch (e: any) {
      if (!e?.maintenanceHandled) {
        setError(e?.response?.data?.error || "Could not add that code. Try again.");
      }
    } finally {
      setAdding(false);
    }
  };

  const close = () => {
    if (!adding) onClose();
  };

  const border =
    error || refused ? colors.destructive + "99" : check === "valid" ? colors.primary + "80" : colors.border;

  return (
    <Modal transparent animationType="slide" visible statusBarTranslucent onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "flex-end" }}
      >
        <Pressable style={s.backdrop} onPress={close} />

        <View
          style={[
            s.sheet,
            { backgroundColor: colors.card, paddingBottom: bottomInset + 20, marginBottom: androidKeyboard },
          ]}
        >
          <View style={s.handle} />

          {added ? (
            <>
              <Text style={[s.title, { color: colors.foreground }]}>Code added</Text>
              <Text style={[s.body, { color: colors.mutedForeground }]}>
                {added.inviter
                  ? `The invite now counts for @${added.inviter} on the referrals leaderboard.`
                  : "The invite now counts for your friend on the referrals leaderboard."}
              </Text>
              <TouchableOpacity
                style={[s.doneBtn, { backgroundColor: colors.primary }]}
                onPress={onClose}
                activeOpacity={0.85}
              >
                <Text style={[s.doneText, { color: colors.primaryForeground }]}>Done</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={[s.title, { color: colors.foreground }]}>Did a friend invite you?</Text>
              <Text style={[s.body, { color: colors.mutedForeground }]}>
                Add their code and the invite counts for them on the referrals leaderboard.
              </Text>

              <Text style={[s.label, { color: colors.mutedForeground }]}>Referral code</Text>
              <View style={s.row}>
                <TextInput
                  style={[s.input, { borderColor: border, backgroundColor: colors.background, color: colors.foreground }]}
                  value={code}
                  onChangeText={(t) => {
                    setCode(t.replace(/[^A-Za-z0-9]/g, "").slice(0, 16));
                    if (error) setError(null);
                  }}
                  placeholder="Enter code"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  editable={!adding}
                  returnKeyType="done"
                  onSubmitEditing={add}
                  accessibilityLabel="Referral code"
                />
                <TouchableOpacity
                  style={[s.addBtn, { backgroundColor: colors.primary, opacity: canAdd ? 1 : 0.45 }]}
                  onPress={add}
                  disabled={!canAdd}
                  activeOpacity={0.85}
                >
                  {adding ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : (
                    <Text style={[s.addText, { color: colors.primaryForeground }]}>Add</Text>
                  )}
                </TouchableOpacity>
              </View>

              {error ? (
                <Text style={[s.status, { color: colors.destructive }]}>{error}</Text>
              ) : check === "checking" ? (
                <Text style={[s.status, { color: colors.mutedForeground }]}>Checking the code…</Text>
              ) : check === "valid" ? (
                <View style={s.found}>
                  <Feather name="check" size={15} color={colors.primary} />
                  <Text style={[s.status, s.foundText, { color: colors.foreground }]}>
                    {inviter ? (
                      <>
                        Invited by <Text style={s.foundName}>@{inviter}</Text>
                      </>
                    ) : (
                      "Code found"
                    )}
                  </Text>
                </View>
              ) : check === "invalid" ? (
                <Text style={[s.status, { color: colors.destructive }]}>We don't recognise that code.</Text>
              ) : check === "blocked" ? (
                <Text style={[s.status, { color: colors.destructive }]}>That code can't be used on this phone.</Text>
              ) : check === "own" ? (
                <Text style={[s.status, { color: colors.destructive }]}>That is your own code.</Text>
              ) : check === "unknown" ? (
                <Text style={[s.status, { color: colors.mutedForeground }]}>We'll check it when you tap Add.</Text>
              ) : (
                <Text style={[s.status, { color: colors.mutedForeground }]}>
                  Not handy? Add it later from Invite friends,{" "}
                  {closesLabel(user?.createdAt, user?.referralClaim?.daysLeft ?? 7)}.
                </Text>
              )}

              <TouchableOpacity style={s.skip} onPress={close} disabled={adding}>
                <Text style={[s.skipText, { color: colors.foreground }]}>No one invited me</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.72)" },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 12 },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(150,150,150,0.4)",
    marginBottom: 24,
  },
  title: { fontSize: 22, lineHeight: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.4 },
  body: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular", marginTop: 6 },
  label: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium", marginTop: 22 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  // No lineHeight on the TextInput: iOS clips and offsets the text when it is set.
  input: {
    flex: 1,
    minWidth: 0,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 0,
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
  },
  addBtn: {
    height: 52,
    minWidth: 76,
    paddingHorizontal: 20,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  addText: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_700Bold" },
  status: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium", marginTop: 10 },
  found: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  foundText: { marginTop: 0 },
  foundName: { fontFamily: "Inter_700Bold" },
  skip: { alignSelf: "center", paddingVertical: 14, paddingHorizontal: 20, marginTop: 14 },
  skipText: { fontSize: 16, lineHeight: 22, fontFamily: "Inter_700Bold" },
  doneBtn: { height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", marginTop: 24 },
  doneText: { fontSize: 16, lineHeight: 22, fontFamily: "Inter_600SemiBold" },
});
