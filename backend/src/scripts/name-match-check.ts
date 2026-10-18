/**
 * The sender-name rule, run over the shapes real Nigerian bank names take.
 *
 * There is no test runner in this project, so this is one: it exits non-zero if
 * any case fails. The cases are the point - they are the specification, and
 * changing the matcher without changing them here means the rule moved.
 *
 *   npx tsx src/scripts/name-match-check.ts
 */
import { checkSenderName, nameTokens, type NameVerdict } from "../lib/name-match";

type Case = {
  what: string;
  sender: string | null;
  first: string | null;
  last: string | null;
  want: NameVerdict;
};

const CASES: Case[] = [
  // ── The real one. The bank printed surname first; the ID has it last. ──
  { what: "reversed order, the first deposit we ever took",
    sender: "COLLINS OKOTETE", first: "Collins", last: "Okotete", want: "MATCH" },
  { what: "same name, same order",
    sender: "OKOTETE COLLINS", first: "Okotete", last: "Collins", want: "MATCH" },

  // ── Middle names: the bank's and the ID's disagree, which is normal ──
  { what: "bank adds a middle name the ID lacks",
    sender: "COLLINS JOHN OKOTETE", first: "Collins", last: "Okotete", want: "MATCH" },
  { what: "ID has a middle name the bank drops",
    sender: "COLLINS OKOTETE", first: "Collins John", last: "Okotete", want: "MATCH" },

  // ── Initials ──
  { what: "bank prints an initial",
    sender: "C OKOTETE", first: "Collins", last: "Okotete", want: "MATCH" },
  { what: "bank prints initials for both",
    sender: "C O", first: "Collins", last: "Okotete", want: "MATCH" },

  // ── Decoration ──
  { what: "title on the account",
    sender: "MR COLLINS OKOTETE", first: "Collins", last: "Okotete", want: "MATCH" },
  { what: "chief and a suffix",
    sender: "CHIEF COLLINS OKOTETE JNR", first: "Collins", last: "Okotete", want: "MATCH" },
  { what: "lowercase and extra spacing",
    sender: "  collins   okotete ", first: "Collins", last: "Okotete", want: "MATCH" },
  { what: "hyphenated surname against an unhyphenated bank",
    sender: "GRACE OKON BASSEY", first: "Grace", last: "Okon-Bassey", want: "MATCH" },

  // ── The ones that must be caught ──
  { what: "someone else entirely",
    sender: "MUSA IBRAHIM", first: "Collins", last: "Okotete", want: "MISMATCH" },
  // One name is enough by policy, so these two pass. A relative sharing the
  // surname is the accepted cost of not holding honest deposits whose bank
  // prints two of four names.
  { what: "same surname, a relative - passes by policy",
    sender: "BLESSING OKOTETE", first: "Collins", last: "Okotete", want: "MATCH" },
  { what: "same given name, different surname - passes by policy",
    sender: "COLLINS ADEYEMI", first: "Collins", last: "Okotete", want: "MATCH" },
  { what: "a business account",
    sender: "MOVERS DIGITAL TECHNOLOGIES LTD", first: "Collins", last: "Okotete", want: "MISMATCH" },

  // ── Absences ──
  { what: "rail sent no sender name",
    sender: null, first: "Collins", last: "Okotete", want: "MISSING" },
  { what: "rail sent an empty string",
    sender: "   ", first: "Collins", last: "Okotete", want: "MISSING" },
  { what: "no verified name on file",
    sender: "COLLINS OKOTETE", first: null, last: null, want: "NO_REFERENCE" },

  // ── Only one of the two fields on the ID ──
  { what: "only a surname on file, bank agrees",
    sender: "COLLINS OKOTETE", first: null, last: "Okotete Collins", want: "MATCH" },
  { what: "only a given name on file, and it lands",
    sender: "COLLINS ADEYEMI", first: "Collins", last: null, want: "MATCH" },
  { what: "two tokens in one field, sender disagrees",
    sender: "MUSA IBRAHIM", first: null, last: "Okotete Collins", want: "MISMATCH" },
];

let failed = 0;
console.log("tokeniser:");
for (const s of ["MR COLLINS OKOTETE JNR", "Okon-Bassey, Grace", "  collins   okotete "]) {
  console.log(`  ${JSON.stringify(s).padEnd(30)} -> [${nameTokens(s).join(", ")}]`);
}

console.log("\ncases:");
for (const c of CASES) {
  const got = checkSenderName({ senderName: c.sender, first: c.first, last: c.last }).verdict;
  const ok = got === c.want;
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${c.what.padEnd(46)} want ${c.want.padEnd(13)} got ${got}`);
}

console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
if (failed) process.exit(1);
