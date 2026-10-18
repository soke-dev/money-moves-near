import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Pressable,
  Image,
  AppState,
  Alert,
  Animated,
  Easing,
  InteractionManager,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { LinearGradient } from "expo-linear-gradient";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { startDiditVerification, getDiditStatus } from "@/services/kyc";

/**
 * What the server allows in a day, said here so nobody meets it by surprise.
 *
 * Kept in step with KYC_MAX_ATTEMPTS_PER_DAY by hand - two numbers, one rule,
 * and the server is the one that enforces it. If they ever disagree this
 * screen is the one that is wrong, and the refusal from the server names the
 * real figure anyway.
 */
const ATTEMPTS_PER_DAY = 3;

// Must match DIDIT_CALLBACK_URL on the backend AND a real route in this app.
const RETURN_URL = "money-moves://account/kyc";

/**
 * The sheet's primary action.
 *
 * A top-down white wash lifts it off a flat pill, derived from colors.primary
 * so it follows the theme rather than hardcoding lime, and reads as light
 * falling across a raised surface.
 *
 * What it does not have is a chevron in a chip pinned to the right edge. That
 * arrangement is on every template there is, and it tells you a button is a
 * button. The ID card leads the label instead, in the same recessed square the
 * numbered steps above it use, so the button reads as the next one in that
 * list.
 *
 * Deliberately no drop shadow - a glow around the pill was tried and read as
 * heavier, not richer.
 */
