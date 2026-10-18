import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { backByLabel } from "@/constants/services";
import { sessionJustEnded } from "@/services/session";

/**
 * What somebody sees when a service is off.
 *
 * Built as a sibling of the Send money sheet - same grip, same corner, same
 * heading weight - so it arrives as part of the app rather than as an error
 * that escaped. The old modal was a centred card with a wrench in it, and a
 * wrench says "we are building something". A pause says "this is coming
 * back", which is both the true thing and the calming one.
 *
 * Everything under the first rule is conditional. With no time to give and
 * nothing else to offer, it collapses to a mark, a heading, a sentence and
 * Got it.
 */

export type PausedDetail = {
  /**
   * Paused is a pause; an error is not.
   *
   * Same sheet, because it is already mounted, already matches the app and
   * already knows how to raise itself from a module call. Only the mark and
   * its colour differ - a pause glyph says "this is coming back", which is
   * exactly the wrong thing to say about a signature that failed.
   */
  kind?: "paused" | "error" | "confirm";
  title: string;
  message: string;
  backBy?: string | null;
  /** Somewhere else to go. Only worth showing when it is genuinely a way round. */
  action?: { label: string; onPress: () => void } | null;
  /**
   * A question rather than a statement.
   *
   * With this set the sheet grows a second button and the first one stops
   * being "Got it": one does the thing, the other walks away. Everything else
   * about it is the same sheet, which is the point - a decision about somebody's
   * money should not arrive looking like a different application.
   */
  confirm?: {
    label: string;
    cancelLabel?: string;
    destructive?: boolean;
    onConfirm: () => void;
  } | null;
};

type Listener = (d: PausedDetail) => void;
let listener: Listener | null = null;

/**
 * Every notice goes up through here.
 *
 * Not in the seconds after a session ends: the screen that was mid-transfer
 * still runs its catch, and "That didn't go through" over the sign-in screen
 * is an error nobody can do anything with.
 */
function raise(detail: PausedDetail) {
  if (sessionJustEnded()) return;
  listener?.(detail);
}

export function showServicePaused(detail: PausedDetail) {
  raise(detail);
}

/**
 * The plain-message entry point, kept for the 503 interceptor.
 *
 * A refusal that arrives mid-flow has a sentence and nothing else - no time,
 * no alternative - so this is the collapsed form of the same sheet.
 */
export function showMaintenanceAlert(message: string, title?: string) {
  raise({ title: title || "Undergoing maintenance", message });
}

/**
 * What the OS alert used to do, in the app's own clothes.
 *
 * Sell, withdraw, bank transfer and username send each called the global
 * alert() in their catch block, so the one moment a person most needs to trust
 * what they are reading was the one moment the app handed them a grey system
 * dialog. This is the same sheet everything else uses.
 */
export function showError(message: string, title?: string) {
  raise({ kind: "error", title: title || "That didn't go through", message });
}

/**
 * Ask before doing something that cannot be taken back.
 *
 * Alert.alert was the only thing standing between somebody and ending a live
 * voucher, and a grey OS dialog is the one surface in the flow the app has no
 * say over - wrong typeface, wrong corners, buttons in whichever order the
 * platform prefers. Same sheet as everything else now.
 */
export function showConfirm(detail: {
  title: string;
  message: string;
  label: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  raise({
    kind: "confirm",
    title: detail.title,
    message: detail.message,
    confirm: {
      label: detail.label,
      cancelLabel: detail.cancelLabel,
      destructive: detail.destructive,
      onConfirm: detail.onConfirm,
    },
  });
}

export function PausedSheet() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState<PausedDetail | null>(null);

  useEffect(() => {
    listener = (d) => setDetail(d);
    return () => {
      listener = null;
    };
  }, []);

  const close = () => setDetail(null);

  return (
    <Modal
      visible={!!detail}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={close}
    >
      <Pressable style={s.backdrop} onPress={close}>
        <View style={s.dock}>
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              s.sheet,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                marginBottom: (insets.bottom || 12) + 10,
              },
            ]}
          >
            {!!detail && <PausedCard detail={detail} onClose={close} />}
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

/**
 * The notice itself, without a sheet of its own.
 *
 * For a sheet that is already open to show in place - Home's Send money and Add
 * money sheets explain a paused option this way rather than closing and
 * raising this one. Two pop-ups swapping in the same moment (one closing, one
 * opening) can leave an invisible layer over the app on iPhone that swallows
 * every tap until it is restarted.
 */
