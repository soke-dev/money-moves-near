import React from "react";
import Svg, { Circle, Path, Rect, G } from "react-native-svg";

/**
 * Illustrated icons for feature spots on the card screens: soft two-tone
 * fills in Money Moves colours, drawn on a 48 grid. Small UI glyphs (back,
 * chevrons, copy) stay as plain Ionicons; these are for the rows and choices
 * that explain what something is.
 */
const C = {
  lime: "#81FB02",
  limeDeep: "#4FA300",
  mint: "#D6FFA8",
  ink: "#151A10",
  slate: "#2C3326",
  ice: "#8FD0FF",
  iceDeep: "#3E9BE0",
  gold: "#E9C766",
  white: "#FFFFFF",
};

type P = { size?: number };
const S = ({ size = 40, children }: P & { children: React.ReactNode }) => (
  <Svg width={size} height={size} viewBox="0 0 48 48">
    {children}
  </Svg>
);

/** Top up from your wallet: a wallet with a coin going in. */
const Wallet = ({ size }: P) => (
  <S size={size}>
    <Circle cx={31} cy={11} r={7} fill={C.gold} />
    <Path d="M31 7.5 V14.5 M28.6 9.6 H32.4 a1.6 1.6 0 0 1 0 3.2 H29.6 a1.6 1.6 0 0 0 0 3.2 H33.4" stroke={C.ink} strokeWidth={1.4} strokeLinecap="round" fill="none" opacity={0.75} />
    <Rect x={5.5} y={16} width={37} height={26} rx={5.5} fill={C.lime} />
    <Rect x={5.5} y={16} width={37} height={6.5} rx={3.25} fill={C.limeDeep} opacity={0.45} />
    <Rect x={27.5} y={25} width={16} height={10.5} rx={3.5} fill={C.ink} />
    <Circle cx={33.2} cy={30.2} r={2.3} fill={C.lime} />
  </S>
);

/** Freeze: an ice disc with a snowflake. */
const Freeze = ({ size }: P) => (
  <S size={size}>
    <Circle cx={24} cy={24} r={18.5} fill={C.ice} />
    <Path d="M24 5.5 A18.5 18.5 0 0 1 24 42.5 Z" fill={C.iceDeep} opacity={0.35} />
    <G stroke={C.white} strokeWidth={2.8} strokeLinecap="round" fill="none">
      <Path d="M24 13 V35" />
      <Path d="M14.5 18.5 L33.5 29.5" />
      <Path d="M14.5 29.5 L33.5 18.5" />
      <Path d="M20.5 14.5 L24 18 L27.5 14.5" />
      <Path d="M20.5 33.5 L24 30 L27.5 33.5" />
    </G>
  </S>
);

/** One-time: a shield with a tick. */
const OneTime = ({ size }: P) => (
  <S size={size}>
    <Path d="M24 4.5 L40 10.2 V22.5 C40 32.3 33.3 39.5 24 44 C14.7 39.5 8 32.3 8 22.5 V10.2 Z" fill={C.lime} />
    <Path d="M24 4.5 V44 C14.7 39.5 8 32.3 8 22.5 V10.2 Z" fill={C.limeDeep} opacity={0.4} />
    <Path d="M16.5 24 L22 29.5 L32 18.5" stroke={C.ink} strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </S>
);

/** Everyday: two cards, one behind the other. */
const Everyday = ({ size }: P) => (
  <S size={size}>
    <Rect x={10} y={8} width={33} height={22} rx={4} fill={C.lime} transform="rotate(-8 26.5 19)" />
    <Rect x={5} y={17} width={36} height={24} rx={4.5} fill={C.ink} />
    <Rect x={5} y={22.5} width={36} height={4.5} fill={C.slate} />
    <Rect x={9.5} y={31} width={8.5} height={6} rx={1.5} fill={C.gold} />
    <Circle cx={30.5} cy={34} r={4} fill="#EB001B" />
    <Circle cx={35} cy={34} r={4} fill="#F79E1B" opacity={0.92} />
  </S>
);

/** A single card, for empty states and the intro. */
const Card = ({ size }: P) => (
  <S size={size}>
    <Rect x={4.5} y={11} width={39} height={27} rx={4.5} fill={C.ink} />
    <Rect x={4.5} y={17} width={39} height={5} fill={C.slate} />
    <Rect x={9.5} y={27} width={9} height={6.5} rx={1.6} fill={C.gold} />
    <Circle cx={32} cy={30.5} r={4.5} fill={C.lime} />
    <Circle cx={37} cy={30.5} r={4.5} fill={C.mint} opacity={0.9} />
  </S>
);

/** Locked: a padlock, for what isn't open yet. */
const Lock = ({ size }: P) => (
  <S size={size}>
    <Path d="M15.5 21 V15.5 a8.5 8.5 0 0 1 17 0 V21" stroke={C.slate} strokeWidth={4} fill="none" strokeLinecap="round" />
    <Rect x={9} y={20} width={30} height={23} rx={5} fill={C.lime} />
    <Rect x={9} y={20} width={30} height={5.5} rx={2.75} fill={C.limeDeep} opacity={0.45} />
    <Circle cx={24} cy={30.5} r={3.2} fill={C.ink} />
    <Rect x={22.6} y={31.5} width={2.8} height={6.5} rx={1.4} fill={C.ink} />
  </S>
);

const ART = { wallet: Wallet, freeze: Freeze, oneTime: OneTime, everyday: Everyday, card: Card, lock: Lock };
export type CardIlloName = keyof typeof ART;

export function CardIllo({ name, size = 40 }: { name: CardIlloName; size?: number }) {
  const Art = ART[name];
  return <Art size={size} />;
}
