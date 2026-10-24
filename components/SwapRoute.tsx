import React from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { TokenLogo } from "@/components/TokenLogo";
import { CHAIN_MARKS } from "@/constants/transfer";

export const SWAP_CHAIN_LABEL: Record<string, string> = {
  MOVE: "Movement",
  SOL: "Solana",
  BASE: "Base",
  BEP20: "BNB Chain",
  ARC: "Arc",
  TON: "TON",
  STELLAR: "Stellar",
  MONAD: "Monad",
  ARB: "Arbitrum",
};

/**
 * A coin with the chain it sits on as a badge at its corner.
 *
 * `ring` is the colour behind it, so the badge's border cuts it cleanly out
 * of the coin rather than drawing a visible outline.
 */
export function CoinMark({ asset, chain, size, ring }: { asset: string; chain: string; size: number; ring: string }) {
  // Big enough to tell the chains apart at a glance, even on the small coin in the chip.
  const badge = Math.max(15, Math.round(size * 0.56));
  return (
    <View style={{ width: size, height: size }}>
      <TokenLogo symbol={asset} size={size} />
      {CHAIN_MARKS[chain] && (
        <Image
          source={CHAIN_MARKS[chain]}
          style={{
            position: "absolute",
            right: -4,
            bottom: -4,
            width: badge,
            height: badge,
            borderRadius: badge / 2,
            borderWidth: 2,
            borderColor: ring,
          }}
        />
      )}
    </View>
  );
}

type End = { asset: string; chain: string; symbol?: string; amount?: string };

/**
 * Where a swap went, drawn rather than listed: the coin it left as on its
 * chain, an arrow, the coin it arrived as on its chain. A USDC to USDC swap is
 * all about the chains, and two badges side by side say that faster than the
 * From and To rows underneath.
 */
export function SwapRoute({
  from,
  to,
  ink,
  muted,
  surface,
  line,
}: {
  from: End;
  to: End;
  ink: string;
  muted: string;
  /** What the route sits on. The badges ring themselves in it. */
  surface: string;
  /** The connector's colour. */
  line: string;
}) {
  const side = (e: End) => (
    <View style={s.end}>
      <CoinMark asset={e.asset} chain={e.chain} size={40} ring={surface} />
      <Text style={[s.amount, { color: ink }]} numberOfLines={1}>
        {e.amount ? `${e.amount} ` : ""}
        {e.symbol ?? e.asset}
      </Text>
      <Text style={[s.chain, { color: muted }]} numberOfLines={1}>
        {SWAP_CHAIN_LABEL[e.chain] ?? e.chain}
      </Text>
    </View>
  );

  return (
    <View style={[s.route, { backgroundColor: surface }]}>
      {side(from)}
      <View style={s.connector}>
        <View style={[s.rule, { backgroundColor: line }]} />
        <Feather name="arrow-right" size={16} color={muted} />
        <View style={[s.rule, { backgroundColor: line }]} />
      </View>
      {side(to)}
    </View>
  );
}

const s = StyleSheet.create({
  route: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 12,
  },
  end: { flex: 1, alignItems: "center", gap: 4 },
  amount: { marginTop: 8, fontSize: 15, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },
  chain: { fontSize: 13, fontFamily: "Inter_500Medium" },
  // Sits level with the coins rather than the middle of the whole column.
  connector: { width: 64, flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 44 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth * 2, borderRadius: 1 },
});