function CTAButton({
  colors,
  label,
  onPress,
  busy = false,
  mark = false,
}: {
  colors: ReturnType<typeof useColors>;
  label: string;
  onPress: () => void;
  busy?: boolean;
  /** Lead with the ID card, for the button that starts the check. */
  mark?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: busy ? 0.75 : 1 }]}
      onPress={onPress}
      disabled={busy}
      activeOpacity={0.9}
    >
      <LinearGradient
        colors={["rgba(255,255,255,0.30)", "rgba(255,255,255,0.05)", "rgba(0,0,0,0.06)"]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {busy ? (
        <ActivityIndicator size="small" color={colors.primaryForeground} />
      ) : (
        <>
          {/* The mark sits in the same rounded square the steps above use for
              their numbers, so the button reads as the next one in that list
              rather than as a separate thing with an ornament on it.

              It leads the label instead of trailing it, and the pair is
              centred as one object - a chevron pinned to the right edge is the
              arrangement every template ships with, and it says nothing a
              button does not already say by being a button. */}
          {mark && (
            <View style={styles.btnMark}>
              <Image
                source={require("@/assets/images/id-card.png")}
                style={[styles.btnMarkImg, { tintColor: colors.primaryForeground }]}
                resizeMode="contain"
              />
            </View>
          )}
          <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

/**
 * Identity verification via Didit's hosted flow.
 *
 * We no longer collect NIN / name / document photos ourselves — the user is sent
 * to Didit's hosted page to do ID + selfie, and we mirror the resulting status
 * onto their account. Presented as a bottom sheet over the previous screen.
 */
export default function KYCScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { refreshUser, user } = useApp();

  /**
   * Open with the status we already hold.
   *
   * The account object carries kycStatus, so asking Didit before drawing
   * anything meant the sheet slid up as a spinner and swapped to its real
   * content a moment later - the lag you see on open. The fetch still runs,
   * quietly, and corrects this if Didit disagrees.
   */
  const seeded = (user?.kycStatus as "NONE" | "PENDING" | "VERIFIED" | "REJECTED") || null;
  const seededRef = useRef(!!seeded);

  const [loading, setLoading] = useState(!seeded);
  const [busy, setBusy] = useState(false);
  const [kycStatus, setKycStatus] = useState<"NONE" | "PENDING" | "VERIFIED" | "REJECTED">(
    seeded ?? "NONE"
  );
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  /**
   * The slide, done here rather than by the navigator.
   *
   * This route is a transparentModal, so a navigator animation moves the
   * backdrop with the sheet - a dark curtain sliding up rather than a sheet
   * rising over a screen that stays put. Splitting them is the whole trick:
   * the backdrop fades, the sheet travels its own height, both on the native
   * driver so a slow status check cannot stutter them.
   */
  const anim = useRef(new Animated.Value(0)).current;
  const [sheetH, setSheetH] = useState(0);
  const closing = useRef(false);

  useEffect(() => {
    if (!sheetH) return;
    Animated.timing(anim, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [sheetH, anim]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(anim, {
      toValue: 0,
      duration: 190,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)" as any);
    });
  }, [anim]);

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [sheetH || 600, 0],
  });

  const refresh = useCallback(
    async (showSpinner = true) => {
      if (showSpinner) setLoading(true);
      try {
        const s = await getDiditStatus();
        setKycStatus(s.kycStatus);
        setFailureReason(s.failureReason ?? null);
        refreshUser().catch(() => {});
      } catch (e: any) {
        const msg = String(e?.response?.data?.error || e?.message || "");
        const code = String(e?.response?.data?.code || "");
        // Token plumbing (rotation races, expiry) is internal noise the user
        // can do nothing about — never surface it. Retry once, then stay quiet.
        const isAuthNoise =
          /refresh token|token/i.test(msg) ||
          /TOKEN_|SESSION_/.test(code) ||
          e?.response?.status === 401;
        if (isAuthNoise) {
          try {
            const retry = await getDiditStatus();
            setKycStatus(retry.kycStatus);
            setFailureReason(retry.failureReason ?? null);
            setErr(null);
          } catch {
            // Leave the sheet usable — Begin verification still works.
          }
        } else {
          setErr(msg || "Couldn't load your verification status.");
        }
      } finally {
        setLoading(false);
      }
    },
    [refreshUser]
  );

  useEffect(() => {
    // Held until the sheet has landed: the request itself is cheap, but parsing
    // it and re-rendering on arrival is exactly the work that shows up as a
    // stutter mid-animation.
    const task = InteractionManager.runAfterInteractions(() => refresh(!seededRef.current));
    return () => task.cancel();
  }, [refresh]);

  // openBrowserAsync does not resolve on a deep-link redirect the way
  // openAuthSessionAsync did, so closing the browser is now our job: when Didit
  // sends the user back to RETURN_URL, dismiss it and re-check the status.
  useEffect(() => {
    const sub = Linking.addEventListener("url", ({ url }) => {
      if (!url?.startsWith(RETURN_URL)) return;
      WebBrowser.dismissBrowser().catch(() => {});
      setBusy(false);
      refresh(false);
    });
    return () => sub.remove();
  }, [refresh]);

  // Safety net for every other way the browser can close - swipe-dismiss, the
  // Done button, the OS resuming the app without settling anything. Whenever we
  // come back to the foreground, drop the busy state and re-check.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        setBusy(false);
        refresh(false);
      }
    });
    return () => sub.remove();
  }, [refresh]);

  const begin = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const session = await startDiditVerification();
      // openBrowserAsync, NOT openAuthSessionAsync. The latter is built on
      // ASWebAuthenticationSession, which iOS guards with a system consent alert
      // ("MoneyMoves wants to use verify.didit.me to Sign In") that cannot be
      // restyled or suppressed. That alert exists because that API shares
      // cookies with Safari for SSO - something a hosted KYC page has no use
      // for. Dropping to a plain in-app browser loses nothing and removes the
      // interruption.
      await WebBrowser.openBrowserAsync(session.url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
        controlsColor: colors.primary,
        toolbarColor: colors.card,
        dismissButtonStyle: "close",
        showTitle: false,
      });
      // Re-check with Didit rather than trusting the redirect.
      await refresh(false);
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || "Couldn't start verification.";
      if (e?.response?.status === 409) {
        setKycStatus("VERIFIED");
      } else {
        setErr(msg);
        Alert.alert("Verification unavailable", msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const inProgress = kycStatus === "PENDING";
  const verified = kycStatus === "VERIFIED";

  /**
   * Cleared: this sheet has nothing left to say, so it gets out of the way.
   *
   * It used to announce the result itself - a tick, "You're all set", and a
   * line about limits being live - and then the account screen showed the sheet
   * that actually lists the new limits. Two congratulations for one event, the
   * first of which is only a worse version of the second. This one closes and
   * lets that one do it.
   */
  useEffect(() => {
    if (verified) close();
  }, [verified, close]);
  const declined = kycStatus === "REJECTED";
  // An ID already tied to another account is a dead end — retrying with the same
  // documents cannot succeed, so this state hides the steps and the Begin button.
  const duplicate = declined && failureReason === "DUPLICATE_IDENTITY";

  const title = verified
    ? "You’re all set"
    : inProgress
    ? "We’re checking your details"
    : duplicate
    ? "This ID is already in use"
    : declined
    ? "That didn’t go through"
    : "Complete KYC";

  const subtitle = verified
    ? "Your identity is confirmed and your full limits are live."
    : inProgress
    ? "Usually a few minutes. Carry on using the app and your limits lift the moment you’re cleared."
    : duplicate
    ? "This ID has already verified another Money Moves account. Each person can hold one verified account. Reach out to support if you think this is wrong."
    : declined
    ? "We couldn’t read your ID clearly. Try again in good light, with the whole document in frame."
    // Not "keeps your money safe" — the wallet is self-custodial, so implying we
    // guard the funds is both wrong and the opposite of the product's promise.
    // Verification buys exactly two things: higher limits, and the transactions
    // that stay locked until it is done.
    : "A one-time check that raises your daily limits and unlocks the transactions that need it.";

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.backdrop, { opacity: anim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>

      <Animated.View
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          // Only the first measurement matters - the content can grow once the
          // status lands, and re-basing the travel then would jump the sheet.
          setSheetH((prev) => prev || h);
        }}
        style={[
          styles.sheet,
          {
            backgroundColor: colors.card,
            paddingBottom: insets.bottom + 16,
            transform: [{ translateY }],
            // Nothing to show until we know how far it has to travel.
            opacity: sheetH ? 1 : 0,
          },
        ]}
      >
        <View style={styles.handle} />

        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          </View>
          <TouchableOpacity
            style={[styles.closeBtn, { backgroundColor: colors.muted }]}
            onPress={close}
            hitSlop={8}
          >
            <Feather name="x" size={17} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>

        {/* Verified is a state this sheet passes through on its way out, never
            one it sits in, so it shows nothing rather than a result. */}
        {verified ? null : loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            {!verified && !inProgress && !duplicate && (
              <>
                <View
                  style={[
                    styles.stepsCard,
                    { backgroundColor: colors.background, borderColor: colors.border },
                  ]}
                >
                  <Step
                    colors={colors}
                    source={require("@/assets/images/id-card.png")}
                    index="1"
                    title="Your ID"
                    body={
                      // NIN slip or Nigerian passport only. Both carry the
                      // National Identity Number, which the bank requires to open
                      // a payment account - a driver's licence may not, and
                      // accepting one lets a user pass KYC and then be blocked
                      // from funding, which is the worst moment to find out.
                      "NIN slip or Nigerian passport. All four corners in frame."
                    }
                  />
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <Step
                    colors={colors}
                    source={require("@/assets/images/photo-camera-interface-symbol-for-button.png")}
                    index="2"
                    title="Face scan and liveness check"
                    body={"Look straight at the camera. It matches your face to the ID and checks a real person is holding it."}
                  />
                </View>
              </>
            )}

            {inProgress && (
              <>
                <View
                  style={[
                    styles.stepsCard,
                    { backgroundColor: colors.background, borderColor: colors.border },
                  ]}
                >
                  <Stage
                    colors={colors}
                    title="Document received"
                    body="Your NIN slip or passport is in."
                  />
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <Stage
                    colors={colors}
                    title="Face matched"
                    body="A real person, holding that document."
                  />
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <Stage
                    colors={colors}
                    running
                    title="Being checked"
                    body="With the partner who verifies IDs for us."
                  />
                </View>

                {/* A line, not a panel. What it says is worth reading once and
                    does not need a box around it to be believed. */}
                <View style={styles.noteLine}>
                  <Image
                    source={require("@/assets/images/bell.png")}
                    style={[styles.noteMark, { tintColor: colors.mutedForeground }]}
                    resizeMode="contain"
                  />
                  <Text style={[styles.noteText, { color: colors.mutedForeground }]}>
                    {"You don’t have to wait here. We’ll send you a notification."}
                  </Text>
                </View>
              </>
            )}

            {/* Said before it is met, not after.
                A limit someone runs into with no warning reads as the app
                breaking; the same limit mentioned beforehand reads as a rule.
                It sits with the steps rather than under the button, because it
                is something to know before starting rather than a caveat on
                the thing you are about to tap. */}
            {!verified && !duplicate && !inProgress && (
              <View style={styles.noteLine}>
                <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginTop: 2 }} />
                <Text style={[styles.noteText, { color: colors.mutedForeground }]}>
                  {`You get ${ATTEMPTS_PER_DAY} attempts every 24 hours. Good light and the whole ID in frame is what usually makes the difference.`}
                </Text>
              </View>
            )}

            {!!err && <Text style={[styles.errText, { color: colors.destructive }]}>{err}</Text>}

            {verified || duplicate ? (
              // Both are terminal states, so there is nothing to start: one
              // succeeded, the other can never succeed from this account.
              <>
                <CTAButton
                  colors={colors}
                  label={verified ? "Done" : "Close"}
                  onPress={close}
                />

                {duplicate && (
                  <TouchableOpacity
                    onPress={() => router.push("/account/support" as any)}
                    style={styles.supportBtn}
                  >
                    <Text style={[styles.supportText, { color: colors.mutedForeground }]}>
                      Think this is a mistake?{" "}
                      <Text style={{ color: colors.primary }}>Message support</Text>
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            ) : (
              <>
                <CTAButton
                  colors={colors}
                  busy={busy}
                  mark
                  label={
                    inProgress
                      ? "Resume verification"
                      : declined
                      ? "Try again"
                      : "Start verification"
                  }
                  onPress={begin}
                />

                <TouchableOpacity style={styles.skipBtn} onPress={close} disabled={busy}>
                  <Text style={[styles.skipText, { color: colors.mutedForeground }]}>
                    {inProgress ? "Close" : "Maybe later"}
                  </Text>
                </TouchableOpacity>

                {inProgress && (
                  <TouchableOpacity
                    onPress={() => router.push("/account/support" as any)}
                    style={styles.supportBtn}
                  >
                    <Text style={[styles.supportText, { color: colors.mutedForeground }]}>
                      Taking too long? <Text style={{ color: colors.primary }}>Message support</Text>
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </>
        )}
      </Animated.View>
    </View>
  );
}

function Step({
  colors,
  source,
  index,
  title,
  body,
}: {
  colors: any;
  source: any;
  index: string;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.stepRow}>
      <View style={[styles.stepIcon, { backgroundColor: colors.primary + "1F" }]}>
        {/* Artwork is solid black, so tint it to read on the dark tile. */}
        <Image
          source={source}
          style={[styles.stepImg, { tintColor: colors.primary }]}
          resizeMode="contain"
        />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.stepTitleRow}>
          <Text style={[styles.stepIndex, { color: colors.primary }]}>{index}</Text>
          <Text style={[styles.stepTitle, { color: colors.foreground }]}>{title}</Text>
        </View>
        <Text style={[styles.stepBody, { color: colors.mutedForeground }]}>{body}</Text>
      </View>
    </View>
  );
}

