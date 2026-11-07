import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BlurView } from "expo-blur";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Keypad } from "@/components/Keypad";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import {
  checkTonRecoveryKey,
  getTonRecovery,
  prepareTonRecovery,
  submitTonRecovery,
  type TonRecoveryStatus,
} from "@/services/ton-recovery";
import {
  findLegacyWallet,
  isValidMnemonic,
  oldWalletKeyFromPhrase,
  oldWalletKeyFromSeedHex,
  signWithOldWalletKey,
  type OldWalletKey,
} from "@/services/wallet-core";

type Step = "prompt" | "review" | "words" | "wrong" | "pin" | "moving" | "done" | "failed";

const SNOOZE_MS = 24 * 60 * 60 * 1000;
const snoozeKey = (userId: string) => `mm_ton_recovery_snooze_${userId}`;
const fmt = (n?: number) => (n ?? 0).toFixed(2);
const short = (a?: string) => (a ? `${a.slice(0, 8)}…${a.slice(-4)}` : "");

/**
 * Offers to move USDT out of an older TON wallet into the current one.
 *
 * The old key is found on this phone, or typed in, and used here to sign. Only
 * its public address and the signature ever go to the server, which decides the
 * destination itself. Nothing shows unless the server says there is money to
 * move, and "Not now" holds it off for a day.
 */