export function PausedCard({ detail, onClose }: { detail: PausedDetail; onClose: () => void }) {
  const colors = useColors();
  const close = onClose;
  const back = backByLabel(detail?.backBy);

  return (
    <>
      <View style={[s.grip, { backgroundColor: colors.border }]} />

      <View style={s.head}>
        <View style={{ flex: 1 }}>
          <Feather
            name={
              detail?.kind === "error"
                ? "alert-triangle"
                : detail?.kind === "confirm"
                ? "help-circle"
                : "pause"
            }
            size={21}
            color={
              detail?.kind === "error"
                ? colors.destructive
                : detail?.kind === "confirm" && detail.confirm?.destructive
                ? colors.destructive
                : colors.warning
            }
            style={{ marginBottom: 9, marginLeft: 1 }}
          />
          <Text style={[s.title, { color: colors.foreground }]}>
            {detail?.title}
          </Text>
        </View>
        <TouchableOpacity
          onPress={close}
          style={[s.close, { backgroundColor: colors.muted }]}
          hitSlop={10}
        >
          <Feather name="x" size={17} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      <Text style={[s.body, { color: colors.mutedForeground }]}>
        {detail?.message}
      </Text>

      {!!back && (
        <>
          <View style={[s.rule, { backgroundColor: colors.border }]} />
          <View style={s.kv}>
            <View style={s.k}>
              <Feather name="clock" size={13} color={colors.mutedForeground} />
              <Text style={[s.kText, { color: colors.mutedForeground }]}>
                Expected back
              </Text>
            </View>
            <Text style={[s.v, { color: colors.foreground }]}>{back}</Text>
          </View>
        </>
      )}

      <View style={[s.rule, { backgroundColor: colors.border }]} />

      {!!detail?.action && (
        <TouchableOpacity
          style={s.ghost}
          activeOpacity={0.6}
          onPress={() => {
            const go = detail.action!.onPress;
            close();
            go();
          }}
        >
          <Text style={[s.ghostText, { color: colors.primary }]}>
            {detail.action.label}
          </Text>
        </TouchableOpacity>
      )}

      {detail?.confirm ? (
        <>
          <TouchableOpacity
            style={[
              s.cta,
              {
                backgroundColor: detail.confirm.destructive
                  ? colors.destructive
                  : colors.primary,
              },
            ]}
            activeOpacity={0.85}
            onPress={() => {
              const go = detail.confirm!.onConfirm;
              close();
              go();
            }}
          >
            <Text
              style={[
                s.ctaText,
                { color: detail.confirm.destructive ? "#fff" : colors.primaryForeground },
              ]}
            >
              {detail.confirm.label}
            </Text>
          </TouchableOpacity>
          {/* Walking away is a link, not a second button. Two filled
              buttons make the destructive one look like half a choice. */}
          <TouchableOpacity style={s.ghost} activeOpacity={0.6} onPress={close}>
            <Text style={[s.ghostText, { color: colors.mutedForeground }]}>
              {detail.confirm.cancelLabel || "Cancel"}
            </Text>
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity
          style={[s.cta, { backgroundColor: colors.primary }]}
          activeOpacity={0.85}
          onPress={close}
        >
          <Text style={[s.ctaText, { color: colors.primaryForeground }]}>Got it</Text>
        </TouchableOpacity>
      )}
    </>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.62)", justifyContent: "flex-end" },
  dock: { width: "100%" },
  sheet: {
    marginHorizontal: 12,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 18,
    paddingBottom: 14,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  grip: { width: 38, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 2, marginBottom: 20 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 4 },
  title: { fontSize: 26, lineHeight: 32, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.8 },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  body: {
    fontSize: 13.5,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
    paddingHorizontal: 4,
    marginTop: 8,
  },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 16, marginHorizontal: 4 },
  kv: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4 },
  k: { flexDirection: "row", alignItems: "center", gap: 7 },
  kText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  v: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  ghost: { height: 46, alignItems: "center", justifyContent: "center", marginHorizontal: 4 },
  ghostText: { fontSize: 14.5, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },
  cta: {
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 4,
    marginTop: 6,
  },
  ctaText: { fontSize: 15.5, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },
});
