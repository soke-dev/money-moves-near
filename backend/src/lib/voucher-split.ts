import { randomInt, randomBytes } from "crypto";

/**
 * Cutting a pot into unequal slices.
 *
 * A lucky voucher hands out one pot as N different amounts: most people get
 * something ordinary, one or two get a windfall. The whole appeal is that the
 * amounts differ and that you cannot tell in advance which one you will get.
 *
 * Everything here is pure arithmetic on integer minor units, and none of it
 * touches the database. The slices are cut ONCE, when the voucher is created,
 * and stored - so the total is exact before anybody claims, the float reserve
 * is a known number rather than an estimate, and two people claiming at the
 * same moment are handed two different rows rather than racing to divide the
 * same remainder.
 */

/** Slices are cut and stored to two decimals: 0.15 reads as luck, 0.152847 reads as a bug. */
export const SCALE = 100;

export type Spread = "even" | "mixed" | "wild";

/**
 * How heavy the tail is.
 *
 * Weights are drawn as (-ln u)^k. k below 1 pulls everything towards the
 * average; k above 1 stretches the top away from it. An even split is not a
 * flat one - it still varies, or the voucher is just a fixed reward wearing a
 * different name.
 */
const TAIL: Record<Spread, number> = { even: 0.45, mixed: 1.15, wild: 2.4 };

export interface CutRequest {
  /** The whole pot, in whole currency units (20 means 20 USDC). */
  pot: number;
  /** How many slices to cut. */
  winners: number;
  /** Nobody gets less than this. Defaults to a tenth of the average, floored at 0.01. */
  min?: number;
  /** Nobody gets more than this. Optional - unset means the tail runs free. */
  max?: number;
  spread?: Spread;
}

/** A uniform in (0,1), from the same source we trust with keys. */
function unitRandom(): number {
  // 6 bytes is 48 bits of entropy, comfortably inside a double's 53-bit mantissa.
  const n = randomBytes(6).readUIntBE(0, 6);
  // Never exactly 0, because ln(0) is not a number we can divide a pot by.
  return (n + 1) / (0x1000000000000 + 1);
}

