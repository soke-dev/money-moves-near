/**
 * A generated avatar, for anyone without a photo.
 *
 * A grey disc with a letter in it says nothing and, when two people share an
 * initial, says the same nothing twice. This draws a symmetric pixel pattern
 * from the name itself - the identicon shape crypto wallets use - so everyone
 * without a photo still gets a face that is recognisably theirs, stable across
 * every screen and every device.
 *
 * Deterministic: the same name always produces the same pattern and colours.
 */
import React, { useMemo } from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Rect } from "react-native-svg";

/** Five columns, mirrored, so the grid is three columns of decisions. */
const GRID = 5;
const HALF = Math.ceil(GRID / 2);

/**
 * Pairs that hold up on a dark background: a lit colour over its own shadow.
 * Brand green leads, so the app's own colour turns up most often.
 */
const PAIRS: [string, string][] = [
  ["#81FB02", "#2C5A06"],
  ["#22D3EE", "#0E4A56"],
  ["#F59E0B", "#5A3A06"],
  ["#F472B6", "#5A2740"],
  ["#A78BFA", "#392A5E"],
  ["#38BDF8", "#0F3C5A"],
  ["#FB7185", "#5A1F28"],
  ["#34D399", "#0E4A36"],
];

/** djb2: small, fast, and spreads short strings well. */
function hash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

export function Identicon({ name, size }: { name: string; size: number }) {
  const { fg, bg, cells } = useMemo(() => {
    const seed = hash((name || "?").toLowerCase().trim());
    const [lit, shade] = PAIRS[seed % PAIRS.length];

    // One bit per cell in the left half, then mirrored.
    const on: boolean[][] = [];
    let bits = seed;
    for (let y = 0; y < GRID; y++) {
      const row: boolean[] = [];
      for (let x = 0; x < HALF; x++) {
        bits = (bits * 1103515245 + 12345) >>> 0;
        row[x] = ((bits >> 16) & 1) === 1;
      }
      for (let x = HALF; x < GRID; x++) row[x] = row[GRID - 1 - x];
      on.push(row);
    }

    return { fg: lit, bg: shade, cells: on };
  }, [name]);

  const unit = size / GRID;

  return (
    <View
      style={[
        styles.wrap,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
      ]}
    >
      <Svg width={size} height={size}>
        {cells.map((row, y) =>
          row.map((filled, x) =>
            filled ? (
              <Rect
                key={`${x}-${y}`}
                x={x * unit}
                y={y * unit}
                width={unit}
                height={unit}
                fill={fg}
                // Softened corners, so the pattern reads as a mark rather than
                // a screenshot of a spreadsheet.
                rx={unit * 0.22}
              />
            ) : null,
          ),
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden", alignItems: "center", justifyContent: "center" },
});