/**
 * One stage of a check that is already under way.
 *
 * The waiting state used to be a tinted box with a bell in it saying we would
 * be in touch, which is reassurance and not information: it looks the same
 * whether the ID landed a second ago or has been sitting for an hour. This
 * shows what has actually happened - the document is in, the face matched -
 * and which single thing is still running, with the spinner on that row rather
 * than floating above the sheet. It reuses the card the first-run steps are
 * drawn in, so the sheet stays one object as it moves between states.
 */
function Stage({
  colors,
  running,
  title,
  body,
}: {
  colors: any;
  running?: boolean;
  title: string;
  body: string;
}) {
  const accent = running ? colors.primary : colors.mutedForeground;
  return (
    <View style={styles.stepRow}>
      <View style={[styles.stepIcon, { backgroundColor: accent + "1F" }]}>
        {running ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Image
            source={require("@/assets/images/check.png")}
            style={[styles.stageTick, { tintColor: accent }]}
            resizeMode="contain"
          />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.stageTitle,
            { color: running ? colors.foreground : colors.mutedForeground },
          ]}
        >
          {title}
        </Text>
        <Text style={[styles.stepBody, { color: colors.mutedForeground }]}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(150,150,150,0.35)",
    alignSelf: "center",
    marginBottom: 20,
  },
  headerRow: { flexDirection: "row", alignItems: "flex-start" },
  title: { fontSize: 22, lineHeight: 29, fontFamily: "Inter_700Bold", letterSpacing: -0.4 },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  subtitle: { fontSize: 14, lineHeight: 21, fontFamily: "Inter_400Regular", marginTop: 8 },
  loadingBox: { paddingVertical: 44, alignItems: "center" },

  stepsCard: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 2,
    marginTop: 20,
  },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 52 },
  stepRow: { flexDirection: "row", gap: 14, alignItems: "flex-start", paddingVertical: 16 },
  stepIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  stepImg: { width: 19, height: 19 },
  stepTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  stepIndex: { fontSize: 11, lineHeight: 15, fontFamily: "Inter_700Bold" },
  stepTitle: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  stepBody: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular", marginTop: 3 },

  stageTick: { width: 15, height: 15 },
  stageTitle: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  noteLine: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginTop: 16, paddingHorizontal: 2 },
  noteMark: { width: 14, height: 14, marginTop: 2 },
  noteText: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: "Inter_500Medium" },

  errText: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium", marginTop: 14 },

  primaryBtn: {
    height: 56,
    borderRadius: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 11,
    marginTop: 22,
    // Clips the highlight wash to the pill.
    overflow: "hidden",
  },
  // 30 and radius 10, the size and corner the step badges above it use.
  btnMark: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  btnMarkImg: { width: 16, height: 16 },
  primaryBtnText: { fontSize: 16, lineHeight: 22, fontFamily: "Inter_600SemiBold" },
  skipBtn: { alignItems: "center", paddingVertical: 15 },
  skipText: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_500Medium" },
  supportBtn: { alignItems: "center", paddingBottom: 6 },
  supportText: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
});
