import React from "react";
import { Image, StyleSheet } from "react-native";

/**
 * The tick a finished transaction ends on.
 *
 * It was a Feather glyph inside a disc painted in the brand colour, redrawn
 * from scratch on eight screens at four different sizes - which is how buy,
 * sell, bank, withdraw, username, airtime, electricity and TV ended up with
 * marks that were nearly but not quite the same object. The artwork is one
 * file now, and the eight call sites say how big rather than how to draw it.
 *
 * The art brings its own disc, so it replaces the disc as well as the glyph.
 * Nothing tints it: it is two greens and a white, and a tintColor would flatten
 * all three into one.
 */
export const SUCCESS_GREEN = "#32BA7C";

/** The halo behind the mark. Its own green, so the two agree. */
export const SUCCESS_HALO = SUCCESS_GREEN + "1A";

/** The same, as a ring - for the screens that draw a border rather than a fill. */
export const SUCCESS_RING = SUCCESS_GREEN + "44";

export function SuccessMark({ size }: { size: number }) {
  return (
    <Image
      source={require("@/assets/images/checked.png")}
      style={[s.mark, { width: size, height: size }]}
    />
  );
}

const s = StyleSheet.create({
  mark: { resizeMode: "contain" },
});