/** Fisher-Yates, so the order the slices are handed out in carries nothing. */
export function shuffle<T>(xs: T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Cut a pot into `winners` slices, in minor units, summing EXACTLY to the pot.
 *
 * Works in integers throughout. Floating point cannot be trusted to make
 * twenty numbers add up to another number, and "adds up exactly" is the one
 * promise this has to keep - the pot is what the treasury has set aside, and a
 * rounding drift either strands money or overspends the float.
 */
export function cutPot(req: CutRequest): { slices: number[]; warning: string | null } {
  const winners = Math.floor(req.winners);
  const potUnits = Math.round(req.pot * SCALE);

  if (!Number.isFinite(potUnits) || potUnits <= 0) throw new Error("A pot has to be more than nothing.");
  if (!Number.isFinite(winners) || winners < 1) throw new Error("A lucky voucher needs at least one winner.");
  if (winners > 5000) throw new Error("Five thousand winners at most.");

  const avg = potUnits / winners;
  const minUnits = Math.max(1, Math.round((req.min ?? Math.max(0.01, req.pot / winners / 10)) * SCALE));

  if (minUnits * winners > potUnits) {
    throw new Error(
      `${req.pot} split ${winners} ways cannot give everybody at least ${(minUnits / SCALE).toFixed(2)}.`,
    );
  }

  // Everybody starts on the floor; only what is left over is what luck decides.
  const spare = potUnits - minUnits * winners;
  const maxUnits = req.max ? Math.round(req.max * SCALE) : Infinity;
  if (maxUnits < minUnits) throw new Error("The most somebody can win cannot be less than the least.");
  if (maxUnits * winners < potUnits) {
    throw new Error(`Capped at ${req.max}, ${winners} winners cannot take a pot of ${req.pot}.`);
  }

  const k = TAIL[req.spread ?? "mixed"];
  const weights = Array.from({ length: winners }, () => Math.pow(-Math.log(unitRandom()), k));
  const total = weights.reduce((a, b) => a + b, 0) || 1;

  const slices = weights.map((w) => minUnits + Math.floor((spare * w) / total));

  /**
   * The remainder, one unit at a time.
   *
   * Flooring every slice leaves a few units unspent. Handing them all to one
   * slice would quietly make that slice the winner every single time, which is
   * exactly the bias this whole file exists to avoid - so they go to slices
   * picked at random, and only to slices still under the cap.
   */
  let left = potUnits - slices.reduce((a, b) => a + b, 0);
  let guard = left * 4 + winners * 4;
  while (left > 0 && guard-- > 0) {
    const i = randomInt(winners);
    if (slices[i] < maxUnits) {
      slices[i]++;
      left--;
    }
  }

  // Trim anything over the cap and give it to whoever is furthest below it.
  if (Number.isFinite(maxUnits)) {
    let overflow = 0;
    for (let i = 0; i < winners; i++) {
      if (slices[i] > maxUnits) {
        overflow += slices[i] - maxUnits;
        slices[i] = maxUnits;
      }
    }
    let spin = overflow * 4 + winners * 4;
    while (overflow > 0 && spin-- > 0) {
      const i = randomInt(winners);
      if (slices[i] < maxUnits) {
        slices[i]++;
        overflow--;
      }
    }
    if (overflow > 0) throw new Error("Those limits cannot hold this pot.");
  }

  const sum = slices.reduce((a, b) => a + b, 0);
  if (sum !== potUnits) {
    // Never expected. Better a refusal at creation than a voucher whose slices
    // do not add up to the money set aside for it.
    throw new Error(`Could not cut that pot exactly (${sum} vs ${potUnits}). Try again.`);
  }

  /**
   * Distinct where the pot allows it, and honest where it does not.
   *
   * Twenty different amounts need at least 0+1+2+…+19 units of room above the
   * floor. A tight pot simply has not got it, and forcing the issue would mean
   * refusing perfectly reasonable vouchers - so repeats are allowed and the
   * admin is told, rather than the promise being quietly broken.
   */
  const distinct = new Set(slices).size;
  const room = spare >= (winners * (winners - 1)) / 2;
  const warning =
    distinct < winners && !room
      ? `This pot is too small for ${winners} different amounts, so some winners get the same. A bigger pot or fewer winners would spread it out.`
      : null;

  return { slices: shuffle(slices), warning };
}

/**
 * Amounts typed by hand, checked against the pot.
 *
 * Accepts them separated by commas, spaces or newlines, because somebody
 * pasting a column out of a spreadsheet should not have to reformat it.
 */
export function parseSlices(input: string, pot: number): number[] {
  const parts = String(input ?? "")
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (!parts.length) throw new Error("Type at least one amount.");
  if (parts.length > 5000) throw new Error("Five thousand amounts at most.");

  const units = parts.map((t) => {
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`"${t}" is not an amount.`);
    const u = Math.round(n * SCALE);
    if (u < 1) throw new Error(`${t} is smaller than the smallest amount we can send.`);
    return u;
  });

  const sum = units.reduce((a, b) => a + b, 0);
  const potUnits = Math.round(pot * SCALE);
  if (sum !== potUnits) {
    const off = (sum - potUnits) / SCALE;
    throw new Error(
      `These add up to ${(sum / SCALE).toFixed(2)}, not ${pot.toFixed(2)} — ` +
        `${off > 0 ? "over" : "under"} by ${Math.abs(off).toFixed(2)}.`,
    );
  }

  // Shuffled like the generated ones: a typed list is usually written in order,
  // and handing it out in that order would make the first claimer the winner.
  return shuffle(units);
}

/** Minor units back to a number of whole units, for storing and showing. */
export function toAmount(units: number): number {
  return units / SCALE;
}

/** What the spread looks like, for the admin to see before committing to it. */
export function describe(slices: number[]): {
  count: number;
  total: number;
  min: number;
  max: number;
  average: number;
  distinct: number;
} {
  const sorted = [...slices].sort((a, b) => a - b);
  const total = slices.reduce((a, b) => a + b, 0);
  return {
    count: slices.length,
    total: toAmount(total),
    min: toAmount(sorted[0] ?? 0),
    max: toAmount(sorted[sorted.length - 1] ?? 0),
    average: toAmount(Math.round(total / Math.max(slices.length, 1))),
    distinct: new Set(slices).size,
  };
}
