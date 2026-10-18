import React, { forwardRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import QRCode from "react-native-qrcode-svg";

/**
 * The picture somebody actually sends.
 *
 * Sharing used to be a line of text with a code in it, which asks whoever
 * receives it to trust an unexplained string and type it correctly. A card
 * carries the code, the scannable version of it and what it is worth, so the
 * message explains itself in a group chat where nobody has the app open.
 *
 * Fixed size and its own colours rather than the theme's. This is captured to
 * a PNG and sent somewhere we do not control, so it has to read the same
 * whatever the sender's phone is set to and whatever background it lands on -
 * a card that inverts with dark mode would arrive as white text on white.
 *
 * Text and vector only, deliberately: an <Image> that has not finished
 * loading captures as a blank rectangle, and the capture cannot wait for
 * something it does not know about.
 */

const INK = "#0A0C08";
const LIME = "#81FB02";
const DIM = "rgba(10,12,8,0.62)";

export type VoucherCard = {
  code: string;
  /** What the QR carries - prefixed, so a scanner knows it is not a username. */
  qrValue: string;
  amount: number;
  people: number;
  endsAt?: string | null;
};

export const VoucherShareCard = forwardRef<View, { voucher: VoucherCard }>(
  ({ voucher }, ref) => {
    const ends = voucher.endsAt
      ? new Date(voucher.endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
      : null;

    return (
      <View ref={ref} collapsable={false} style={s.card}>
        <Text style={s.brand}>MONEY MOVES</Text>

        <Text style={s.lede}>
          {voucher.amount.toFixed(2)} USDC{"\n"}
          <Text style={s.ledeDim}>
            for the first {voucher.people} {voucher.people === 1 ? "person" : "people"}
          </Text>
        </Text>

        <View style={s.qrBox}>
          <QRCode value={voucher.qrValue} size={168} backgroundColor="#fff" color={INK} />
        </View>

        <Text style={s.codeCap}>OR TYPE THIS CODE</Text>
        <Text style={s.code}>{voucher.code}</Text>

        <View style={s.rule} />
        <Text style={s.foot}>
          Scan it in the Money Moves app{ends ? ` · expires ${ends}` : ""}
        </Text>
      </View>
    );
  },
);

VoucherShareCard.displayName = "VoucherShareCard";

const s = StyleSheet.create({
  // Portrait, near the proportions a chat thumbnail is cropped to, so nothing
  // important sits where the preview cuts.
  card: {
    width: 320,
    paddingHorizontal: 26,
    paddingTop: 26,
    paddingBottom: 22,
    borderRadius: 28,
    backgroundColor: LIME,
    alignItems: "center",
  },
  brand: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 2.4,
    color: DIM,
  },
  lede: {
    marginTop: 14,
    fontSize: 26,
    lineHeight: 31,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.8,
    color: INK,
    textAlign: "center",
  },
  ledeDim: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_500Medium", color: DIM },
  qrBox: {
    marginTop: 20,
    padding: 14,
    borderRadius: 20,
    backgroundColor: "#fff",
  },
  codeCap: {
    marginTop: 18,
    fontSize: 9.5,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.6,
    color: DIM,
  },
  code: {
    marginTop: 5,
    fontSize: 21,
    lineHeight: 26,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.4,
    color: INK,
    textAlign: "center",
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    backgroundColor: "rgba(10,12,8,0.18)",
    marginTop: 18,
    marginBottom: 12,
  },
  foot: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "Inter_500Medium",
    color: DIM,
    textAlign: "center",
  },
});