export function TonRecoverySheet({ held }: { held?: boolean }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, verifyPin, bioTx, refreshBalances } = useApp();

  const [status, setStatus] = useState<TonRecoveryStatus | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [busy, setBusy] = useState(false);
  const [words, setWords] = useState("");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [problem, setProblem] = useState("");
  const [unsure, setUnsure] = useState(false);
  const [moved, setMoved] = useState<number | null>(null);
  const key = useRef<OldWalletKey | null>(null);
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id || held || asked.current === user.id) return;
    asked.current = user.id;
    const userId = user.id;
    (async () => {
      try {
        const until = Number(await AsyncStorage.getItem(snoozeKey(userId))) || 0;
        if (Date.now() < until) return;
        const found = await getTonRecovery();
        if (found.available) {
          setStatus(found);
          setStep("prompt");
        }
      } catch {
        // Not offered this time; the next launch asks again.
      }
    })();
  }, [user?.id, held]);

  const close = () => {
    key.current = null;
    setWords("");
    setPin("");
    setStep(null);
  };

  const notNow = () => {
    if (user?.id) AsyncStorage.setItem(snoozeKey(user.id), String(Date.now() + SNOOZE_MS)).catch(() => {});
    close();
  };

  /** Look on this phone for the key that controls the older wallet. */
  const start = async () => {
    setBusy(true);
    try {
      if (!key.current) {
        const legacy = await findLegacyWallet(user?.id);
        const candidates: OldWalletKey[] = [];
        if (legacy.mnemonic) candidates.push(oldWalletKeyFromPhrase(legacy.mnemonic));
        if (legacy.embedded) candidates.push(oldWalletKeyFromSeedHex(legacy.embedded.ed25519Seed));
        for (const c of candidates) {
          if (await checkTonRecoveryKey(c.solanaAddress)) {
            key.current = c;
            break;
          }
        }
      }
      setStep(key.current ? "review" : "words");
    } catch {
      setProblem("We couldn't check this just now. Your USDT is safe. Please try again.");
      setStep("failed");
    } finally {
      setBusy(false);
    }
  };

  const checkWords = async () => {
    const phrase = words.trim().toLowerCase().replace(/\s+/g, " ");
    if (!isValidMnemonic(phrase)) {
      setStep("wrong");
      return;
    }
    setBusy(true);
    try {
      const candidate = oldWalletKeyFromPhrase(phrase);
      if (await checkTonRecoveryKey(candidate.solanaAddress)) {
        key.current = candidate;
        setWords("");
        setStep("review");
      } else {
        setStep("wrong");
      }
    } catch {
      setProblem("We couldn't check this just now. Your USDT is safe. Please try again.");
      setStep("failed");
    } finally {
      setBusy(false);
    }
  };

  const askPin = () => {
    const showPad = () => {
      setPin("");
      setPinError(false);
      setStep("pin");
    };
    if (bioTx && Platform.OS !== "web") {
      LocalAuthentication.authenticateAsync({
        promptMessage: "Confirm",
        fallbackLabel: "Use PIN",
        cancelLabel: "Cancel",
      })
        .then((r) => (r.success ? move() : showPad()))
        .catch(showPad);
      return;
    }
    showPad();
  };

  const onPin = async (next: string) => {
    setPinError(false);
    if (next.length > 4) return;
    setPin(next);
    if (next.length < 4) return;
    const wrong = () => {
      setPinError(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setTimeout(() => setPin(""), 600);
    };
    try {
      if (await verifyPin(next)) move();
      else wrong();
    } catch {
      wrong();
    }
  };

  const move = async () => {
    const k = key.current;
    if (!k) return;
    setStep("moving");
    try {
      const { id, signingMessage } = await prepareTonRecovery(k.solanaAddress);
      const signature = signWithOldWalletKey(k, signingMessage);
      const done = await submitTonRecovery(id, signature);
      key.current = null;
      setMoved(Number(done.amount));
      setStep("done");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refreshBalances?.();
    } catch (e: any) {
      setUnsure(e?.response?.data?.code === "UNCONFIRMED");
      setProblem(e?.response?.data?.error || "Your USDT is still in your older wallet and nothing was taken.");
      setStep("failed");
    }
  };

  if (!step) return null;

  const title = { color: colors.foreground };
  const sub = { color: colors.mutedForeground };
  const Button = ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => (
    <TouchableOpacity style={[s.btn, { backgroundColor: colors.primary, opacity: disabled ? 0.6 : 1 }]} onPress={onPress} disabled={disabled} activeOpacity={0.85}>
      {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[s.btnText, { color: colors.primaryForeground }]}>{label}</Text>}
    </TouchableOpacity>
  );
  const Quiet = ({ label, onPress }: { label: string; onPress: () => void }) => (
    <TouchableOpacity style={s.quiet} onPress={onPress} hitSlop={8}>
      <Text style={[s.quietText, sub]}>{label}</Text>
    </TouchableOpacity>
  );
  const Head = ({ text, onClose }: { text: string; onClose?: () => void }) => (
    <View style={s.head}>
      <Text style={[s.heading, title, { flex: 1 }]}>{text}</Text>
      {onClose && (
        <TouchableOpacity onPress={onClose} style={[s.close, { backgroundColor: colors.muted }]} hitSlop={10}>
          <Feather name="x" size={17} color={colors.foreground} />
        </TouchableOpacity>
      )}
    </View>
  );
  const Row = ({ label, value, code }: { label: string; value: string; code?: string }) => (
    <View style={s.row}>
      <Text style={[s.rowLabel, sub]}>{label}</Text>
      <View style={{ flex: 1, alignItems: "flex-end" }}>
        <Text style={[s.rowValue, title]}>{value}</Text>
        {!!code && <Text style={[s.rowCode, sub]}>{code}</Text>}
      </View>
    </View>
  );
  const Mark = ({ name, bg, fg }: { name: any; bg: string; fg: string }) => (
    <View style={[s.mark, { backgroundColor: bg }]}>
      <Feather name={name} size={28} color={fg} />
    </View>
  );

  // Moving can't be dismissed: the transfer is under way.
  const dismiss = step === "moving" ? undefined : step === "prompt" ? notNow : close;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={dismiss}>
      <Pressable style={StyleSheet.absoluteFill} onPress={dismiss}>
        {Platform.OS === "ios" ? (
          <BlurView intensity={22} tint="dark" style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.62)" }]} />
        )}
      </Pressable>

      <View style={s.dock} pointerEvents="box-none">
        <View style={[s.sheet, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: (insets.bottom || 12) + 10 }]}>
          <View style={[s.grip, { backgroundColor: colors.border }]} />

          {step === "prompt" && (
            <>
              <Head text="We found your USDT" onClose={notNow} />
              <Text style={[s.body, sub]}>It is in your older TON wallet. Move it to your current wallet to spend or withdraw it.</Text>
              <View style={[s.panel, { backgroundColor: colors.muted }]}>
                <Text style={[s.amount, title]}>{fmt(status?.amount)} USDT</Text>
                <Text style={[s.rowCode, sub]}>Older TON wallet</Text>
              </View>
              <Button label="Move to my wallet" onPress={start} disabled={busy} />
              <Quiet label="Not now" onPress={notNow} />
            </>
          )}

          {step === "review" && (
            <>
              <Head text="Check the details" onClose={close} />
              <View style={[s.panel, { backgroundColor: colors.muted, gap: 12 }]}>
                <Row label="From" value="Older TON wallet" code={short(status?.oldAddress)} />
                <Row label="To" value="Your current wallet" code={short(status?.currentAddress)} />
                <Row label="You get" value={`${fmt(status?.amount)} USDT`} />
              </View>
              <Text style={[s.body, sub]}>You don't need TON for the fee. A very small amount comes out of the USDT.</Text>
              <Button label="Confirm with PIN" onPress={askPin} />
            </>
          )}

          {step === "words" && (
            <>
              <Head text="Enter your 12 words" onClose={close} />
              <Text style={[s.body, sub]}>We need your old recovery words to move this USDT. They stay on this phone and are never sent to us.</Text>
              <TextInput
                value={words}
                onChangeText={setWords}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                placeholder="word word word"
                placeholderTextColor={colors.mutedForeground}
                style={[s.words, { backgroundColor: colors.muted, color: colors.foreground }]}
              />
              <Button label="Check my words" onPress={checkWords} disabled={busy || !words.trim()} />
              <Quiet label="I can't find them" onPress={close} />
            </>
          )}

          {step === "wrong" && (
            <View style={s.center}>
              <Mark name="x" bg={colors.destructive} fg="#fff" />
              <Text style={[s.heading, title, s.centerText]}>These words don't match</Text>
              <Text style={[s.body, sub, s.centerText]}>They belong to a different wallet, so nothing was moved. Your USDT is still safe in your older wallet.</Text>
              <Button label="Try again" onPress={() => setStep("words")} />
              <Quiet label="Close" onPress={close} />
            </View>
          )}

          {step === "pin" && (
            <>
              <Head text="Confirm with PIN" onClose={close} />
              <Text style={[s.body, sub]}>To move {fmt(status?.amount)} USDT</Text>
              <View style={s.dots}>
                {[0, 1, 2, 3].map((i) => (
                  <View
                    key={i}
                    style={[
                      s.dot,
                      i < pin.length
                        ? { backgroundColor: pinError ? colors.destructive : colors.primary }
                        : { borderWidth: 2, borderColor: pinError ? colors.destructive : colors.border },
                    ]}
                  />
                ))}
              </View>
              <Text style={[s.pinErr, { color: pinError ? colors.destructive : "transparent" }]}>Incorrect PIN, try again</Text>
              <Keypad disabled={pin.length >= 4} onKey={(d) => onPin(pin + d)} onBackspace={() => setPin(pin.slice(0, -1))} />
            </>
          )}

          {step === "moving" && (
            <View style={s.center}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[s.heading, title, s.centerText]}>Moving your USDT</Text>
              <Text style={[s.body, sub, s.centerText]}>This usually takes under a minute. Keep the app open until it finishes.</Text>
            </View>
          )}

          {step === "done" && (
            <View style={s.center}>
              <Mark name="check" bg={colors.primary} fg={colors.primaryForeground} />
              <Text style={[s.heading, title, s.centerText]}>Moved</Text>
              <Text style={[s.amount, title, s.centerText]}>{fmt(moved ?? status?.amount)} USDT</Text>
              <Text style={[s.body, sub, s.centerText]}>It is in your wallet now. Your TON deposit address has also been updated.</Text>
              <Button label="Withdraw to bank" onPress={() => { close(); router.push("/sell"); }} />
              <Quiet label="Done" onPress={close} />
            </View>
          )}

          {step === "failed" && (
            <View style={s.center}>
              <Mark name="alert-triangle" bg={colors.destructive} fg="#fff" />
              <Text style={[s.heading, title, s.centerText]}>{unsure ? "This is taking longer" : "That didn't go through"}</Text>
              <Text style={[s.body, sub, s.centerText]}>{problem}</Text>
              {!unsure && <Button label="Try again" onPress={() => setStep("prompt")} />}
              <Quiet label="Close" onPress={close} />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  dock: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    marginHorizontal: 12,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 12,
  },
  grip: { width: 38, height: 4, borderRadius: 2, alignSelf: "center" },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  heading: { fontSize: 22, lineHeight: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.4 },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  body: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  panel: { borderRadius: 18, padding: 14, gap: 2 },
  amount: { fontSize: 24, lineHeight: 30, fontFamily: "Inter_700Bold", letterSpacing: -0.4 },
  row: { flexDirection: "row", gap: 12 },
  rowLabel: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  rowValue: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  rowCode: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular" },
  btn: { borderRadius: 16, minHeight: 52, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 15.5, fontFamily: "Inter_700Bold" },
  quiet: { alignItems: "center", paddingVertical: 8 },
  quietText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  words: { borderRadius: 16, padding: 14, minHeight: 104, fontSize: 15, lineHeight: 22, fontFamily: "Inter_400Regular", textAlignVertical: "top" },
  center: { alignItems: "stretch", gap: 12, paddingTop: 12 },
  centerText: { textAlign: "center" },
  mark: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  dots: { flexDirection: "row", gap: 14, justifyContent: "center", marginTop: 4 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  pinErr: { textAlign: "center", fontSize: 12.5, fontFamily: "Inter_500Medium" },
});
