import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
} from "react-native";
import { CameraView, useCameraPermissions, scanFromURLAsync } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { readAccountFromImage, hasDeviceReader } from "@/services/text-recognition";

export interface ScannedAccount {
  accountNumber: string;
  bankName: string | null;
}

/** Enough readings to choose between; past that the list is just clutter. */
const MAX_RESULTS = 4;

/**
 * A live scanner for account numbers.
 *
 * The camera is the whole screen and reading happens on a press. It used to
 * read on a timer, which felt better and cost far too much: every frame is a
 * vision-model call, so a loop at one-and-a-half seconds is roughly thirty-
 * seven of them a minute for as long as anyone holds the phone up - enough to
 * burn a day's quota while still aiming. A tap is one call, made on purpose.
 *
 * The timer is the right shape once reading is free. On-device text
 * recognition would make it so, at the cost of a native module and a rebuild.
 *
 * Anything read is offered as a chip to confirm rather
 * than filled in silently: OCR on a screenshot of a chat is right most of the
 * time, and "most of the time" is not good enough to put into an account field
 * unasked.
 */
export function AccountScanner({
  visible,
  onClose,
  onPick,
  onCode,
  title = "Scan to pay",
  hint,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (account: ScannedAccount) => void;
  /**
   * Called with the contents of a QR code in frame.
   *
   * Barcode detection is on-device and free, so unlike the account reader it
   * can run continuously - the camera simply notices a code rather than
   * waiting to be asked. Leave it out and the scanner only reads numbers.
   */
  onCode?: (data: string) => void;
  title?: string;
  hint?: string;
}) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);

  const [results, setResults] = useState<ScannedAccount[]>([]);
  /** One code per opening: the camera fires this many times a second. */
  const codeSeen = useRef(false);
  const [busy, setBusy] = useState(false);
  const [nothingInPhoto, setNothingInPhoto] = useState(false);
  /**
   * What the server actually said, when it said anything.
   *
   * Swallowing these was wrong: a reader that is misconfigured, unreachable or
   * out of quota produced the same silence as a blurry frame, so "it never
   * detects anything" was indistinguishable from "the endpoint is returning
   * 503". Whatever comes back is shown.
   */
  const [failure, setFailure] = useState<string | null>(null);
  /** Which reader this build has, shown so a test tells you which one answered. */
  const onDevice = hasDeviceReader();
  /**
   * True while the gallery is open.
   *
   * The camera loop has to stop for it. Taking a picture while the app is
   * behind the photo picker can hang, and a hung capture never releases the
   * busy flag - which is what left the scanner stuck on "Reading…" with every
   * later attempt refusing to start.
   */
  const pickingRef = useRef(false);

  // Refs as well as state: the interval closes over its first render, and
  // these are what it needs to read at the moment it fires.
  const busyRef = useRef(false);
  const resultsRef = useRef<ScannedAccount[]>([]);

  const reset = useCallback(() => {
    setResults([]);
    setBusy(false);
    setNothingInPhoto(false);
    setFailure(null);
    resultsRef.current = [];
    busyRef.current = false;
  }, []);

  useEffect(() => {
    if (!visible) return;
    reset();
    if (!permission?.granted) requestPermission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const record = useCallback((found: { accountNumber: string | null; bankName: string | null }) => {
    if (!found.accountNumber) return;
    const already = resultsRef.current.some((r) => r.accountNumber === found.accountNumber);
    if (already) return;

    const next = [...resultsRef.current, { accountNumber: found.accountNumber, bankName: found.bankName }];
    resultsRef.current = next;
    setResults(next);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  /** One frame, read and folded into the results. */
  const readOnce = useCallback(async () => {
    if (busyRef.current || pickingRef.current || !camera.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      // Low quality on purpose: the upload and the model both scale with the
      // file, and a number large enough for a camera to resolve survives heavy
      // compression easily.
      const shot = await Promise.race([
        camera.current.takePictureAsync({ quality: 0.35, skipProcessing: true }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
      ]);
      if (shot?.uri) {
        setFailure(null);
        setNothingInPhoto(false);
        const found = await readAccountFromImage(shot.uri);
        record(found);
        // Every press is deliberate, so every press gets an answer - silence
        // after one would read as the button not working.
        if (!found.accountNumber) setNothingInPhoto(true);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Could not reach the reader";
      console.warn("[SCANNER] read failed:", msg);
      setFailure(msg);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [record]);


  /** The same reader, pointed at a picture they already have. */
  const fromGallery = async () => {
    if (busyRef.current || pickingRef.current) return;
    pickingRef.current = true;
    setNothingInPhoto(false);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.7,
      });
      if (picked.canceled || !picked.assets[0]) return;

      const uri = picked.assets[0].uri;

      // A QR in the picture is read first, and for free. Sending a screenshot
      // of someone's code to the account reader would have come back with
      // nothing found, which is a confusing answer to a perfectly good code.
      if (onCode) {
        try {
          const codes = await scanFromURLAsync(uri, ["qr"]);
          const data = codes?.[0]?.data;
          if (data) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            onCode(data);
            return;
          }
        } catch {
          // Not every platform can read a file this way; fall through to the
          // account reader rather than failing the whole pick.
        }
      }

      busyRef.current = true;
      setBusy(true);
      const found = await readAccountFromImage(uri);
      record(found);
      // record() ignores a reading with no number, so without this a photo
      // that cannot be read looks identical to one still being read.
      if (!found.accountNumber) setNothingInPhoto(true);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Could not reach the reader";
      console.warn("[SCANNER] gallery read failed:", msg);
      setFailure(msg);
    } finally {
      pickingRef.current = false;
      busyRef.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    if (visible) codeSeen.current = false;
  }, [visible]);

  if (!visible) return null;

  const denied = permission && !permission.granted && !permission.canAskAgain;

  return (
    <Modal visible animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={s.root}>
        {permission?.granted ? (
          <CameraView
            ref={camera}
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={onCode ? { barcodeTypes: ["qr"] } : undefined}
            onBarcodeScanned={
              onCode
                ? ({ data }) => {
                    if (codeSeen.current || !data) return;
                    codeSeen.current = true;
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    onCode(data);
                  }
                : undefined
            }
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, s.permission]}>
            <Feather name="camera-off" size={30} color="#8a8a8f" />
            <Text style={s.permissionText}>
              {denied
                ? "Camera access is off. Turn it on in Settings to scan, or upload a photo instead."
                : "Waiting for camera access…"}
            </Text>
          </View>
        )}

        {/* Back, title, gallery - the gallery lives up here rather than as a
            button in the way of the preview. */}
        {/* Big enough to read as "aim roughly here" rather than as a crop.
            The reader scans the whole frame, so a tight box would promise a
            restriction that does not exist - at this size the brackets agree
            with what actually happens. */}
        <View style={s.frame} pointerEvents="none">
          <View style={[s.corner, s.tl]} />
          <View style={[s.corner, s.tr]} />
          <View style={[s.corner, s.bl]} />
          <View style={[s.corner, s.br]} />
        </View>

        <View style={[s.top, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={onClose} style={s.round} hitSlop={12}>
            <Feather name="chevron-left" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={s.title}>{title}</Text>
          <TouchableOpacity onPress={fromGallery} style={s.round} hitSlop={12}>
            <Feather name="image" size={19} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={[s.bottom, { paddingBottom: insets.bottom + 28 }]}>
          {/* Readings sit above the caption, so the thing to tap is nearest
              the thumb and the explanation stays put underneath. */}
          {results.map((r) => (
            <TouchableOpacity
              key={r.accountNumber}
              style={s.hit}
              activeOpacity={0.8}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onPick(r);
              }}
            >
              <Text style={s.hitText}>{r.accountNumber}</Text>
              {!!r.bankName && <Text style={s.hitBank}>{r.bankName}</Text>}
              <Ionicons name="checkmark-circle-outline" size={19} color="#0a0a0a" />
            </TouchableOpacity>
          ))}

          {/* The reader's own words, not our guess at them. */}
          {failure && (
            <TouchableOpacity style={s.quiet} onPress={reset} activeOpacity={0.8}>
              <Feather name="alert-triangle" size={15} color="#fff" />
              <Text style={s.quietText} numberOfLines={2}>
                {failure}
              </Text>
            </TouchableOpacity>
          )}

          {nothingInPhoto && !failure && (
            <View style={s.quiet}>
              <Feather name="alert-circle" size={15} color="#fff" />
              <Text style={s.quietText}>No account number in that photo</Text>
            </View>
          )}

          {/* Dark on light, over a camera feed that could be any colour.
              White text on a preview is legible until someone points it at a
              white wall. */}
          {/* One press, one reading. Big and centred, because it is the only
              thing on this screen that starts anything. */}
          <TouchableOpacity
            style={[s.shutter, busy && s.shutterBusy]}
            onPress={readOnce}
            disabled={busy || !permission?.granted}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color="#0a0a0a" />
            ) : (
              <View style={s.shutterCore} />
            )}
          </TouchableOpacity>

          <View style={s.tip}>
            <Text style={s.tipText}>
              {hint ??
                "Line up an account number, then tap to scan. Or upload a photo you already have."}
            </Text>
            {__DEV__ && (
              <Text style={s.tipVia}>{onDevice ? "on-device reader" : "server reader"}</Text>
            )}
          </View>

          {busy && <Text style={s.readingText}>Reading…</Text>}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  permission: { alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 40 },
  permissionText: { color: "#8a8a8f", fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular", textAlign: "center" },

  top: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 14 },
  round: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#00000059", alignItems: "center", justifyContent: "center" },
  title: { color: "#fff", fontSize: 17, lineHeight: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },


  // Anchored by all four edges, so it grows with the screen instead of
  // holding a fixed height that only suits one phone.
  frame: { position: "absolute", top: "14%", left: "7%", right: "7%", bottom: "32%" },
  corner: { position: "absolute", width: 52, height: 52, borderColor: "#ffffffcc" },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 26 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 26 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 26 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 26 },

  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", paddingHorizontal: 24, gap: 10 },
  // Bright and solid: a reading is the one thing on this screen worth tapping.
  hit: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#81FB02", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14 },
  hitText: { color: "#0a0a0a", fontSize: 16, lineHeight: 21, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.2 },
  hitBank: { color: "#0a0a0acc", fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_600SemiBold" },

  quiet: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#ffffff1F", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14 },
  quietText: { flexShrink: 1, color: "#fff", fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold" },

  tip: {
    alignItems: "center",
    gap: 8,
    backgroundColor: "#ffffff80",
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 16,
    marginTop: 6,
  },
  tipText: { color: "#0a0a0a", fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  // Development only: which reader answered is the whole question while this
  // is being compared, and guessing from latency alone is unreliable.
  tipVia: { color: "#0a0a0a99", fontSize: 10.5, lineHeight: 14, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  // Under the card, on the preview: a passing state, not an instruction.
  readingText: { color: "#ffffffcc", fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_600SemiBold", marginTop: 2 },

  shutter: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 4,
    borderColor: "#ffffff",
    backgroundColor: "#ffffff40",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  shutterBusy: { backgroundColor: "#ffffffE6" },
  shutterCore: { width: 50, height: 50, borderRadius: 25, backgroundColor: "#fff" },
});
