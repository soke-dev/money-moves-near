/** Pure arithmetic only. No database, no network, no provider. */
import { cutPot, parseSlices, describe, toAmount, SCALE } from "../lib/voucher-split";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, note = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${note ? "  — " + note : ""}`); }
}

console.log("sums are exact, every time");
for (const [pot, winners] of [[20, 20], [2, 20], [100, 7], [5.5, 3], [1, 1], [250, 500]] as [number, number][]) {
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const { slices } = cutPot({ pot, winners });
    const sum = slices.reduce((a, b) => a + b, 0);
    worst = Math.max(worst, Math.abs(sum - Math.round(pot * SCALE)));
  }
  ok(`${pot} across ${winners}`, worst === 0, worst === 0 ? "200 cuts, exact" : `off by ${worst} units`);
}

console.log("\nthe floor holds");
{
  let below = 0;
  for (let i = 0; i < 300; i++) {
    const { slices } = cutPot({ pot: 20, winners: 20, min: 0.25 });
    if (slices.some((s) => s < 25)) below++;
  }
  ok("nobody under the minimum", below === 0, `${below} breaches in 300 cuts`);
}

console.log("\nthe cap holds");
{
  let over = 0;
  for (let i = 0; i < 300; i++) {
    const { slices } = cutPot({ pot: 20, winners: 20, max: 3, spread: "wild" });
    if (slices.some((s) => s > 300)) over++;
  }
  ok("nobody over the maximum", over === 0, `${over} breaches in 300 cuts`);
}

console.log("\nspread actually spreads");
for (const spread of ["even", "mixed", "wild"] as const) {
  const runs = Array.from({ length: 60 }, () => describe(cutPot({ pot: 20, winners: 20, spread }).slices));
  const avgTop = runs.reduce((a, r) => a + r.max, 0) / runs.length;
  const avgLow = runs.reduce((a, r) => a + r.min, 0) / runs.length;
  console.log(`  ${spread.padEnd(6)} low ~${avgLow.toFixed(2)}  top ~${avgTop.toFixed(2)}  (average 1.00)`);
}
{
  const top = (s: "even" | "wild") =>
    Array.from({ length: 60 }, () => describe(cutPot({ pot: 20, winners: 20, spread: s }).slices).max)
      .reduce((a, b) => a + b, 0) / 60;
  const e = top("even"), w = top("wild");
  ok("wild beats even at the top", w > e * 1.5, `even ${e.toFixed(2)} vs wild ${w.toFixed(2)}`);
}

console.log("\nposition means nothing");
{
  // If order carried information the first slot would win more than its share.
  const winsBySlot = new Array(10).fill(0);
  for (let i = 0; i < 4000; i++) {
    const { slices } = cutPot({ pot: 10, winners: 10, spread: "wild" });
    winsBySlot[slices.indexOf(Math.max(...slices))]++;
  }
  const expected = 400;
  const drift = Math.max(...winsBySlot.map((n) => Math.abs(n - expected))) / expected;
  ok("the jackpot lands anywhere", drift < 0.25, `worst slot off by ${(drift * 100).toFixed(0)}%`);
}

console.log("\nrefusals");
const refuses = (name: string, fn: () => unknown) => {
  try { fn(); ok(name, false, "did not refuse"); }
  catch (e: any) { ok(name, true, e.message); }
};
refuses("a pot too small for the floor", () => cutPot({ pot: 1, winners: 20, min: 0.5 }));
refuses("a cap too low for the pot", () => cutPot({ pot: 20, winners: 4, max: 1 }));
refuses("no winners", () => cutPot({ pot: 20, winners: 0 }));
refuses("an empty pot", () => cutPot({ pot: 0, winners: 5 }));

console.log("\ntyped amounts");
ok("a list that adds up is taken", parseSlices("0.5, 1, 2, 6.5", 10).length === 4);
ok("newlines and spaces work", parseSlices("0.5\n1\n2 6.5", 10).length === 4);
refuses("a list that does not add up", () => parseSlices("1, 2, 3", 10));
refuses("a word in the list", () => parseSlices("1, two, 3", 6));
refuses("a negative", () => parseSlices("-1, 11", 10));

console.log("\na 20-for-20, as it would really look");
const real = cutPot({ pot: 20, winners: 20, spread: "mixed" });
const shown = [...real.slices].sort((a, b) => b - a).map((u) => toAmount(u).toFixed(2));
console.log("  " + shown.join("  "));
console.log("  " + JSON.stringify(describe(real.slices)));
if (real.warning) console.log("  warning: " + real.warning);

console.log("\na 2-for-20, where it gets tight");
const tight = cutPot({ pot: 2, winners: 20 });
console.log("  " + [...tight.slices].sort((a, b) => b - a).map((u) => toAmount(u).toFixed(2)).join("  "));
if (tight.warning) console.log("  warning: " + tight.warning);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
