import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import {
  emailStatement,
  STATEMENT_GROUPS,
  type StatementType,
} from "@/services/statement";

/**
 * Ask for a statement.
 *
 * The top of the screen is the statement's own letterhead, and it fills in as
 * the choices are made. Two lists of grey chips told somebody what the options
 * were and nothing about what they would receive; a cover that reads
 * "24 Jun - 21 Sep 2026, everything, to coo•••@gmail.com" is the whole request in
 * the words the document will use.
 *
 * The lists underneath are rows with a mark on the chosen one rather than
 * pills, because these are settings being read back, not filters being flicked
 * through - and a wall of identical capsules is the same shape whatever it is
 * for.
 */

type Preset = { key: string; label: string; days: number | "ytd" | "custom" };

const PRESETS: Preset[] = [
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 3 months", days: 90 },
  { key: "ytd", label: "This year", days: "ytd" },
  { key: "custom", label: "Pick dates", days: "custom" },
];

export default function StatementScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [preset, setPreset] = useState("30");
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d;
  });
  const [customTo, setCustomTo] = useState(new Date());
  const [picking, setPicking] = useState<"from" | "to" | null>(null);

  const [groups, setGroups] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<{ email: string; rows: number } | null>(null);

  const { from, to } = useMemo(() => {
    const now = new Date();
    const p = PRESETS.find((x) => x.key === preset)!;
    if (p.days === "custom") return { from: customFrom, to: customTo };
    if (p.days === "ytd") return { from: new Date(now.getFullYear(), 0, 1), to: now };
    const start = new Date(now);
    start.setDate(start.getDate() - (p.days as number) + 1);
    return { from: start, to: now };
  }, [preset, customFrom, customTo]);

  const types: StatementType[] | null = useMemo(() => {
    if (!groups.length) return null;
    return STATEMENT_GROUPS.filter((g) => groups.includes(g.key)).flatMap((g) => g.types);
  }, [groups]);

  const toggle = (key: string) =>
    setGroups((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    Haptics.selectionAsync().catch(() => {});
    try {
      const r = await emailStatement(from, to, types);
      setSent({ email: r.email, rows: r.rows });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      setError(e?.response?.data?.error || "Could not send that. Try again shortly.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const full = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const range = `${day(from)} – ${full(to)}`;

  const included =
    groups.length === 0
      ? "Everything"
      : STATEMENT_GROUPS.filter((g) => groups.includes(g.key))
          .map((g) => g.label)
          .join(", ");

  const dest = mask(user?.email);

  /* ── Sent ─────────────────────────────────────────────────────────── */
  if (sent) {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <View style={s.done}>
          {/* One word, at the size of the thing that just happened. A disc
              with a glyph in it and a sentence underneath is the shape every
              confirmation screen has; this one says what it did. */}
          <Text style={[s.sentWord, { color: colors.foreground }]}>Sent.</Text>

          {/* The same cover as the request. Seeing the document you set up
              come back is the confirmation - a tick only says the tap
              registered. */}
          <Cover
            range={range}
            meta={`${sent.rows} transaction${sent.rows === 1 ? "" : "s"} · ${included}`}
          />

          <View style={[s.toRow, { borderColor: colors.border }]}>
            <Feather name="mail" size={15} color={colors.primary} />
            <Text style={[s.toAddr, { color: colors.foreground }]} numberOfLines={1}>
              {sent.email}
            </Text>
          </View>
          <Text style={[s.doneNote, { color: colors.mutedForeground }]}>
            It can take a minute to arrive. Check spam if it does not.
          </Text>
        </View>
        <View style={[s.dock, { paddingBottom: bottomPad + 10 }]}>
          <TouchableOpacity
            style={[s.cta, { backgroundColor: colors.foreground }]}
            onPress={() => router.back()}
            activeOpacity={0.85}
          >
            <Text style={[s.ctaText, { color: colors.background }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  /* ── Ask ──────────────────────────────────────────────────────────── */
  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.foreground }]}>Statement</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
      >
        {/* The document's own cover, filling in as it is chosen. It is drawn
            the way the PDF is drawn - black band, the period in serif - so
            what arrives is recognisable as the thing on this screen. */}
        <Cover range={range} meta={`${included}${dest ? ` · to ${dest}` : ""}`} />

        <Section colors={colors} label="Period" />
        <View style={[s.card, { borderColor: colors.border }]}>
          {PRESETS.map((p, i) => (
            <Row
              key={p.key}
              colors={colors}
              first={i === 0}
              label={p.label}
              hint={p.key === preset && p.days !== "custom" ? range : undefined}
              on={p.key === preset}
              onPress={() => setPreset(p.key)}
            />
          ))}
          {preset === "custom" &&
            (["from", "to"] as const).map((which) => (
              <TouchableOpacity
                key={which}
                style={[s.dateRow, { borderTopColor: colors.border }]}
                onPress={() => setPicking(which)}
                activeOpacity={0.7}
              >
                <Text style={[s.dateLabel, { color: colors.mutedForeground }]}>
                  {which === "from" ? "From" : "To"}
                </Text>
                <Text style={[s.dateValue, { color: colors.foreground }]}>
                  {full(which === "from" ? customFrom : customTo)}
                </Text>
                <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
              </TouchableOpacity>
            ))}
        </View>

        <Section colors={colors} label="Include" />
        <View style={[s.card, { borderColor: colors.border }]}>
          {/* Nothing chosen is everything, which is what most people want and
              saves them ticking six things to get it. */}
          <Row
            colors={colors}
            first
            label="Everything"
            on={groups.length === 0}
            onPress={() => setGroups([])}
          />
          {STATEMENT_GROUPS.map((g) => (
            <Row
              key={g.key}
              colors={colors}
              label={g.label}
              on={groups.includes(g.key)}
              onPress={() => toggle(g.key)}
            />
          ))}
        </View>

        {!!error && <Text style={[s.error, { color: colors.destructive }]}>{error}</Text>}
      </ScrollView>

      {picking && (
        <DateTimePicker
          value={picking === "from" ? customFrom : customTo}
          mode="date"
          maximumDate={new Date()}
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={(e, d) => {
            setPicking(Platform.OS === "ios" ? picking : null);
            if (e.type === "dismissed") { setPicking(null); return; }
            if (!d) return;
            if (picking === "from") setCustomFrom(d);
            else setCustomTo(d);
          }}
        />
      )}
      {picking && Platform.OS === "ios" && (
        <TouchableOpacity
          style={[s.pickerDone, { backgroundColor: colors.card }]}
          onPress={() => setPicking(null)}
        >
          <Text style={[s.pickerDoneText, { color: colors.foreground }]}>Done</Text>
        </TouchableOpacity>
      )}

      <View style={[s.dock, { paddingBottom: bottomPad + 10 }]}>
        <TouchableOpacity
          style={[s.cta, { backgroundColor: colors.foreground, opacity: busy ? 0.6 : 1 }]}
          onPress={send}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : (
            <Text style={[s.ctaText, { color: colors.background }]}>Email it to me</Text>
          )}
        </TouchableOpacity>
        {busy && (
          <Text style={[s.dockNote, { color: colors.mutedForeground }]}>
            Building your statement…
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * The statement's letterhead, drawn the way the PDF draws it.
 *
 * Shown while the request is being made and again once it has gone, so the
 * thing configured and the thing delivered are visibly the same document.
 */
function Cover({ range, meta }: { range: string; meta: string }) {
  return (
    <View style={s.cover}>
      <View style={s.coverTop}>
        <Image
          source={require("@/assets/images/logo-lockup.png")}
          style={s.coverMark}
          resizeMode="contain"
        />
        <Text style={s.coverEyebrow}>ACCOUNT STATEMENT</Text>
      </View>
      <Text style={s.coverRange}>{range}</Text>
      <Text style={s.coverMeta} numberOfLines={2}>{meta}</Text>
    </View>
  );
}

function Section({ colors, label }: { colors: any; label: string }) {
  return <Text style={[s.section, { color: colors.mutedForeground }]}>{label}</Text>;
}

/**
 * A choice, read back rather than flicked through.
 *
 * The mark is on the right where a value would be, so the column reads as a
 * list of settings - a filled capsule per option made seven identical shapes
 * and left the chosen one identifiable only by its colour.
 */
function Row({
  colors,
  label,
  hint,
  on,
  first,
  onPress,
}: {
  colors: any;
  label: string;
  hint?: string;
  on: boolean;
  first?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        s.row,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[s.rowLabel, { color: colors.foreground }]}>{label}</Text>
      {!!hint && (
        <Text style={[s.rowHint, { color: colors.mutedForeground }]} numberOfLines={1}>
          {hint}
        </Text>
      )}
      <View
        style={[
          s.mark,
          on
            ? { backgroundColor: colors.foreground, borderColor: colors.foreground }
            : { borderColor: colors.border },
        ]}
      >
        {on && <Feather name="check" size={12} color={colors.background} />}
      </View>
    </TouchableOpacity>
  );
}

/** Enough to recognise the inbox, not enough to read the address off a screen. */
function mask(email?: string | null): string {
  if (!email) return "";
  const [name, domain] = email.split("@");
  if (!domain) return email;
  return `${name.slice(0, 3)}•••@${domain}`;
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 14 },
  title: { fontSize: 15.5, fontFamily: "Inter_600SemiBold" },

  cover: {
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 6,
    padding: 16,
    borderRadius: 14,
    backgroundColor: "#0B0D0A",
  },
  coverTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  coverMark: { width: 92, height: 15 },
  coverEyebrow: {
    fontSize: 8.5,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.3,
    color: "#A8AEA0",
  },
  coverRange: {
    fontSize: 21,
    lineHeight: 27,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
    color: "#FFFFFF",
    marginTop: 18,
  },
  coverMeta: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: "Inter_400Regular",
    color: "#A8AEA0",
    marginTop: 5,
  },

  section: {
    fontSize: 12.5,
    fontFamily: "Inter_600SemiBold",
    marginTop: 22,
    marginBottom: 9,
    marginHorizontal: 22,
  },
  card: {
    marginHorizontal: 20,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 15, paddingVertical: 13 },
  rowLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  rowHint: { flex: 1, textAlign: "right", fontSize: 11.5, fontFamily: "Inter_400Regular" },
  mark: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.4,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "auto",
  },

  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 15,
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dateLabel: { width: 40, fontSize: 13, fontFamily: "Inter_400Regular" },
  dateValue: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },

  error: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 18, marginHorizontal: 22 },

  pickerDone: { alignItems: "center", paddingVertical: 12, marginHorizontal: 20, borderRadius: 12 },
  pickerDoneText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  dock: { paddingHorizontal: 20, paddingTop: 10 },
  cta: { height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 15.5, fontFamily: "Inter_600SemiBold" },
  dockNote: { fontSize: 11.5, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 9 },

  done: { flex: 1, justifyContent: "center" },
  sentWord: {
    fontSize: 56,
    lineHeight: 62,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -2.4,
    marginHorizontal: 20,
    marginBottom: 22,
  },
  toRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginHorizontal: 20,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toAddr: { flex: 1, fontSize: 13.5, fontFamily: "Inter_500Medium" },
  doneNote: {
    fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular",
    marginHorizontal: 22, marginTop: 10,
  },
});
