import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Modal,
  Pressable,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import {
  getSentVouchers,
  endVoucher,
  VOUCHER_QR_PREFIX,
  type SentVoucher,
} from "@/services/voucher";
import { showConfirm, showError } from "@/components/PausedSheet";
import { useVoucherShare } from "@/hooks/useVoucherShare";

/**
 * The vouchers you sent, and what became of the money.
 *
 * Its job is to answer one question honestly: where is my USDC. So the figure
 * that leads is what is still out there, not what has gone - and the refund
 * says which of the four things it is rather than going quiet once a voucher
 * ends.
 */
export default function SentVouchersScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [rows, setRows] = useState<SentVoucher[] | null>(null);
  const [open, setOpen] = useState<SentVoucher | null>(null);
  const [busy, setBusy] = useState(false);
  // The code is on the server and the QR is drawn from it, so it can be shown
  // as many times as somebody needs. It only ever appeared once because
  // nothing offered it again.
  const [showQr, setShowQr] = useState(false);
  const { shareVoucher, shareCard, sharing } = useVoucherShare();

  const load = useCallback(() => {
    getSentVouchers()
      .then((v) => {
        setRows(v);
        // Keep the open one in step with what just came back.
        setOpen((cur) => (cur ? v.find((x) => x.id === cur.id) ?? null : null));
      })
      .catch(() => setRows([]));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function end(v: SentVoucher) {
    const back = v.leftAmount.toFixed(2);
    showConfirm({
      title: "End this voucher?",
      message: `Nobody else can claim it, and the ${back} USDC nobody took comes straight back to you.`,
      label: `End it & take back ${back}`,
      cancelLabel: "Keep it open",
      destructive: true,
      onConfirm: async () => {
        setBusy(true);
        try {
          await endVoucher(v.id);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          load();
        } catch (e: any) {
          showError(e?.response?.data?.error || "Try again in a moment.", "Could not end it");
        } finally {
          setBusy(false);
        }
      },
    });
  }

  /** What the money is doing, in the words that fit each case. */
  function refundLine(v: SentVoucher): { text: string; tone: string } {
    if (v.refund.state === "SENT" && v.refund.amount > 0) {
      return { text: `${v.refund.amount.toFixed(2)} came back to you`, tone: colors.mutedForeground };
    }
    if (v.refund.state === "DUE") {
      return { text: `${v.refund.amount.toFixed(2)} on its way back`, tone: colors.warning };
    }
    if (v.refund.state === "FAILED") {
      return { text: `${v.refund.amount.toFixed(2)} coming back — we are retrying`, tone: colors.warning };
    }
    if (v.status === "ENDED") return { text: "All claimed", tone: colors.mutedForeground };
    return { text: `${v.leftAmount.toFixed(2)} still out there`, tone: colors.warning };
  }

  const header = (label: string, back: () => void) => (
    <View style={s.header}>
      <TouchableOpacity onPress={back} hitSlop={12}>
        <Feather name="arrow-left" size={22} color={colors.foreground} />
      </TouchableOpacity>
      <Text style={[s.title, { color: colors.foreground }]}>{label}</Text>
    </View>
  );

  /* ── One of them ───────────────────────────────────────────────── */
  if (open) {
    const pct = open.pot > 0 ? Math.min(open.takenAmount / open.pot, 1) : 0;
    const line = refundLine(open);
    const live = open.status === "ACTIVE" && open.leftAmount > 0;

    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        {header(open.code, () => setOpen(null))}
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }}>
          <View style={[s.card, { backgroundColor: colors.card }]}>
            <View style={s.spread}>
              <Text style={[s.figure, { color: colors.foreground }]}>{open.takenAmount.toFixed(2)}</Text>
              <Text style={[s.small, { color: colors.mutedForeground }]}>
                of {open.pot.toFixed(2)} claimed
              </Text>
            </View>
            <View style={[s.track, { backgroundColor: colors.border }]}>
              <View style={[s.fill, { width: `${pct * 100}%`, backgroundColor: colors.primary }]} />
            </View>
            <View style={s.spread}>
              <Text style={[s.small, { color: colors.mutedForeground }]}>
                {open.claimed} of {open.of} people
              </Text>
              <Text style={[s.small, { color: line.tone }]}>{line.text}</Text>
            </View>
          </View>

          <Text style={[s.kicker, { color: colors.mutedForeground, marginTop: 22 }]}>WHO GOT WHAT</Text>
          {open.who.length === 0 ? (
            <Text style={[s.small, { color: colors.mutedForeground, marginTop: 12 }]}>
              Nobody has claimed it yet.
            </Text>
          ) : (
            open.who.map((w, i) => (
              <View key={i} style={[s.row, { borderBottomColor: colors.border }]}>
                <View style={[s.avatar, { backgroundColor: colors.border }]}>
                  <Text style={[s.initial, { color: colors.primary }]}>
                    {(w.username ?? "?").slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[s.who, { color: colors.foreground }]}>@{w.username ?? "someone"}</Text>
                  <Text style={[s.when, { color: colors.mutedForeground }]}>
                    {new Date(w.at).toLocaleString("en-GB", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                </View>
                <Text style={[s.amount, { color: colors.primary }]}>{w.amount.toFixed(2)}</Text>
              </View>
            ))
          )}

          {!!open.endsAt && (
            <View style={s.noteRow}>
              <Feather name="clock" size={16} color={colors.mutedForeground} />
              <Text style={[s.noteText, { color: colors.mutedForeground }]}>
                {live
                  ? `Ends ${new Date(open.endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}. End it now and the ${open.leftAmount.toFixed(2)} nobody claimed is sent straight back to you.`
                  : "This one has finished. Anything unclaimed has already been sent back."}
              </Text>
            </View>
          )}

          {!!open.refund.txHash && (
            <Text style={[s.when, { color: colors.mutedForeground, marginTop: 10 }]}>
              Refund {open.refund.txHash.slice(0, 8)}…{open.refund.txHash.slice(-6)}
            </Text>
          )}
        </ScrollView>

        {live && (
          <View style={[s.dock, { paddingBottom: bottomPad + 14, gap: 10 }]}>
            {/* Only while there is something left. Handing out the QR for a
                voucher with nothing in it wastes somebody's scan. */}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity
                style={[s.cta, s.ctaRow, { backgroundColor: colors.primary, flex: 1, opacity: sharing ? 0.6 : 1 }]}
                onPress={() =>
                  shareVoucher({
                    code: open.code,
                    qrValue: `${VOUCHER_QR_PREFIX}${open.code}`,
                    amount: open.leftAmount,
                    people: Math.max(open.of - open.claimed, 1),
                    endsAt: open.endsAt,
                  })
                }
                disabled={sharing}
                activeOpacity={0.85}
              >
                {sharing ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <>
                    <Feather name="share" size={17} color={colors.primaryForeground} />
                    <Text style={[s.ctaText, { color: colors.primaryForeground }]}>Share</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.square, { borderColor: colors.border }]}
                onPress={() => setShowQr(true)}
                activeOpacity={0.7}
              >
                <Feather name="maximize" size={18} color={colors.foreground} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[s.ghostBtn, { borderColor: colors.border, opacity: busy ? 0.5 : 1 }]}
              onPress={() => end(open)}
              disabled={busy}
              activeOpacity={0.75}
            >
              {busy ? (
                <ActivityIndicator color={colors.foreground} />
              ) : (
                <Text style={[s.ghostText, { color: colors.foreground }]}>
                  End it &amp; take back {open.leftAmount.toFixed(2)}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* The code again, as big as it needs to be to scan off a screen. */}
        <Modal visible={showQr} transparent animationType="fade" onRequestClose={() => setShowQr(false)}>
          <Pressable style={s.qrBackdrop} onPress={() => setShowQr(false)}>
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={[s.qrSheet, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={s.qrWhite}>
                <QRCode value={`${VOUCHER_QR_PREFIX}${open.code}`} size={216} backgroundColor="#fff" />
              </View>
              <Text style={[s.qrCode, { color: colors.foreground }]}>{open.code}</Text>
              <Text style={[s.small, { color: colors.mutedForeground, textAlign: "center" }]}>
                {open.leftAmount.toFixed(2)} USDC left for {Math.max(open.of - open.claimed, 0)} more{" "}
                {open.of - open.claimed === 1 ? "person" : "people"}
              </Text>
              <TouchableOpacity
                style={[s.cta, { backgroundColor: colors.primary, alignSelf: "stretch", marginTop: 18 }]}
                onPress={() => setShowQr(false)}
                activeOpacity={0.85}
              >
                <Text style={[s.ctaText, { color: colors.primaryForeground }]}>Done</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>

        {shareCard}
      </View>
    );
  }

  /* ── The list ──────────────────────────────────────────────────── */
  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {header("Your vouchers", () => router.back())}
      {!rows ? (
        <View style={s.centre}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : rows.length === 0 ? (
        <View style={s.centre}>
          <Text style={[s.small, { color: colors.mutedForeground }]}>You have not sent one yet.</Text>
          <TouchableOpacity
            style={[s.cta, { backgroundColor: colors.primary, marginTop: 18, paddingHorizontal: 22 }]}
            onPress={() => router.replace("/voucher-send")}
            activeOpacity={0.85}
          >
            <Text style={[s.ctaText, { color: colors.primaryForeground }]}>Send one</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: bottomPad + 20 }}>
          {rows.map((v) => {
            const line = refundLine(v);
            return (
              <TouchableOpacity
                key={v.id}
                style={[s.listCard, { backgroundColor: colors.card }]}
                onPress={() => setOpen(v)}
                activeOpacity={0.75}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={[s.code, { color: colors.foreground }]} numberOfLines={1}>
                      {v.code}
                    </Text>
                    {v.lucky && (
                      <Feather name="shuffle" size={13} color={colors.primary} />
                    )}
                  </View>
                  <Text style={[s.when, { color: line.tone, marginTop: 3 }]}>{line.text}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[s.amount, { color: colors.foreground }]}>{v.pot.toFixed(2)}</Text>
                  <Text style={[s.when, { color: colors.mutedForeground }]}>
                    {v.claimed} of {v.of}
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 30 },
  header: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, height: 44 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },

  listCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, padding: 16, marginBottom: 12 },
  code: { fontSize: 14.5, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },

  card: { borderRadius: 20, padding: 18 },
  spread: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  figure: { fontSize: 32, fontFamily: "Inter_800ExtraBold", letterSpacing: -1.4, fontVariant: ["tabular-nums"] },
  track: { height: 7, borderRadius: 4, overflow: "hidden", marginTop: 12, marginBottom: 11 },
  fill: { height: 7, borderRadius: 4 },

  kicker: { fontSize: 11, letterSpacing: 1.1, fontFamily: "Inter_600SemiBold" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  initial: { fontSize: 13, fontFamily: "Inter_700Bold" },
  who: { fontSize: 13.5, fontFamily: "Inter_600SemiBold" },
  when: { fontSize: 11.5, fontFamily: "Inter_400Regular" },
  amount: { fontSize: 15, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  small: { fontSize: 12.5, fontFamily: "Inter_400Regular" },

  noteRow: { flexDirection: "row", gap: 9, alignItems: "flex-start", marginTop: 18 },
  noteText: { flex: 1, fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },

  dock: { paddingHorizontal: 20, paddingTop: 10 },
  cta: { height: 50, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  ctaRow: { flexDirection: "row", gap: 8 },
  square: {
    width: 50,
    height: 50,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  qrBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  qrSheet: {
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 22,
    alignItems: "center",
    alignSelf: "stretch",
  },
  // The QR sits on white whatever the theme is, because a scanner needs the
  // contrast and a dark-mode code is one people quietly fail to read.
  qrWhite: { padding: 16, borderRadius: 20, backgroundColor: "#fff" },
  qrCode: {
    fontSize: 19,
    lineHeight: 24,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.4,
    marginTop: 16,
    marginBottom: 6,
    textAlign: "center",
  },
  ctaText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  ghostBtn: { height: 54, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  ghostText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
