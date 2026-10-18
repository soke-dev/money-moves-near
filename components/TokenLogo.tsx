import React from "react";
import { Image, StyleSheet, View } from "react-native";
import { useTheme } from "@/context/ThemeContext";

const CNGN_LOGO = require("@/assets/images/cngnmain.png");
const MOVE_LOGO = require("@/assets/images/movementnew.jpg");
const USDC_LOGO = require("@/assets/images/usdc-logo.png");
const USDT_LOGO = require("@/assets/images/usdt.png");
const ETH_LOGO = require("@/assets/images/eth.png");
const ARB_LOGO = require("@/assets/images/arbitrumlogo.png");
const SOL_LOGO = require("@/assets/images/solanatoken.png");
// The converted deposits are the only place these appear, and they appear in
// colour there - a Bitcoin row drawn as a grey silhouette reads as disabled,
// which is exactly what those rows used to be.
const BTC_LOGO = require("@/assets/images/BTC.png");
const TRX_LOGO = require("@/assets/images/trx.png");
const BNB_LOGO = require("@/assets/images/bsc logo.png");

/**
 * The symbol on its own, for rows that should read as one object rather than
 * as a brand badge. Only these have one; anything else falls back to its
 * colour logo.
 *
 * Each file is the glyph cut out of the brand art - the disc it was drawn on
 * removed - as white on transparency. Being one shape and nothing else, it
 * takes a colour cleanly, which the finished icons could not: those are a disc
 * and a symbol in one file, so tinting one painted the whole thing.
 *
 * MARK_SCALE is how much of the icon slot the symbol covers. The slot is
 * shared with the colour logos, which are circles filling it edge to edge; a
 * bare symbol drawn to that same edge reads considerably larger than one of
 * those, so it is inset to land at the same weight.
 */
const MARK_SCALE = 0.66;

const MARK_MAP: Record<string, any> = {
  USDC: require("@/assets/images/usdc-mark.png"),
  USDCx: require("@/assets/images/usdc-mark.png"),
  USDCe: require("@/assets/images/usdc-mark.png"),
  USDT: require("@/assets/images/tether-mark.png"),
  MOVE: require("@/assets/images/move-mark.png"),
  SOL: require("@/assets/images/sol-mark.png"),
  // A silhouette, so it takes whichever colour it is given - black on the
  // light theme, white on the dark. Filed as a colour logo it rendered as
  // supplied, which is black, and disappeared against a dark screen.
  cNGN: require("@/assets/images/CNGN.png"),
  // Not tradeable yet; here so the row is already right when they are.
  BTC: require("@/assets/images/btc-mark.png"),
  TRX: require("@/assets/images/trx-mark.png"),
};

interface TokenLogoProps {
  symbol: "MOVE" | "USDC" | "USDT" | "USDCx" | "ETH" | "ARB" | "SOL" | string;
  size?: number;
  /** Prefer the monochrome mark where one exists. */
  dark?: boolean;
}

const LOGO_MAP: Record<string, any> = {
  MOVE: MOVE_LOGO,
  cNGN: CNGN_LOGO,
  USDC: USDC_LOGO,
  USDT: USDT_LOGO,
  // USDCx is a 1:1 USDC variant on Movement — reuses the USDC logo for now.
  USDCx: USDC_LOGO,
  // USDCe is the legacy bridged USDC.e on Movement — same USDC logo.
  USDCe: USDC_LOGO,
  ETH: ETH_LOGO,
  ARB: ARB_LOGO,
  SOL: SOL_LOGO,
  BTC: BTC_LOGO,
  TRX: TRX_LOGO,
  BNB: BNB_LOGO,
};

export function TokenLogo({ symbol, size = 36, dark = false }: TokenLogoProps) {
  const { isDark } = useTheme();
  const mono = dark ? MARK_MAP[symbol] : undefined;

  /**
   * No disc: the mark sits straight on the page, drawn in the text colour. A
   * list of twenty rows with a filled circle on each reads as twenty
   * highlights; the bare symbol says what the row is and leaves the colour on
   * the amount to mean something.
   *
   * White in the dark, and the reverse in the light - the same white file
   * either way, since a silhouette takes whichever colour it is given.
   *
   * The slot keeps the full size even though the symbol is inset, so a list
   * mixing marks and colour logos still lines up down the page.
   */
  if (mono) {
    return (
      <View style={[styles.slot, { width: size, height: size }]}>
        <Image
          source={mono}
          style={{
            width: size * MARK_SCALE,
            height: size * MARK_SCALE,
            tintColor: isDark ? "#FFFFFF" : "#000000",
          }}
          resizeMode="contain"
        />
      </View>
    );
  }

  /**
   * A token with no colour logo falls back to its own mark, never to USDC's.
   *
   * This read `LOGO_MAP[symbol] || USDC_LOGO`, so anything missing from the
   * map was drawn as USD Coin - cNGN shipped with a mark but no logo and
   * appeared on the withdrawal list as a blue USDC coin with a dollar sign on
   * it. Wearing another token's badge is worse than wearing none, on a screen
   * where the badge is how you pick which money to move.
   */
  const colour = LOGO_MAP[symbol];
  if (!colour && MARK_MAP[symbol]) {
    return (
      <View style={[styles.slot, { width: size, height: size }]}>
        <Image
          source={MARK_MAP[symbol]}
          style={{
            width: size * MARK_SCALE,
            height: size * MARK_SCALE,
            tintColor: isDark ? "#FFFFFF" : "#000000",
          }}
          resizeMode="contain"
        />
      </View>
    );
  }

  return (
    <Image
      source={colour || USDC_LOGO}
      style={[styles.logo, { width: size, height: size, borderRadius: size / 2 }]}
      resizeMode="cover"
    />
  );
}

const styles = StyleSheet.create({
  logo: {
    overflow: "hidden",
  },
  slot: { alignItems: "center", justifyContent: "center" },
});
