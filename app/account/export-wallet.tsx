import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  Platform,
  ActivityIndicator,
  Image,
  Linking,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import * as LocalAuthentication from "expo-local-authentication";
import { Keypad } from "@/components/Keypad";
import { findLegacyWallet, type LegacyWallet } from "@/services/wallet-core";
import {
  revealDynamicKey,
  closeDynamicWebView,
  getDynamicWalletAddresses,
  type RevealTarget,
} from "@/services/dynamic-wallet";
import { toMovementKey, type MovementKey } from "@/services/movement-key";
import { toTonKey, type TonKey } from "@/services/ton-key";
import { toStellarKey, type StellarKey } from "@/services/stellar-key";
import { stellarAddressFromSolana } from "@/services/stellar-address";
import { loadTonAddress } from "@/services/wallet-core";
import { createBackup } from "@/services/wallet-backup";

/**
 * pin -> choose -> phrase.
 *
 * There are two wallets to export now: the Dynamic one this account signs
 * with, whose key Dynamic holds and reveals in its own screen, and - for
 * accounts that existed before the upgrade - a recovery phrase still sitting
 * in this device's keychain. The screen used to assume the second and told
 * everyone else there was no wallet on the device.
 */
type Step =
  | "pin" | "choose" | "phrase" | "keys"
  | "movement-intro" | "movement" | "ton-intro" | "ton" | "stellar-intro" | "stellar";

/**
 * A key, broken into blocks of eight.
 *
 * Sixty-four unbroken characters cannot be checked or read aloud, and
 * checking is the whole activity on these screens: somebody is comparing
 * what we showed against what another app shows. Blocks give the eye
 * somewhere to rest and somewhere to resume after looking away.
 *
 * A 0x prefix stays on its own, because it belongs to the format rather than
 * to the key and grouping it in would put a boundary two characters into the
 * first block.
 */
function groupKey(value: string): string {
  const has0x = value.startsWith("0x");
  const body = has0x ? value.slice(2) : value;
  const blocks = body.match(/.{1,8}/g) ?? [body];
  return (has0x ? "0x " : "") + blocks.join(" ");
}

/**
 * The chain's mark beside its name, rather than above it.
 *
 * A centred medallion over a centred title is the arrangement every screen
 * of this kind arrives with. Inline, it takes a third of the height and
 * leaves the first line of real text higher up the screen.
 */
function ChainHead({
  logo,
  title,
  tint,
  colors,
  fill = false,
}: {
  logo: any;
  title: string;
  tint: string;
  colors: any;
  /** The mark is a full square of its own colour: fill the badge with it. */
  fill?: boolean;
}) {
  return (
    <View style={styles.kHead}>
      <View style={[styles.kMark, { backgroundColor: tint }, fill && styles.kMarkClip]}>
        <Image
          source={logo}
          style={fill ? styles.kMarkFill : styles.kMarkImg}
          resizeMode={fill ? "cover" : "contain"}
        />
      </View>
      <Text style={[styles.kTitle, { color: colors.foreground }]}>{title}</Text>
    </View>
  );
}

/**
 * The three things that have to happen, on a hairline rail.
 *
 * It is a real sequence - reveal, copy, come back - so it keeps its order and
 * its progression. What it does not need is three filled circles carrying
 * numerals, which is the heaviest treatment available for three short
 * sentences and crowds out the button they lead to.
 */
