import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Linking,
  ScrollView,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useKeyboardHeight } from "@/hooks/useKeyboardHeight";
import { useApp } from "@/context/AppContext";
import { dynamicClient } from "@/config/dynamic";
import { getDynamicToken, waitForDynamicToken } from "@/services/dynamic-wallet";
import { checkReferralCode } from "@/services/auth";
import { WorkingDots } from "@/components/WorkingDots";
import { takeSessionEndReason } from "@/services/session";

/**
 * Where a typed referral code stands.
 *
 * `unknown` is deliberately not a refusal: offline or rate-limited, we cannot
 * say either way, and the server checks again at sign-up. A flaky connection
 * should not cost somebody's friend the referral.
 */
type RefState = "idle" | "checking" | "valid" | "invalid" | "blocked" | "unknown";

const TERMS_URL = "https://usemoneymoves.xyz/terms";
const PRIVACY_URL = "https://usemoneymoves.xyz/privacy";

/**
 * Email-only sign in / sign up via Dynamic.xyz.
 *   email → Dynamic sends a 6-digit code → enter it → we exchange the Dynamic JWT
 *   for our session → route to Set PIN (new) or PIN (returning).
 * Works for both new and existing users (backend upserts by email).
 */
export default function DynamicOnboarding() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { authenticateDynamic } = useApp();

  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // Here because a session ended rather than by choice: said once, above the email.
  const [ended] = useState(takeSessionEndReason);
  const codeRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);

  // ── Referral code: optional, and tucked away ──
  // The same screen signs people in, so the field stays hidden until asked
  // for. A returning user never has to look at it.
  const [showRef, setShowRef] = useState(false);
  const [refCode, setRefCode] = useState("");
  const [refState, setRefState] = useState<RefState>("idle");
  const [inviter, setInviter] = useState<string | null>(null);
  const refInputRef = useRef<TextInput>(null);
  const cleanRef = refCode.replace(/\s+/g, "").toUpperCase();

  /**
   * Checked as it is typed, a beat after the typing stops.
   *
   * Depends only on the code and the toggle, and writes neither, so it cannot
   * re-trigger itself. `alive` drops a slow reply that lands after a newer
   * keystroke - otherwise "MM3F" answering late could overwrite "MM3FA9C1"
   * with "we don't recognise that code".
   */
  useEffect(() => {
    if (!showRef || cleanRef.length < 4) {
      setRefState("idle");
      setInviter(null);
      return;
    }
    let alive = true;
    setRefState("checking");
    const t = setTimeout(async () => {
      try {
        const r = await checkReferralCode(cleanRef);
        if (!alive) return;
        if (r.valid) {
          setRefState("valid");
          setInviter(r.inviter ?? null);
        } else {
          setRefState(r.reason ? "blocked" : "invalid");
          setInviter(null);
        }
      } catch {
        if (alive) {
          setRefState("unknown");
          setInviter(null);
        }
      }
    }, 450);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [cleanRef, showRef]);

  /**
   * What goes with the sign-in: the code unless we know it is wrong.
   *
   * `unknown` and `checking` still send it - the server decides, and it only
   * reads the code at all when this turns out to be a new account.
   */
  const referralToSend =
    showRef && cleanRef.length >= 4 && refState !== "invalid" && refState !== "blocked"
      ? cleanRef
      : undefined;

  const openRef = () => {
    setShowRef(true);
    setTimeout(() => refInputRef.current?.focus(), 60);
  };
  const removeRef = () => {
    setShowRef(false);
    setRefCode("");
  };

  /**
   * How far the keyboard covers, used to lift the footer.
   *
   * Two listeners, not one. "WillChangeFrame" animates the lift with the
   * keyboard, but it can be missed - the keyboard already up when the screen
   * mounts, or a frame change that arrives before the effect runs - and a miss
   * leaves this at 0 with the only button on the screen buried under the keys.
   * "DidShow" always lands, so it backstops the value.
   *
   * KeyboardAvoidingView is not used here: at the bottom of a column it
   * measures its own frame against the window and pads by far more than the
   * keyboard, which collapsed the scroll area and left the screen blank.
   */
  /**
   * Shared, rather than listened for here.
   *
   * This screen watched the keyboard itself and only on iOS, on the assumption
   * Android resized its own window. Under edge-to-edge - the default since SDK
   * 54 - it does not, so nothing lifted and the Continue button sat behind the
   * keyboard on Android while the same screen worked on iPhone. The hook
   * measures instead of assuming, and every screen that lifts gets the fix.
   */
  const kbHeight = useKeyboardHeight();

  // Focus once the screen has painted — see note on autoFocus below.
  useEffect(() => {
    if (stage !== "email") return;
    const t = setTimeout(() => emailRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [stage]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await dynamicClient.sdk.waitForReady();
        if (active) setReady(true);
      } catch {
        if (active) setErr("Couldn't start secure sign-in. Check your connection and try again.");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Dynamic surfaces raw JSON blobs (code + stack). Translate the ones a user
  // can actually act on; fall back to the message for anything else.
  const humanError = (ex: any, fallback: string): string => {
    // Our own server says why in plain words (a temporary inbox, a phone at its
    // account limit) - better than "Request failed with status code 400".
    const said = ex?.response?.data?.error;
    if (typeof said === "string" && said.trim()) return said;
    const raw = String(ex?.message || "");
    const code = String(ex?.code || ex?.rejectionReason?.code || "");
    const blob = raw + " " + code;
    if (/too_many_email_verification_attempts|too many/i.test(blob)) {
      return "Too many attempts on this email. Wait a little while, or use a different email address.";
    }
    // Dynamic phrases a wrong or spent code several ways; they all mean the
    // same thing to the person holding it.
    if (/provided token|invalid_token|token.*invalid/i.test(blob)) {
      return "That code is wrong or has expired. Tap Resend code for a new one.";
    }
    if (/invalid_email_verification|Invalid Email Verification/i.test(blob)) {
      return "That code expired or was already used. Tap Resend code for a new one.";
    }
    if (/invalid_email_address|Invalid Email Address/i.test(blob)) {
      return "That email address was not accepted. Check it for typos and try again.";
    }
    // Dynamic refuses disposable and temporary inboxes outright. Without this
    // the user got "Couldn't send the code. Please try again." and retried the
    // same address forever.
    if (/invalid_email_address|Invalid Email Address/i.test(blob)) {
      return "That email address was not accepted. Temporary or disposable inboxes will not work - use an address you can sign in to.";
    }
    if (/rate.?limit/i.test(blob)) {
      return "Too many requests just now. Give it a minute and try again.";
    }
    if (/network|timeout|Failed to fetch/i.test(blob)) {
      return "Network problem. Check your connection and try again.";
    }
    // Never show a raw JSON payload to the user.
    if (raw.trim().startsWith("{")) return fallback;
    return raw || fallback;
  };

  /**
   * Cleaned the way Dynamic will receive it.
   *
   * Keyboards and password managers paste zero-width characters and
   * non-breaking spaces that survive a trim and are invisible in the field,
   * so the address looks right, passes a loose check, and is then rejected by
   * the provider as invalid - with nothing on screen explaining why.
   */
  const cleanEmail = email
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "")
    .trim()
    .toLowerCase();

  // Stricter than "something@something.something": a real TLD of two or more
  // letters, no double dots, and no dot against the @ on either side. Anything
  // looser just moves the rejection to the provider.
  const emailValid =
    /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(cleanEmail) &&
    !cleanEmail.includes("..") &&
    !cleanEmail.startsWith(".") &&
    !/\.@|@\./.test(cleanEmail);
  // Not gated on SDK readiness — waiting on the Dynamic WebView to boot made the
  // screen feel dead. Let the user act immediately; sendCode absorbs any
  // remaining init (waitForReady resolves instantly once ready).
  const canContinue =
    stage === "email" ? emailValid && !busy : code.length === 6 && !busy;
  // `canContinue` goes false the moment the request starts, so that a second
  // tap cannot send a second code. Appearance follows a different question:
  // a button mid-request is working, not unavailable, so it stays lit.
  const lit = canContinue || busy;

  const sendCode = async () => {
    const e = cleanEmail;
    if (!emailValid) {
      setErr("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await dynamicClient.sdk.waitForReady();
      await dynamicClient.auth.email.sendOTP(e);
      setStage("code");
      setTimeout(() => codeRef.current?.focus(), 300);
    } catch (ex: any) {
      setErr(humanError(ex, "Couldn't send the code. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (code.length !== 6) {
      setErr("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await dynamicClient.auth.email.verifyOTP(code);
      // Don't read the token straight away — Dynamic settles auth state async.
      const token = await waitForDynamicToken();
      if (!token) throw new Error("Sign-in didn't complete. Please try again.");
      const { pinSet } = await authenticateDynamic(token, referralToSend);
      /**
       * Routed by name, not through "/".
       *
       * app/index.tsx is the gate that sends a new account to set-pin, but
       * app/(tabs)/index.tsx claims "/" as well - a route group is invisible in
       * the path - and a replace("/") from here landed on the tabs home
       * instead. A brand-new account went straight to the home screen with no
       * PIN set: the username sheet appeared, because it lives there, while the
       * PIN gate never ran at all.
       *
       * Naming the destination cannot be resolved to the wrong screen.
       */
      router.replace(pinSet ? "/auth/pin" : "/auth/set-pin");
    } catch (ex: any) {
      // A paused service - new sign-ups switched off in the console - has
      // already been explained by the sheet the API layer raised. Printing
      // "Request failed with status code 503" under the code as well would
      // contradict it with nonsense.
      if (ex?.maintenanceHandled) return;
      const blob = String(ex?.message || "");
      // Expired / already-used codes should clear the field so a fresh one can
      // be typed straight in.
      if (/invalid_email_verification|Invalid Email Verification/i.test(blob)) {
        setCode("");
      }
      setErr(humanError(ex, "That code didn't work. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setErr(null);
    setBusy(true);
    try {
      // Use sendOTP, NOT resendOTP: resendOTP needs a live verification session
      // and throws invalid_email_verification once it lapses — which also burns
      // the code the user is holding. sendOTP always starts a fresh session.
      await dynamicClient.auth.email.sendOTP(cleanEmail);
      setCode("");
    } catch (ex: any) {
      setErr(humanError(ex, "Couldn't resend the code. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const goBack = () => {
    if (stage === "code") {
      setStage("email");
      setCode("");
      setErr(null);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/auth/onboarding" as any);
  };

  // Display the code as "123 - 456" while keeping raw digits in state.
  const displayCode = code.length > 3 ? `${code.slice(0, 3)} - ${code.slice(3)}` : code;

  return (
    /*
     * ONE keyboard mechanism, not two.
     *
     * This was a KeyboardAvoidingView wrapping a fixed column: with the keyboard
     * up the screen has about half its height left, less than the content needs,
     * and a fixed column has nowhere to put the overflow - so the heading and
     * legal line lost their boxes and vanished. Adding a ScrollView inside the
     * KeyboardAvoidingView made it worse, because both were then resizing the
     * same content and the whole screen went blank.
     *
     * So the KeyboardAvoidingView is gone. The layout is now a scrollable body
     * plus a footer that pads itself by the measured keyboard height, which
     * lifts the only action on the screen clear of the keys. One component
     * reacts to the keyboard, and it is the one that owns the button.
     */
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 12 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Circular back / close */}
        <TouchableOpacity
          style={[styles.circleBtn, { backgroundColor: colors.muted }]}
          onPress={goBack}
          activeOpacity={0.7}
        >
          <Feather
            name={stage === "code" ? "chevron-left" : "x"}
            size={20}
            color={colors.foreground}
          />
        </TouchableOpacity>

        <Text style={[styles.title, { color: colors.foreground }]}>
          {stage === "email" ? "Enter your email" : "Enter verification code"}
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {stage === "email"
            ? "A One Time Password (OTP) will be sent to your email address."
            : `Please enter the 6-digit OTP sent to ${email.trim().toLowerCase()}.`}
        </Text>

        {stage === "email" && !!ended && (
          <View style={[styles.endedNote, { backgroundColor: colors.muted }]}>
            <Feather name={ended === "wallet" ? "lock" : "log-in"} size={16} color={colors.foreground} style={{ marginTop: 2 }} />
            <Text style={[styles.endedText, { color: colors.foreground }]}>
              {ended === "wallet"
                ? "Your secure session ended, so nothing was sent. Sign in again to keep sending."
                : "You were signed out on this phone. Sign in again to carry on."}
            </Text>
          </View>
        )}

        {stage === "email" ? (
          <TextInput
            ref={emailRef}
            style={[styles.bigInput, { color: colors.foreground }]}
            value={email}
            onChangeText={(t) => { setEmail(t); setErr(null); }}
            placeholder="you@example.com"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            editable={!busy}
            onSubmitEditing={sendCode}
            returnKeyType="send"
          />
        ) : null}

        {stage === "email" && !showRef && (
          <TouchableOpacity onPress={openRef} style={styles.refToggle} activeOpacity={0.7}>
            <Feather name="plus" size={16} color={colors.primary} />
            <Text style={[styles.refToggleText, { color: colors.primary }]}>Have a referral code?</Text>
          </TouchableOpacity>
        )}

        {stage === "email" && showRef && (
          <View style={[styles.refBlock, { borderTopColor: colors.border }]}>
            <View style={styles.refHead}>
              <Text style={[styles.refLabel, { color: colors.mutedForeground }]}>Referral code</Text>
              <TouchableOpacity onPress={removeRef} hitSlop={12} disabled={busy}>
                <Text style={[styles.refRemove, { color: colors.mutedForeground }]}>Remove</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              ref={refInputRef}
              style={[styles.refInput, { color: colors.foreground }]}
              value={refCode}
              onChangeText={(t) => setRefCode(t.replace(/[^A-Za-z0-9]/g, "").slice(0, 16))}
              placeholder="MM000000"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!busy}
              returnKeyType="done"
            />

            {refState === "checking" && (
              <Text style={[styles.refNote, { color: colors.mutedForeground }]}>Checking the code…</Text>
            )}
            {refState === "valid" && (
              <View style={styles.refStatus}>
                <View style={[styles.refTick, { backgroundColor: colors.primary }]}>
                  <Feather name="check" size={12} color={colors.primaryForeground} />
                </View>
                <Text style={[styles.refStatusText, { color: colors.primary }]}>
                  {inviter ? `Invited by @${inviter}` : "Code applied"}
                </Text>
              </View>
            )}
            {refState === "invalid" && (
              <Text style={[styles.refStatusText, styles.refStatusGap, { color: colors.destructive }]}>
                We don't recognise that code.
              </Text>
            )}
            {refState === "blocked" && (
              <Text style={[styles.refStatusText, styles.refStatusGap, { color: colors.destructive }]}>
                That code can't be used on this phone.
              </Text>
            )}
            {refState === "unknown" && (
              <Text style={[styles.refNote, { color: colors.mutedForeground }]}>
                We'll check it when you sign in.
              </Text>
            )}
          </View>
        )}

        {stage === "code" ? (
          <>
            <TextInput
              ref={codeRef}
              style={[styles.bigInput, styles.codeInput, { color: colors.foreground }]}
              value={displayCode}
              onChangeText={(t) => { setCode(t.replace(/[^0-9]/g, "").slice(0, 6)); setErr(null); }}
              placeholder="000 - 000"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
              editable={!busy}
            />
            <TouchableOpacity onPress={resend} disabled={busy} style={{ marginTop: 18 }}>
              <Text style={[styles.resendText, { color: colors.primary }]}>Resend code</Text>
            </TouchableOpacity>
          </>
        ) : null}

        {!!err && (
          <Text style={[styles.errText, { color: colors.destructive }]}>{err}</Text>
        )}
      </ScrollView>

      {/* Footer, outside the scroll area, padded by the keyboard's height so
          the button sits just above the keys. The button carries its own
          bottom margin, which is the gap you see above the keyboard. */}
      <View
        style={[
          styles.footer,
          { paddingBottom: kbHeight > 0 ? kbHeight : insets.bottom + 16 },
        ]}
      >
        {stage === "email" && (
          <Text style={[styles.legal, { color: colors.mutedForeground }]}>
            By continuing, you agree to our{" "}
            <Text style={styles.legalLink} onPress={() => Linking.openURL(TERMS_URL)}>
              Terms of Service.
            </Text>{" "}
            You can read our Privacy Policy{" "}
            <Text style={styles.legalLink} onPress={() => Linking.openURL(PRIVACY_URL)}>
              here
            </Text>
            .
          </Text>
        )}

        <TouchableOpacity
          style={[
            styles.continueBtn,
            {
              // Dimmed brand colour while the user is still typing — reads as
              // "not yet" rather than a dead grey button.
              backgroundColor: lit ? colors.primary : colors.primary + "29",
            },
          ]}
          onPress={stage === "email" ? sendCode : verify}
          disabled={!canContinue}
          activeOpacity={0.85}
        >
          <View style={styles.continueInner}>
            <Text
              style={[
                styles.continueText,
                { color: lit ? colors.primaryForeground : colors.primary + "8A" },
              ]}
            >
              {busy ? (stage === "email" ? "Sending your code" : "Signing you in") : "Continue"}
            </Text>
            {busy && <WorkingDots color={colors.primaryForeground} />}
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 16 },
  footer: { paddingHorizontal: 24 },
  circleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  // NOTE: every text style below sets an explicit lineHeight. With a custom font
  // (Inter) iOS computes too small a line box at larger sizes and clips the
  // glyphs — which made the title render as nothing and clipped the input text.
  // flexShrink: 0 throughout. A compressed Text keeps its box but clips its
  // glyphs, so the failure mode is an invisible heading rather than an obviously
  // squashed one - which is exactly what made this hard to spot.
  title: {
    fontSize: 27,
    lineHeight: 36,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
    marginBottom: 8,
    flexShrink: 0,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: "Inter_400Regular",
    marginBottom: 28,
    flexShrink: 0,
  },
  endedNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: -12,
    marginBottom: 24,
  },
  endedText: { flex: 1, fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_500Medium" },
  // NOTE: never set lineHeight on a TextInput — on iOS it vertically clips /
  // offsets the text (the glyphs look cut off from below). Use an explicit
  // height + zero vertical padding instead. lineHeight is only for <Text>.
  bigInput: {
    fontSize: 19,
    fontFamily: "Inter_500Medium",
    height: 52,
    paddingVertical: 0,
    textAlignVertical: "center",
    flexShrink: 0,
  },
  codeInput: { fontSize: 22, fontFamily: "Inter_600SemiBold", letterSpacing: 1, height: 56 },
  resendText: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold" },

  // ── referral code ──
  // 44pt tall so the tap target meets the guideline even though the text is
  // one line of fifteen.
  refToggle: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", minHeight: 44, marginTop: 10, flexShrink: 0 },
  refToggleText: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold", flexShrink: 0 },
  refBlock: { marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, flexShrink: 0 },
  refHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 24 },
  refLabel: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium", flexShrink: 0 },
  refRemove: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_600SemiBold", flexShrink: 0 },
  // No lineHeight, per the note on bigInput: it clips a TextInput on iOS.
  refInput: { fontSize: 19, fontFamily: "Inter_600SemiBold", letterSpacing: 1.5, height: 48, paddingVertical: 0, flexShrink: 0 },
  refStatus: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  refTick: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  refStatusText: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_600SemiBold", flexShrink: 0 },
  refStatusGap: { marginTop: 4 },
  refNote: { fontSize: 12.5, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 8, flexShrink: 0 },
  errText: { fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_500Medium", marginTop: 14 },
  legal: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular", marginBottom: 16, flexShrink: 0 },
  legalLink: { textDecorationLine: "underline" },
  continueBtn: {
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    // Clear of the keys. KeyboardAvoidingView pads to exactly the keyboard
    // height, which left the button resting on top of it.
    marginBottom: 14,
  },
  continueInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  continueText: { fontSize: 16, lineHeight: 22, fontFamily: "Inter_600SemiBold" },
});
