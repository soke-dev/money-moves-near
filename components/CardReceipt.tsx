import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Clipboard, useWindowDimensions } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { CardFace } from "@/components/CardFace";
import { getCards, type CardSummary } from "@/services/cards";

/**
 * One card transaction: the card it happened on, drawn, then what happened,
 * set out as a statement line would be. Used for every CARD row (payments,
 * declines, refunds, a card made, money withdrawn, fees).
 *
 * The card's last four and kind come from the cards list, so the picture is
 * the real card; until that answers it shows the name with the number masked.
 */

type Ev = "paid" | "declined" | "refund" | "created" | "toWallet" | "fee" | "topup";

const TYPE: Record<Ev, string> = {
  paid: "Card payment",
  declined: "Declined payment",
  refund: "Refund",
  created: "New card",
  toWallet: "Withdrawn to wallet",
  fee: "Card fee",
  topup: "Top up",
};

const usd = (n: number) => `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "card-paid-01M7FCW…" → "PAID-01M7FCW…": the part support can look up. */
function refOf(reference: string | null | undefined): string {
  return String(reference || "").replace(/^card-/, "").toUpperCase();
}

export function CardReceipt({ tx }: { tx: any }) {
  const colors = useColors();
  const { user } = useApp() as any;
  const { width } = useWindowDimensions();
  const meta: any = tx.metadata || {};
  const ev: Ev = (TYPE as any)[meta.cardEvent] ? meta.cardEvent : "paid";
  const [card, setCard] = useState<CardSummary | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    getCards()
      .then((o: any) => live && setCard((o?.cards || []).find((c: CardSummary) => c.id === meta.cardId) || null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [meta.cardId]);

  const holder = `${user?.firstName || ""} ${user?.lastName || ""}`.trim().toUpperCase();
  const cardName = card?.name || meta.cardName || "Card";
  const last4 = card?.last4 || null;
  const amount = Number(tx.amount) || 0;
  const merchant: string | null = meta.merchant || null;
  const at = new Date(tx.createdAt);
  const when = `${at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}, ${at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  const failed = tx.status === "FAILED" || ev === "declined";
  const pending = tx.status === "PENDING" || tx.status === "PROCESSING";

  const sign = ev === "refund" || ev === "topup" ? "+" : ev === "declined" ? "" : "−";
  const headline =
    ev === "paid" ? merchant || "Card payment"
    : ev === "declined" ? `Declined at ${merchant || "a merchant"}`
    : ev === "refund" ? `Refund from ${merchant || "a merchant"}`
    : ev === "created" ? "Card created"
    : ev === "toWallet" ? "Withdrawn to your wallet"
    : ev === "topup" ? "Added to your card"
    : meta.note || "Card fee";
  const state = failed ? (ev === "declined" ? "Declined" : "Failed") : pending ? "Processing" : ev === "refund" ? "Refunded" : "Successful";
  const stateHue = failed ? "#ef4444" : pending ? "#f59e0b" : "#22c55e";

  const rows: { label: string; value: string; mono?: boolean }[] = [
    { label: "Type", value: TYPE[ev] },
    ...(merchant && ev !== "created" && ev !== "toWallet" && ev !== "fee" && ev !== "topup" ? [{ label: ev === "refund" ? "From" : "Merchant", value: merchant }] : []),
    ...(meta.place ? [{ label: "Location", value: String(meta.place) }] : []),
    ...(ev === "declined" && meta.note ? [{ label: "Reason", value: String(meta.note) }] : []),
    ...(ev === "declined" ? [{ label: "Charged", value: "Nothing, the payment didn't go through" }] : []),
    ...(ev === "created" ? [{ label: "Card creation fee", value: amount > 0 ? usd(amount) : "None", mono: true }] : []),
    ...(ev === "fee" ? [{ label: "Fee", value: usd(amount), mono: true }] : []),
    ...(ev === "toWallet" ? [{ label: "Sent to", value: "Your wallet, as USDC on Solana" }] : []),
    ...(ev === "topup" ? [{ label: "From", value: "Your wallet" }] : []),
    ...(ev === "topup" && meta.note ? [{ label: "Breakdown", value: String(meta.note) }] : []),
    { label: "Card", value: last4 ? `${cardName}  ••••  ${last4}` : cardName },
    { label: "Currency", value: "USD" },
    { label: "Date", value: when },
  ];
  const ref = refOf(tx.reference);
  const shortRef = ref.length > 22 ? `${ref.slice(0, 10)}…${ref.slice(-8)}` : ref;

  const cardW = Math.min(width - 40, 340);

  return (
    <View style={s.wrap}>
      <CardFace
        width={cardW}
        name={cardName}
        last4={last4}
        holder={holder}
        oneTime={card?.kind === "one-time"}
        frozen={card?.status === "blocked"}
      />

      <View style={s.head}>
        <Text style={[s.headline, { color: colors.mutedForeground }]} numberOfLines={2}>
          {headline}
        </Text>
        <Text style={[s.amount, { color: colors.foreground }, failed && s.struck]}>
          {sign}
          {usd(amount)}
        </Text>
        <View style={[s.state, { backgroundColor: stateHue + "1F" }]}>
          <View style={[s.dot, { backgroundColor: stateHue }]} />
          <Text style={[s.stateText, { color: stateHue }]}>{state}</Text>
        </View>
      </View>

      <View style={[s.sheet, { backgroundColor: colors.card }]}>
        {rows.map((r, i) => (
          <View key={r.label} style={[s.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
            <Text style={[s.label, { color: colors.mutedForeground }]}>{r.label}</Text>
            <Text style={[s.value, { color: colors.foreground }, r.mono && s.mono]} numberOfLines={2}>
              {r.value}
            </Text>
          </View>
        ))}
      </View>

      {!!ref && (
        <TouchableOpacity
          style={[s.refBox, { borderColor: colors.border }]}
          activeOpacity={0.7}
          onPress={() => {
            Clipboard.setString(ref);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.refLabel, { color: colors.mutedForeground }]}>REFERENCE</Text>
            <Text style={[s.refValue, { color: colors.foreground }]} numberOfLines={1}>
              {shortRef}
            </Text>
          </View>
          <View style={s.copy}>
            <Feather name={copied ? "check" : "copy"} size={14} color={copied ? "#22c55e" : colors.mutedForeground} />
            <Text style={[s.copyText, { color: copied ? "#22c55e" : colors.mutedForeground }]}>{copied ? "Copied" : "Copy"}</Text>
          </View>
        </TouchableOpacity>
      )}

      <Text style={[s.foot, { color: colors.mutedForeground }]}>
        Quote this reference if you contact support about this transaction.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignSelf: "stretch", alignItems: "center", paddingTop: 4 },
  head: { alignItems: "center", marginTop: 22 },
  headline: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_500Medium", textAlign: "center", maxWidth: 300 },
  amount: { fontSize: 38, lineHeight: 46, fontFamily: "Inter_800ExtraBold", letterSpacing: -1.4, marginTop: 4, fontVariant: ["tabular-nums"] },
  struck: { textDecorationLine: "line-through", opacity: 0.55 },
  state: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, marginTop: 8 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  stateText: { fontSize: 12.5, fontFamily: "Inter_700Bold" },
  sheet: { alignSelf: "stretch", borderRadius: 18, paddingHorizontal: 16, paddingVertical: 4, marginTop: 22 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, paddingVertical: 13 },
  label: { fontSize: 13, fontFamily: "Inter_400Regular", flexShrink: 0 },
  value: { fontSize: 13.5, fontFamily: "Inter_600SemiBold", textAlign: "right", flexShrink: 1 },
  mono: { fontVariant: ["tabular-nums"] },
  refBox: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 14,
  },
  refLabel: { fontSize: 10.5, fontFamily: "Inter_600SemiBold", letterSpacing: 1.2 },
  refValue: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 3, letterSpacing: 0.4 },
  copy: { flexDirection: "row", alignItems: "center", gap: 5 },
  copyText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  foot: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 12, maxWidth: 300 },
});