function KeySteps({ steps, colors }: { steps: [string, string][]; colors: any }) {
  return (
    <View style={styles.rail}>
      <View style={[styles.railLine, { backgroundColor: colors.border }]} />
      {steps.map(([head, body], i) => (
        <View key={head} style={[styles.railItem, i === steps.length - 1 && { paddingBottom: 0 }]}>
          <View
            style={[
              styles.railDot,
              {
                backgroundColor: i === 0 ? colors.primary : colors.background,
                borderColor: i === 0 ? colors.primary : colors.border,
              },
            ]}
          />
          <View style={styles.railText}>
            <Text style={[styles.railHead, { color: colors.foreground }]}>{head}</Text>
            <Text style={[styles.railBody, { color: colors.mutedForeground }]}>{body}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Whether this key opens the wallet whose money is at stake.
 *
 * It was a twelve-pixel badge beside a label. It answers the only question
 * the screen exists to answer, and a mismatch is the difference between an
 * export and a stranger's wallet, so it gets a line of its own and carries
 * the address it matched.
 */
function KeyVerdict({
  ok,
  address,
  colors,
}: {
  ok: boolean;
  address: string | null;
  colors: any;
}) {
  const tone = ok ? colors.primary : colors.destructive;
  return (
    <View style={[styles.verify, { borderColor: tone + "47", backgroundColor: tone + "12" }]}>
      <View style={[styles.verifyDot, { backgroundColor: tone }]}>
        <Feather name={ok ? "check" : "alert-triangle"} size={10} color={colors.background} />
      </View>
      <View style={styles.verifyText}>
        <Text style={[styles.verifyHead, { color: tone }]}>
          {ok ? "This is your wallet" : "This is a different wallet"}
        </Text>
        {!!address && (
          <Text numberOfLines={1} style={[styles.verifyAddr, { color: colors.mutedForeground }]}>
            {address.slice(0, 10)}…{address.slice(-8)}
          </Text>
        )}
      </View>
    </View>
  );
}

export default function ExportWalletScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { verifyPin, user, bioTx } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [step, setStep] = useState<Step>("pin");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mnemonic, setMnemonicState] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [showBackupInput, setShowBackupInput] = useState(false);
  const [backupPassword, setBackupPassword] = useState("");
  const [backupLoading, setBackupLoading] = useState(false);
  /** Whatever an older build left on this device, if anything. */
  const [legacy, setLegacy] = useState<LegacyWallet>({ mnemonic: null, embedded: null });
  const hasLegacy = !!legacy.mnemonic || !!legacy.embedded;
  const [revealing, setRevealing] = useState(false);
  // Movement key conversion, offered right after the Solana key is revealed.
  const [convertInput, setConvertInput] = useState("");
  const [converted, setConverted] = useState<MovementKey | null>(null);
  const [convertError, setConvertError] = useState(false);
  const [movementAddress, setMovementAddress] = useState<string | null>(null);
  /** The clipboard supplied the key, so there is nothing to ask for. */
  const [autoFilled, setAutoFilled] = useState(false);
  /**
   * The TON rewrite, which shares the input box with Movement's.
   *
   * Only one of the two steps is on screen at a time, so the paste box and
   * its error can be shared - but the RESULTS cannot, because they are
   * different shapes and showing the wrong one would hand somebody a
   * Movement key labelled TON.
   */
  const [tonKey, setTonKey] = useState<TonKey | null>(null);
  const [tonSolAddress, setTonSolAddress] = useState<string | null>(null);
  const [tonAddress, setTonAddress] = useState<string | null>(null);
  /** The Stellar rewrite: its own result, for the same reason TON has one. */
  const [stellarKey, setStellarKey] = useState<StellarKey | null>(null);
  const [stellarAddress, setStellarAddress] = useState<string | null>(null);

  /**
   * Face or fingerprint, offered the same way the app unlocks.
   *
   * Typing a PIN to reach a key you are about to reveal is a step for its own
   * sake when the phone already trusts your face. The switch is the same one
   * that approves payments - someone who has turned it off is asked for the
   * PIN, as they asked to be.
   */
  const [bioLabel, setBioLabel] = useState("Face ID");

  const unlockWithBiometrics = useCallback(async () => {
    if (Platform.OS === "web") return;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock your wallet keys",
        fallbackLabel: "Use PIN",
        cancelLabel: "Cancel",
      });
      if (result.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setStep("choose");
      }
    } catch {
      // Cancelled, or the device state changed. The keypad is still there.
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;

    LocalAuthentication.supportedAuthenticationTypesAsync()
      .then((types) => {
        if (!types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
          setBioLabel("Fingerprint");
        }
      })
      .catch(() => {});

    // Offered on arrival, not forced: the PIN keypad stays live underneath so
    // dismissing the prompt costs nothing.
    if (bioTx && step === "pin") unlockWithBiometrics();
  }, []);

  /**
   * The pasted key lives no longer than the step does.
   *
   * Leaving by any route - Done, the back arrow, or landing here and changing
   * your mind - drops it, rather than leaving a private key sitting in
   * component state behind whatever screen comes next.
   */
  useEffect(() => {
    if (step === "movement") return;
    setConvertInput("");
    setConverted(null);
    setConvertError(false);
    setAutoFilled(false);
  }, [step]);

  useEffect(() => {
    if (step !== "stellar") setStellarKey(null);
  }, [step]);

  useEffect(() => {
    // Searched under every id it could be filed against, because a migrated
    // account no longer knows the one its phrase was saved with.
    findLegacyWallet(user?.id)
      .then(setLegacy)
      .catch(() => {});
  }, [user?.id]);

  /**
   * Takes the PIN as an argument.
   *
   * The keypad calls this from inside its own onKey, where `pin` state is
   * still the previous render's value - reading it from state would check a
   * three-digit PIN.
   */
  /**
   * Convert what was just copied, rather than asking for it back.
   *
   * Dynamic renders the key inside its own WebView and hands this app nothing
   * - `revealEmbeddedWalletKey` is typed to return void, the success event
   * carries a wallet handle and not a key, and no call in the SDK returns key
   * material. The clipboard is the only path the key can take to reach the
   * conversion, which is why this screen ever asked for a paste.
   *
   * So this reads what the person copied a moment ago, in Dynamic's own sheet.
   * Nothing new is exposed: the same bytes already had to travel this exact
   * path by hand, through this same component state.
   *
   * Matching the account's real Movement address is the condition, not a
   * flourish. Base58 is permissive enough that an unrelated string can decode
   * to 32 plausible bytes, so parsing proves nothing at all. Only a key that
   * derives the address we already know is accepted - anything else leaves the
   * paste box up rather than showing a confident wrong answer.
   */
  const autoFillFromClipboard = useCallback(async (expected: string | null) => {
    if (!expected) return;
    try {
      // Asking whether there is a string does not trip the "pasted from"
      // banner; reading does. So do not read unless there is something there.
      if (!(await Clipboard.hasStringAsync())) return;
      const copied = (await Clipboard.getStringAsync()).trim();
      if (!copied) return;

      const key = toMovementKey(copied);
      if (key.address !== expected) return;

      setConverted(key);
      setAutoFilled(true);
    } catch {
      // An unreadable clipboard, or something that is not a key at all. The
      // paste box is still there, so there is nothing to report.
    }
  }, []);

  /**
   * The TON rewrite, which checks itself against the SOLANA address.
   *
   * Movement's check derives the Movement address and matches it. A TON
   * address cannot be derived here - it is the hash of a wallet contract
   * holding the key, which needs the contract's code and a cell serialiser,
   * a whole TON library for one comparison. The Solana address is the same
   * key's public half and the app already knows it, so a key that derives
   * the right Solana address is the right key, and the TON wallet built on
   * it is this account's. The same proof by a shorter route.
   */
  const autoFillTonFromClipboard = useCallback(async (expectedSol: string | null) => {
    if (!expectedSol) return;
    try {
      if (!(await Clipboard.hasStringAsync())) return;
      const copied = (await Clipboard.getStringAsync()).trim();
      if (!copied) return;
      const key = toTonKey(copied);
      if (key.solanaAddress !== expectedSol) return;
      setTonKey(key);
      setAutoFilled(true);
    } catch {
      // Unreadable, or not a key. The paste box is still there.
    }
  }, []);

  /**
   * The Stellar rewrite, checked the direct way: unlike TON's, a Stellar
   * address is just the public key re-encoded, so the key has to derive this
   * account's own G address.
   */
  const autoFillStellarFromClipboard = useCallback(async (expected: string | null) => {
    if (!expected) return;
    try {
      if (!(await Clipboard.hasStringAsync())) return;
      const copied = (await Clipboard.getStringAsync()).trim();
      if (!copied) return;
      const key = toStellarKey(copied);
      if (key.address !== expected) return;
      setStellarKey(key);
      setAutoFilled(true);
    } catch {
      // Unreadable, or not a key. The paste box is still there.
    }
  }, []);

  /** Dynamic renders the phrase or key itself; nothing lands in this app. */
  const handleReveal = async (
    target: RevealTarget,
    convert: false | "movement" | "ton" | "stellar" = false,
  ) => {
    setRevealing(true);
    try {
      await revealDynamicKey("private-key", target);
      if (convert === "stellar") {
        setConvertInput("");
        setStellarKey(null);
        setConvertError(false);
        setAutoFilled(false);
        setStep("stellar");

        let sol: string | null = null;
        try {
          sol = (await getDynamicWalletAddresses()).solana ?? null;
        } catch {
          sol = null;
        }
        const expected = sol ? stellarAddressFromSolana(sol) : null;
        setStellarAddress(expected);
        await autoFillStellarFromClipboard(expected);
      } else if (convert === "ton") {
        setConvertInput("");
        setTonKey(null);
        setConvertError(false);
        setAutoFilled(false);
        setStep("ton");

        let sol: string | null = null;
        try {
          sol = (await getDynamicWalletAddresses()).solana ?? null;
        } catch {
          sol = null;
        }
        setTonSolAddress(sol);
        // Shown beside the key so somebody can see which wallet it opens.
        // Read rather than derived, for the reason given above.
        setTonAddress(await loadTonAddress().catch(() => null));
        await autoFillTonFromClipboard(sol);
      } else if (convert) {
        // The key Dynamic just showed is the Movement key too, written the
        // Solana way. Offering the rewrite here saves the user finding out
        // from a Movement wallet that it is "invalid".
        setConvertInput("");
        setConverted(null);
        setConvertError(false);
        setAutoFilled(false);
        setStep("movement");

        // The address is fetched first because it is what decides whether the
        // clipboard can be trusted - there is no point reading without it.
        let addr: string | null = null;
        try {
          addr = (await getDynamicWalletAddresses()).movement ?? null;
        } catch {
          addr = null;
        }
        setMovementAddress(addr);
        await autoFillFromClipboard(addr);
      }
    } catch (e: any) {
      closeDynamicWebView();
      // Backing out of the verification is a decision, not an error.
      if (e?.message === "STEP_UP_CANCELLED") return;
      if (e?.message === "NO_SOL_WALLET" || e?.message === "NO_EVM_WALLET") {
        Alert.alert("Not ready yet", "That wallet has not finished setting up. Try again shortly.");
        return;
      }
      if (e?.message === "EXPORT_FORBIDDEN") {
        // Dynamic refuses the call when key export is disabled for the
        // project, so there is nothing for the user to retry.
        Alert.alert(
          "Export not available yet",
          "Key export is switched off for this app. Contact support and we will sort it out.",
        );
      } else {
        Alert.alert("Could not open", "Try again in a moment.");
      }
    } finally {
      setRevealing(false);
    }
  };

  const handleLegacyExport = () => {
    // Already in hand from the lookup - no second read that could miss.
    if (legacy.mnemonic) {
      setMnemonicState(legacy.mnemonic);
      setStep("phrase");
      return;
    }
    if (legacy.embedded) setStep("keys");
  };

  const handlePinSubmit = async (value?: string) => {
    const entered = value ?? pin;
    if (entered.length !== 4) {
      setError("Enter your 4-digit PIN");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const valid = await verifyPin(entered);
      if (!valid) {
        setError("Incorrect PIN");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setLoading(false);
        return;
      }
      setStep("choose");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      // Nothing here reads a wallet any more - this step only checks the PIN,
      // so the old NO_WALLET message belonged to a call that has moved.
      setError("Could not verify your PIN");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    Clipboard.setStringAsync(mnemonic);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert("Copied", "Recovery phrase copied to clipboard. Clear your clipboard after pasting.");
  };

  const handleCloudBackup = async () => {
    if (Platform.OS === "ios" && Alert.prompt) {
      Alert.prompt(
        "Cloud Backup",
        "Enter a password to encrypt your backup.",
        async (password: string) => {
          if (!password || password.length < 8) {
            Alert.alert("Error", "Password must be at least 8 characters.");
            return;
          }
          try {
            await createBackup(mnemonic, password);
          } catch {
            Alert.alert("Error", "Backup failed.");
          }
        }
      );
    } else {
      setShowBackupInput(true);
      setBackupPassword("");
    }
  };

  const handleBackupSubmit = async () => {
    if (!backupPassword || backupPassword.length < 8) {
      Alert.alert("Error", "Password must be at least 8 characters.");
      return;
    }
    setBackupLoading(true);
    try {
      await createBackup(mnemonic, backupPassword);
      setShowBackupInput(false);
      setBackupPassword("");
    } catch {
      Alert.alert("Error", "Backup failed.");
    } finally {
      setBackupLoading(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────
  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: topPad,
          paddingBottom: bottomPad,
        },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Export Wallet
        </Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ─── Step 1: PIN ─────────────────────────────── */}
        {step === "pin" && (
          <>
            <View style={styles.iconWrap}>
              {/* The same padlock the Security row carries, so the two read
                  as one flow. */}
              <Image
                source={require("@/assets/images/lock (1).png")}
                style={[styles.lockMark, { tintColor: colors.primary }]}
                resizeMode="contain"
              />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Enter Your PIN
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Enter your 4-digit PIN to export your private keys.
            </Text>

            {/* Dots and the app's own pad. A number-pad TextInput raised the
                system keyboard over the screen, and a PIN typed into a text
                field is one the keyboard can offer to remember. */}
            <View style={styles.pinRow}>
              {[0, 1, 2, 3].map((i) => {
                const filled = pin.length > i;
                return (
                  <View
                    key={i}
                    style={[
                      styles.pinDot,
                      filled
                        ? { backgroundColor: error ? colors.destructive : colors.primary }
                        : { borderWidth: 2, borderColor: error ? colors.destructive + "66" : colors.border },
                    ]}
                  />
                );
              })}
            </View>

            {/* Fixed slot, so the pad does not jump when this appears. */}
            <Text
              style={[styles.errorText, { color: error ? colors.destructive : "transparent" }]}
              numberOfLines={1}
            >
              {error || " "}
            </Text>

            {bioTx && !loading && (
              <TouchableOpacity
                style={[styles.bioBtn, { backgroundColor: colors.card }]}
                onPress={unlockWithBiometrics}
                activeOpacity={0.75}
              >
                <Feather name="smile" size={15} color={colors.primary} />
                <Text style={[styles.bioBtnText, { color: colors.primary }]}>
                  Use {bioLabel}
                </Text>
              </TouchableOpacity>
            )}

            {loading ? (
              <ActivityIndicator color={colors.primary} style={styles.pinLoading} />
            ) : (
              <Keypad
                style={styles.pad}
                disabled={loading}
                onKey={(d) => {
                  if (error) setError("");
                  const next = (pin + d).slice(0, 4);
                  setPin(next);
                  // The fourth digit is the submit. A Continue button under a
                  // full PIN is a tap that decides nothing.
                  if (next.length === 4) handlePinSubmit(next);
                }}
                onBackspace={() => {
                  if (error) setError("");
                  setPin((prev) => prev.slice(0, -1));
                }}
              />
            )}
          </>
        )}

        {/* ─── Step 2: which wallet ───────────────────── */}
        {step === "choose" && (
          <>
            <View style={styles.iconWrap}>
              <Image
                source={require("@/assets/images/wallet-filled-money-tool.png")}
                style={[styles.lockMark, { tintColor: colors.primary }]}
                resizeMode="contain"
              />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>Export wallet</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {hasLegacy
                ? "Your current wallet, or the one you had before the upgrade."
                : "Back this up somewhere only you can reach."}
            </Text>

            <Text style={[styles.chooseLabel, { color: colors.mutedForeground }]}>THIS WALLET</Text>
            <View style={[styles.chooseCard, { backgroundColor: colors.card }]}>
              {/* The account has two keys: a secp256k1 key for the EVM chains,
                  and one Ed25519 key that Movement and Solana share. The
                  shared one gets a row each, because sharing a key is our
                  problem and not the user's - somebody moving to Phantom
                  should not have to read about Movement to get there, and the
                  two rows want different things anyway. Dynamic's reveal
                  screen takes no wallet argument, so each row points it at the
                  right one. */}
              <TouchableOpacity
                style={[styles.chooseRow, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}
                onPress={() => handleReveal("evm")}
                disabled={revealing}
                activeOpacity={0.7}
              >
                <View style={[styles.chooseIcon, { backgroundColor: colors.muted }]}>
                  <Image
                    source={require("@/assets/images/hidden.png")}
                    style={[styles.chooseMark, { tintColor: colors.mutedForeground }]}
                    resizeMode="contain"
                  />
                </View>
                <Text style={[styles.chooseTitle, styles.chooseText, { color: colors.foreground }]}>
                  EVM key (Base, BNB)
                </Text>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.chooseRow, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}
                onPress={() => handleReveal("sol")}
                disabled={revealing}
                activeOpacity={0.7}
              >
                <View style={[styles.chooseIcon, { backgroundColor: colors.muted }]}>
                  <Image
                    source={require("@/assets/images/hidden.png")}
                    style={[styles.chooseMark, { tintColor: colors.mutedForeground }]}
                    resizeMode="contain"
                  />
                </View>
                <View style={styles.chooseText}>
                  <Text style={[styles.chooseTitle, { color: colors.foreground }]}>Solana key</Text>
                  <Text style={[styles.chooseSub, { color: colors.mutedForeground }]}>
                    Phantom, Solflare, any Solana wallet
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>

              {/* The same key, which is exactly why it needs its own row:
                  handed to a Movement wallet in the Solana spelling it is
                  rejected as invalid, and a person has no way to know that the
                  key they were just shown is the right one. */}
              <TouchableOpacity
                style={styles.chooseRow}
                onPress={() => setStep("movement-intro")}
                disabled={revealing}
                activeOpacity={0.7}
              >
                <View style={[styles.chooseIcon, { backgroundColor: colors.muted }]}>
                  <Image
                    source={require("@/assets/images/hidden.png")}
                    style={[styles.chooseMark, { tintColor: colors.mutedForeground }]}
                    resizeMode="contain"
                  />
                </View>
                <View style={styles.chooseText}>
                  <Text style={[styles.chooseTitle, { color: colors.foreground }]}>Movement key</Text>
                  <Text style={[styles.chooseSub, { color: colors.mutedForeground }]}>
                    For any Movement wallet
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>

              {/* The same Ed25519 key again, in a third spelling. TON writes
                  it bare where Movement wants 0x, and a key pasted with the
                  wrong one is refused as malformed - so this row exists for
                  the same reason Movement's does. */}
              <TouchableOpacity
                style={[styles.chooseRow, { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}
                onPress={() => setStep("ton-intro")}
                disabled={revealing}
                activeOpacity={0.7}
              >
                <View style={[styles.chooseIcon, { backgroundColor: colors.muted }]}>
                  <Image
                    source={require("@/assets/images/hidden.png")}
                    style={[styles.chooseMark, { tintColor: colors.mutedForeground }]}
                    resizeMode="contain"
                  />
                </View>
                <View style={styles.chooseText}>
                  <Text style={[styles.chooseTitle, { color: colors.foreground }]}>TON key</Text>
                  <Text style={[styles.chooseSub, { color: colors.mutedForeground }]}>
                    For any TON wallet
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>

              {/* And a fourth: Stellar takes the same seed as an S... secret
                  key, which no other spelling of it will pass for. */}
              <TouchableOpacity
                style={[styles.chooseRow, { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}
                onPress={() => setStep("stellar-intro")}
                disabled={revealing}
                activeOpacity={0.7}
              >
                <View style={[styles.chooseIcon, { backgroundColor: colors.muted }]}>
                  <Image
                    source={require("@/assets/images/hidden.png")}
                    style={[styles.chooseMark, { tintColor: colors.mutedForeground }]}
                    resizeMode="contain"
                  />
                </View>
                <View style={styles.chooseText}>
                  <Text style={[styles.chooseTitle, { color: colors.foreground }]}>Stellar key</Text>
                  <Text style={[styles.chooseSub, { color: colors.mutedForeground }]}>
                    LOBSTR, Freighter, any Stellar wallet
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            {/* Only for accounts that predate the upgrade. Whatever is here
                is on this device and nowhere else, so it is the only way to
                reach anything left in that wallet. */}
            {hasLegacy && (
              <>
                <Text style={[styles.chooseLabel, { color: colors.mutedForeground }]}>OLD WALLET</Text>
                <View style={[styles.chooseCard, { backgroundColor: colors.card }]}>
                  <TouchableOpacity
                    style={styles.chooseRow}
                    onPress={handleLegacyExport}
                    disabled={revealing}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.chooseIcon, { backgroundColor: colors.muted }]}>
                      <Image
                        source={require("@/assets/images/lock (1).png")}
                        style={[styles.chooseMark, { tintColor: colors.mutedForeground }]}
                        resizeMode="contain"
                      />
                    </View>
                    <View style={styles.chooseText}>
                      <Text style={[styles.chooseTitle, { color: colors.foreground }]}>
                        {legacy.mnemonic ? "Recovery phrase" : "Private keys"}
                      </Text>
                      <Text style={[styles.chooseSub, { color: colors.mutedForeground }]}>
                        From before the upgrade, stored on this device
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                  </TouchableOpacity>
                </View>
              </>
            )}

            {revealing && (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 22 }} />
            )}
          </>
        )}

        {/* ─── Old raw keys, for wallets that never had a phrase ── */}
        {step === "keys" && legacy.embedded && (
          <>
            <View style={styles.iconWrap}>
              <Image
                source={require("@/assets/images/lock (1).png")}
                style={[styles.lockMark, { tintColor: colors.destructive }]}
                resizeMode="contain"
              />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>Old wallet keys</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              This wallet was made before recovery phrases, so it has keys instead of words.
            </Text>

            <View
              style={[styles.warningBox, { backgroundColor: colors.destructive + "15" }]}
            >
              <Feather name="alert-triangle" size={16} color={colors.destructive} />
              <Text style={[styles.warningText, { color: colors.destructive }]}>
                Anyone with these keys can take everything in that wallet. Never share them.
              </Text>
            </View>

            <Text style={[styles.convertLabel, { color: colors.mutedForeground }]}>
              BASE AND BNB KEY
            </Text>
            <View style={[styles.convertOut, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text selectable style={[styles.convertKey, { color: colors.foreground }]}>
                {legacy.embedded.evmPrivateKey}
              </Text>
            </View>

            <Text style={[styles.convertLabel, { color: colors.mutedForeground }]}>
              MOVEMENT AND SOLANA KEY
            </Text>
            <View style={[styles.convertOut, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text selectable style={[styles.convertKey, { color: colors.foreground }]}>
                {legacy.embedded.ed25519Seed}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.outlineBtn, { borderColor: colors.border, marginTop: 18 }]}
              onPress={() => setStep("choose")}
            >
              <Text style={[styles.outlineBtnText, { color: colors.mutedForeground }]}>Done</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ─── What to expect, before the provider takes the screen ── */}
        {step === "movement-intro" && (
          <>
            {/* The reveal opens somebody else's screen, full bleed, with no
                warning and nothing of ours on it. Arriving there cold, the
                thing a person needs to do - copy the key before dismissing it
                - is the one thing nothing tells them, and dismissing it means
                starting the whole verification again. */}
            <ChainHead
              logo={require("@/assets/images/movementnew.jpg")}
              title="Movement key"
              tint="#13E9EA"
              fill
              colors={colors}
            />
            <Text style={[styles.kSub, { color: colors.mutedForeground }]}>
              Your key has to be written differently before a Movement wallet will accept
              it. That happens here, on this phone.
            </Text>

            <KeySteps
              colors={colors}
              steps={[
                ["Your key is shown", "On your wallet provider's screen. Money Moves never sees it."],
                ["Copy it there", "Nothing else on that screen needs doing."],
                ["Come back here", "It is rewritten for Movement on this phone and checked against your address."],
              ]}
            />

            <TouchableOpacity
              style={[styles.convertCopy, { backgroundColor: colors.primary }]}
              onPress={() => handleReveal("sol", "movement")}
              disabled={revealing}
              activeOpacity={0.85}
            >
              {revealing ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <>
                  <Feather name="eye" size={16} color={colors.primaryForeground} />
                  <Text style={[styles.convertCopyText, { color: colors.primaryForeground }]}>
                    Show my key
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.convertDone}
              onPress={() => setStep("choose")}
              activeOpacity={0.7}
            >
              <Text style={[styles.convertDoneText, { color: colors.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>
          </>
        )}

        {step === "movement" && (
          <>
            <ChainHead
              logo={require("@/assets/images/movementnew.jpg")}
              title="Movement key"
              tint="#13E9EA"
              fill
              colors={colors}
            />
            <Text style={[styles.kSub, { color: colors.mutedForeground }]}>
              {autoFilled
                ? "Converted from the key you copied. It never left this phone."
                : "Paste the key you just revealed and it is rewritten into the form Movement accepts, here on this phone. It never leaves your device."}
            </Text>

            {!autoFilled && (
              <>
                <Text style={[styles.convertLabel, { color: colors.mutedForeground, marginTop: 0 }]}>
                  PASTE KEY HERE
                </Text>
                <TextInput
                  style={[
                    styles.convertInput,
                    {
                      backgroundColor: colors.card,
                      color: colors.foreground,
                      borderColor: convertError ? colors.destructive : colors.border,
                    },
                  ]}
                  value={convertInput}
                  onChangeText={(v) => {
                    setConvertInput(v);
                    if (!v.trim()) {
                      setConverted(null);
                      setConvertError(false);
                      return;
                    }
                    try {
                      setConverted(toMovementKey(v));
                      setConvertError(false);
                    } catch {
                      setConverted(null);
                      setConvertError(true);
                    }
                  }}
                  placeholder="The key you just revealed"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline
                />
                {convertError && !!convertInput.trim() && (
                  <Text style={[styles.convertErr, { color: colors.destructive }]}>
                    That does not look like your private key.
                  </Text>
                )}
              </>
            )}

            {converted && (
              <>
                {!!movementAddress && (
                  <KeyVerdict
                    ok={converted.address === movementAddress}
                    address={movementAddress}
                    colors={colors}
                  />
                )}

                <Text style={[styles.convertLabel, { color: colors.mutedForeground, marginTop: 0 }]}>
                  MOVEMENT KEY
                </Text>
                <View style={[styles.convertOut, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text selectable style={[styles.keyMono, { color: colors.foreground }]}>
                    {groupKey(converted.privateKeyHex)}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.convertCopy, { backgroundColor: colors.primary }]}
                  onPress={() => {
                    Clipboard.setStringAsync(converted.privateKeyHex);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    Alert.alert("Copied", "Clear your clipboard once you have imported it.");
                  }}
                  activeOpacity={0.85}
                >
                  <Feather name="copy" size={16} color={colors.primaryForeground} />
                  <Text style={[styles.convertCopyText, { color: colors.primaryForeground }]}>
                    Copy key
                  </Text>
                </TouchableOpacity>

                {/* No single app to send them to, unlike TON, so this names
                    the kind of wallet rather than one download. Saying where
                    a key is meant to go is half of what makes it usable. */}
                <Text style={[styles.dlSteer, { color: colors.mutedForeground, marginTop: 16 }]}>
                  Import it as a private key in any Movement wallet.
                </Text>
              </>
            )}

            {/* A text link, not a second full-width button competing with the
                one that matters. */}
            <TouchableOpacity
              style={styles.convertDone}
              onPress={() => {
                setConvertInput("");
                setConverted(null);
                setConvertError(false);
                setStep("choose");
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.convertDoneText, { color: colors.mutedForeground }]}>Done</Text>
            </TouchableOpacity>
          </>
        )}

        {step === "ton-intro" && (
          <>
            <ChainHead
              logo={require("@/assets/images/toncoin.png")}
              title="TON key"
              tint="#1E7FC2"
              colors={colors}
            />
            {/* Two short facts and nothing else.
                An earlier version explained that a key cannot be turned back
                into words and that it opens in one app - both true, both
                answering questions nobody has yet, and between them enough
                to make a simple screen read as a warning. Which app it goes
                into is on the next screen, where it can be acted on. */}
            <Text style={[styles.kSub, { color: colors.mutedForeground }]}>
              This wallet is saved with a{" "}
              <Text style={[styles.kSubStrong, { color: colors.foreground }]}>key</Text>, not the
              usual recovery words. Copy it and keep it somewhere safe.
            </Text>

            <KeySteps
              colors={colors}
              steps={[
                ["Your key is shown", "On your wallet provider's screen. Money Moves never sees it."],
                ["Copy it there", "Nothing else on that screen needs doing."],
                ["Come back here", "It is rewritten for TON on this phone and checked against your wallet."],
              ]}
            />

            <TouchableOpacity
              style={[styles.convertCopy, { backgroundColor: colors.primary }]}
              onPress={() => handleReveal("sol", "ton")}
              disabled={revealing}
              activeOpacity={0.85}
            >
              {revealing ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <>
                  <Feather name="eye" size={16} color={colors.primaryForeground} />
                  <Text style={[styles.convertCopyText, { color: colors.primaryForeground }]}>
                    Show my key
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.convertDone}
              onPress={() => setStep("choose")}
              activeOpacity={0.7}
            >
              <Text style={[styles.convertDoneText, { color: colors.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>
          </>
        )}

        {step === "ton" && (
          <>
            <ChainHead
              logo={require("@/assets/images/toncoin.png")}
              title="TON key"
              tint="#1E7FC2"
              colors={colors}
            />
            <Text style={[styles.kSub, { color: colors.mutedForeground }]}>
              {autoFilled
                ? "Converted from the key you copied. It never left this phone."
                : "Paste the key you just revealed and it is rewritten into the form TON accepts, here on this phone. It never leaves your device."}
            </Text>

            {!autoFilled && (
              <>
                <Text style={[styles.convertLabel, { color: colors.mutedForeground, marginTop: 0 }]}>
                  PASTE KEY HERE
                </Text>
                <TextInput
                  style={[
                    styles.convertInput,
                    {
                      backgroundColor: colors.card,
                      color: colors.foreground,
                      borderColor: convertError ? colors.destructive : colors.border,
                    },
                  ]}
                  value={convertInput}
                  onChangeText={(v) => {
                    setConvertInput(v);
                    if (!v.trim()) {
                      setTonKey(null);
                      setConvertError(false);
                      return;
                    }
                    try {
                      setTonKey(toTonKey(v));
                      setConvertError(false);
                    } catch {
                      setTonKey(null);
                      setConvertError(true);
                    }
                  }}
                  placeholder="The key you just revealed"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline
                />
                {convertError && !!convertInput.trim() && (
                  <Text style={[styles.convertErr, { color: colors.destructive }]}>
                    That does not look like your private key.
                  </Text>
                )}
              </>
            )}

            {tonKey && (
              <>
                {!!tonSolAddress && (
                  <KeyVerdict
                    ok={tonKey.solanaAddress === tonSolAddress}
                    address={tonAddress}
                    colors={colors}
                  />
                )}

                <Text style={[styles.convertLabel, { color: colors.mutedForeground, marginTop: 0 }]}>
                  PRIVATE KEY
                </Text>
                <View style={[styles.convertOut, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text selectable style={[styles.keyMono, { color: colors.foreground }]}>
                    {groupKey(tonKey.privateKeyHex)}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.convertCopy, { backgroundColor: colors.primary }]}
                  onPress={() => {
                    Clipboard.setStringAsync(tonKey.privateKeyHex);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    Alert.alert("Copied", "Clear your clipboard once you have imported it.");
                  }}
                  activeOpacity={0.85}
                >
                  <Feather name="copy" size={16} color={colors.primaryForeground} />
                  <Text style={[styles.convertCopyText, { color: colors.primaryForeground }]}>
                    Copy key
                  </Text>
                </TouchableOpacity>

                {/* Where it goes, as a step rather than a caveat.
                    One app opens this key, and saying so as an instruction
                    beats burying it in a paragraph of what not to do. */}
                <Text style={[styles.convertLabel, { color: colors.mutedForeground }]}>DOWNLOAD</Text>
                <TouchableOpacity
                  style={[styles.dlRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => Linking.openURL("https://mywallet.io/").catch(() => {})}
                  activeOpacity={0.75}
                >
                  <View style={[styles.dlMark, { backgroundColor: "#2B6FE3" }]}>
                    <Text style={[styles.dlMarkText, { color: "#ffffff" }]}>W</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.dlName, { color: colors.foreground }]}>My Wallet</Text>
                    <Text style={[styles.dlUrl, { color: colors.primary }]}>mywallet.io</Text>
                  </View>
                  <Feather name="arrow-up-right" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
                <Text style={[styles.dlSteer, { color: colors.mutedForeground }]}>
                  Install it, choose{" "}
                  <Text style={[styles.kSubStrong, { color: colors.foreground }]}>
                    Import from Secret Words
                  </Text>
                  , and paste this key into the box for the first word.
                </Text>

                {!!tonAddress && (
                  /* The last line of defence. Somebody who imports into the
                     wrong app lands on a real but empty wallet, and this is
                     what tells them so before they conclude the money is gone. */
                  <View style={[styles.addrCheck, { borderTopColor: colors.border }]}>
                    <Text style={[styles.addrCheckLabel, { color: colors.mutedForeground }]}>
                      It worked if the address matches:
                    </Text>
                    <Text selectable style={[styles.addrCheckValue, { color: colors.foreground }]}>
                      {tonAddress}
                    </Text>
                  </View>
                )}
              </>
            )}

            <TouchableOpacity
              style={styles.convertDone}
              onPress={() => {
                setConvertInput("");
                setTonKey(null);
                setConvertError(false);
                setStep("choose");
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.convertDoneText, { color: colors.mutedForeground }]}>Done</Text>
            </TouchableOpacity>
          </>
        )}

        {step === "stellar-intro" && (
          <>
            <ChainHead
              logo={require("@/assets/images/stellar.jpg")}
              title="Stellar key"
              tint="#FFFFFF"
              colors={colors}
              fill
            />
            <Text style={[styles.kSub, { color: colors.mutedForeground }]}>
              Your key has to be written differently before a Stellar wallet will accept it.
              That happens here, on this phone.
            </Text>

            <KeySteps
              colors={colors}
              steps={[
                ["Your key is shown", "On your wallet provider's screen. Money Moves never sees it."],
                ["Copy it there", "Nothing else on that screen needs doing."],
                ["Come back here", "It is rewritten for Stellar on this phone and checked against your address."],
              ]}
            />

            <TouchableOpacity
              style={[styles.convertCopy, { backgroundColor: colors.primary }]}
              onPress={() => handleReveal("sol", "stellar")}
              disabled={revealing}
              activeOpacity={0.85}
            >
              {revealing ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <>
                  <Feather name="eye" size={16} color={colors.primaryForeground} />
                  <Text style={[styles.convertCopyText, { color: colors.primaryForeground }]}>
                    Show my key
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.convertDone}
              onPress={() => setStep("choose")}
              activeOpacity={0.7}
            >
              <Text style={[styles.convertDoneText, { color: colors.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>
          </>
        )}

        {step === "stellar" && (
          <>
            <ChainHead
              logo={require("@/assets/images/stellar.jpg")}
              title="Stellar key"
              tint="#FFFFFF"
              colors={colors}
              fill
            />
            <Text style={[styles.kSub, { color: colors.mutedForeground }]}>
              {autoFilled
                ? "Converted from the key you copied. It never left this phone."
                : "Paste the key you just revealed and it is rewritten into the form Stellar accepts, here on this phone. It never leaves your device."}
            </Text>

            {!autoFilled && (
              <>
                <Text style={[styles.convertLabel, { color: colors.mutedForeground, marginTop: 0 }]}>
                  PASTE KEY HERE
                </Text>
                <TextInput
                  style={[
                    styles.convertInput,
                    {
                      backgroundColor: colors.card,
                      color: colors.foreground,
                      borderColor: convertError ? colors.destructive : colors.border,
                    },
                  ]}
                  value={convertInput}
                  onChangeText={(v) => {
                    setConvertInput(v);
                    if (!v.trim()) {
                      setStellarKey(null);
                      setConvertError(false);
                      return;
                    }
                    try {
                      setStellarKey(toStellarKey(v));
                      setConvertError(false);
                    } catch {
                      setStellarKey(null);
                      setConvertError(true);
                    }
                  }}
                  placeholder="The key you just revealed"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline
                />
                {convertError && !!convertInput.trim() && (
                  <Text style={[styles.convertErr, { color: colors.destructive }]}>
                    That does not look like your private key.
                  </Text>
                )}
              </>
            )}

            {stellarKey && (
              <>
                {!!stellarAddress && (
                  <KeyVerdict
                    ok={stellarKey.address === stellarAddress}
                    address={stellarAddress}
                    colors={colors}
                  />
                )}

                <Text style={[styles.convertLabel, { color: colors.mutedForeground, marginTop: 0 }]}>
                  SECRET KEY
                </Text>
                <View style={[styles.convertOut, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text selectable style={[styles.keyMono, { color: colors.foreground }]}>
                    {groupKey(stellarKey.secret)}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.convertCopy, { backgroundColor: colors.primary }]}
                  onPress={() => {
                    Clipboard.setStringAsync(stellarKey.secret);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    Alert.alert("Copied", "Clear your clipboard once you have imported it.");
                  }}
                  activeOpacity={0.85}
                >
                  <Feather name="copy" size={16} color={colors.primaryForeground} />
                  <Text style={[styles.convertCopyText, { color: colors.primaryForeground }]}>
                    Copy key
                  </Text>
                </TouchableOpacity>

                {/* Two things another wallet will not tell them: where the key
                    goes, and that sending from there costs a little XLM, which
                    in Money Moves the treasury pays and they never see. */}
                <Text style={[styles.dlSteer, { color: colors.mutedForeground, marginTop: 16 }]}>
                  Import it as a{" "}
                  <Text style={[styles.kSubStrong, { color: colors.foreground }]}>secret key</Text> in any
                  Stellar wallet. Sending from another wallet needs a little XLM for the network fee;
                  here we pay it for you.
                </Text>

                {!!stellarAddress && (
                  <View style={[styles.addrCheck, { borderTopColor: colors.border }]}>
                    <Text style={[styles.addrCheckLabel, { color: colors.mutedForeground }]}>
                      It worked if the address matches:
                    </Text>
                    <Text selectable style={[styles.addrCheckValue, { color: colors.foreground }]}>
                      {stellarAddress}
                    </Text>
                  </View>
                )}
              </>
            )}

            <TouchableOpacity
              style={styles.convertDone}
              onPress={() => {
                setConvertInput("");
                setStellarKey(null);
                setConvertError(false);
                setStep("choose");
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.convertDoneText, { color: colors.mutedForeground }]}>Done</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ─── Step 3: Mnemonic Display ───────────────── */}
        {step === "phrase" && (
          <>
            <View style={styles.iconWrap}>
              <Feather name="key" size={48} color="#e74c3c" />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Recovery Phrase
            </Text>

            <View
              style={[
                styles.warningBox,
                { backgroundColor: colors.destructive + "15" },
              ]}
            >
              <Feather name="alert-triangle" size={16} color={colors.destructive} />
              <Text style={[styles.warningText, { color: colors.destructive }]}>
                Never share these words with anyone. Anyone with this phrase can access your wallet and steal your funds.
              </Text>
            </View>

            {revealed ? (
              <>
                <View style={styles.wordGrid}>
                  {mnemonic.split(" ").map((word, i) => (
                    <View key={i} style={[styles.wordChip, { backgroundColor: colors.muted }]}>
                      <Text style={[styles.wordNum, { color: colors.mutedForeground }]}>{i + 1}</Text>
                      <Text selectable style={[styles.wordText, { color: colors.foreground }]}>{word}</Text>
                    </View>
                  ))}
                </View>

                <TouchableOpacity
                  style={[styles.outlineBtn, { borderColor: colors.border }]}
                  onPress={handleCopy}
                >
                  <Feather name="copy" size={16} color={colors.primary} />
                  <Text style={[styles.outlineBtnText, { color: colors.primary }]}>Copy to Clipboard</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.outlineBtn, { borderColor: colors.border, marginTop: 8 }]}
                  onPress={handleCloudBackup}
                >
                  <Feather name="upload-cloud" size={16} color={colors.primary} />
                  <Text style={[styles.outlineBtnText, { color: colors.primary }]}>Save Cloud Backup</Text>
                </TouchableOpacity>

                {showBackupInput && (
                  <View style={{ marginTop: 12, gap: 8 }}>
                    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                      Enter a password to encrypt your backup (min 8 characters):
                    </Text>
                    <TextInput
                      style={{
                        backgroundColor: colors.muted,
                        borderRadius: 10,
                        padding: 12,
                        color: colors.foreground,
                        fontFamily: "Inter_500Medium",
                        fontSize: 15,
                        borderWidth: 1,
                        borderColor: colors.border,
                      }}
                      placeholder="Backup password"
                      placeholderTextColor={colors.mutedForeground}
                      secureTextEntry
                      value={backupPassword}
                      onChangeText={setBackupPassword}
                      autoFocus
                    />
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <TouchableOpacity
                        style={[styles.outlineBtn, { borderColor: colors.border, flex: 1 }]}
                        onPress={() => { setShowBackupInput(false); setBackupPassword(""); }}
                      >
                        <Text style={[styles.outlineBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{
                          flex: 1,
                          backgroundColor: colors.primary,
                          borderRadius: 10,
                          paddingVertical: 12,
                          alignItems: "center",
                          justifyContent: "center",
                          opacity: backupLoading ? 0.6 : 1,
                        }}
                        onPress={handleBackupSubmit}
                        disabled={backupLoading}
                      >
                        {backupLoading ? (
                          <ActivityIndicator size="small" color={colors.primaryForeground} />
                        ) : (
                          <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>Encrypt & Save</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </>
            ) : (
              <TouchableOpacity
                style={[styles.revealBox, { backgroundColor: colors.muted, borderColor: colors.border }]}
                onPress={() => setRevealed(true)}
              >
                <Feather name="eye" size={24} color={colors.mutedForeground} />
                <Text style={[styles.revealText, { color: colors.mutedForeground }]}>Tap to reveal recovery phrase</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.btn, { backgroundColor: colors.foreground, marginTop: 24 }]}
              onPress={() => router.back()}
            >
              <Text style={[styles.btnText, { color: colors.background }]}>
                Done
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  scroll: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  iconWrap: {
    alignSelf: "center",
    marginTop: 24,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  lockMark: { width: 46, height: 46 },
  bioBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    alignSelf: "center",
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 14,
    marginBottom: 14,
  },
  bioBtnText: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  chooseLabel: {
    fontSize: 10.5,
    lineHeight: 14,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.1,
    alignSelf: "flex-start",
    marginTop: 22,
    marginBottom: 8,
    marginLeft: 4,
  },
  chooseCard: { alignSelf: "stretch", borderRadius: 18, paddingHorizontal: 14 },
  chooseRow: { flexDirection: "row", alignItems: "center", gap: 13, paddingVertical: 13 },
  chooseIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  chooseMark: { width: 18, height: 18 },
  chooseText: { flex: 1 },
  chooseTitle: { fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  convertLabel: {
    alignSelf: "flex-start",
    fontSize: 10.5,
    lineHeight: 14,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.1,
    marginTop: 18,
    marginBottom: 8,
  },
  convertLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    alignSelf: "stretch",
    marginTop: 14,
    marginBottom: 8,
  },
  convertInput: {
    alignSelf: "stretch",
    minHeight: 76,
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
    textAlignVertical: "top",
  },
  convertNote: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 18,
    marginBottom: 4,
  },
  convertErr: { alignSelf: "flex-start", fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 8 },
  convertArrow: { marginTop: 14 },
  // Outlined in the brand green: the one box on this screen you take away.
  convertOut: { alignSelf: "stretch", borderRadius: 16, borderWidth: 1.5, padding: 14 },
  convertKey: { fontSize: 13, lineHeight: 21, fontFamily: "Inter_500Medium", letterSpacing: 0.2 },
  convertCheck: { flexDirection: "row", alignItems: "center", gap: 5 },
  convertCheckText: { fontSize: 11.5, lineHeight: 15, fontFamily: "Inter_600SemiBold" },
  convertCopy: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 52,
    borderRadius: 16,
    marginTop: 16,
  },
  convertCopyText: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  convertDone: { alignSelf: "center", paddingVertical: 16, paddingHorizontal: 24, marginTop: 4 },
  tonHint: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    marginTop: 14,
  },
  tonHintText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  tonHintAddr: {
    // Matches convertKey above: the app loads no monospace face, and
    // inventing one here would render as the system default on one platform
    // and not the other.
    fontSize: 11.5,
    lineHeight: 17,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.2,
    marginTop: 4,
  },
  convertDoneText: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
  stepNum: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_700Bold" },

  /* ── Key export: TON and Movement ───────────────────────── */
  kHead: { flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 9, alignSelf: "stretch" },
  kMark: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  kMarkImg: { width: 19, height: 19 },
  kMarkClip: { overflow: "hidden" },
  kMarkFill: { width: 32, height: 32 },
  kTitle: { fontSize: 20, lineHeight: 25, fontFamily: "Inter_700Bold", letterSpacing: -0.3, flex: 1 },
  kSub: { fontSize: 13.5, lineHeight: 21, fontFamily: "Inter_400Regular", alignSelf: "stretch", marginBottom: 20 },
  kSubStrong: { fontFamily: "Inter_600SemiBold" },

  rail: { alignSelf: "stretch", marginBottom: 22, position: "relative" },
  railLine: { position: "absolute", left: 4.5, top: 9, bottom: 9, width: 1 },
  railItem: { flexDirection: "row", gap: 14, paddingBottom: 17 },
  railDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, marginTop: 4 },
  railText: { flex: 1 },
  railHead: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  railBody: { fontSize: 12.8, lineHeight: 18, fontFamily: "Inter_400Regular" },

  verify: {
    alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11,
    marginBottom: 18,
  },
  verifyDot: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  verifyText: { flex: 1 },
  verifyHead: { fontSize: 12.8, lineHeight: 17, fontFamily: "Inter_600SemiBold" },
  verifyAddr: { fontSize: 11, lineHeight: 16, fontFamily: "JetBrainsMono_400Regular", marginTop: 1 },

  // The key itself. Monospace so 0 and O, 1 and l can be told apart by
  // somebody checking one character at a time, which is what this screen is for.
  keyMono: { fontSize: 13, lineHeight: 23, fontFamily: "JetBrainsMono_500Medium", letterSpacing: 0.2 },

  dlRow: {
    alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 12,
    borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, paddingVertical: 12,
    marginBottom: 11,
  },
  dlMark: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  dlMarkText: { fontSize: 14, lineHeight: 18, fontFamily: "Inter_700Bold" },
  dlName: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  dlUrl: { fontSize: 11.5, lineHeight: 16, fontFamily: "JetBrainsMono_400Regular", marginTop: 1 },
  dlSteer: { alignSelf: "stretch", fontSize: 12.5, lineHeight: 19, fontFamily: "Inter_400Regular", marginBottom: 18 },

  addrCheck: { alignSelf: "stretch", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14, marginTop: 2 },
  addrCheckLabel: { fontSize: 11.5, lineHeight: 16, fontFamily: "Inter_400Regular", marginBottom: 5 },
  addrCheckValue: { fontSize: 11.5, lineHeight: 18, fontFamily: "JetBrainsMono_400Regular" },
  chooseSub: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular", marginTop: 1 },
  pinDot: { width: 16, height: 16, borderRadius: 8 },
  pad: { width: "100%", maxWidth: 380, alignSelf: "center", paddingHorizontal: 22, marginTop: 6 },
  pinLoading: { marginTop: 60 },
  pinRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    marginBottom: 8,
  },
  codeRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginBottom: 20,
  },
  codeInput: {
    width: 46,
    height: 52,
    borderRadius: 10,
    borderWidth: 1.5,
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  errorText: {
    fontSize: 13,
    textAlign: "center",
    marginBottom: 12,
  },
  btn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  btnText: {
    fontSize: 16,
    fontWeight: "700",
  },
  warningBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  wordGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 20,
    marginTop: 12,
    justifyContent: "center",
  },
  wordChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    gap: 6,
    minWidth: "28%",
  },
  wordNum: {
    fontSize: 12,
    fontWeight: "600",
    width: 18,
  },
  wordText: {
    fontSize: 14,
    fontWeight: "600",
  },
  revealBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
  },
  revealText: {
    fontSize: 14,
  },
  outlineBtn: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  outlineBtnText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
