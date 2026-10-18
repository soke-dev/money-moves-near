import { NIGERIAN_BANKS } from "@/constants/transfer";
import { scanAccountFromImage } from "@/services/ocr";

export interface ReadAccount {
  accountNumber: string | null;
  bankName: string | null;
  /** Which reader produced this, for the log when one of them misbehaves. */
  via: "device" | "server";
}

/**
 * The on-device recogniser, if this build has one.
 *
 * Loaded through require rather than import so a build without the native
 * module - Expo Go, or any client compiled before it was added - keeps working
 * on the server reader instead of failing to start.
 */
function nativeRecognizer(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("@react-native-ml-kit/text-recognition");
    return mod?.default ?? mod ?? null;
  } catch {
    return null;
  }
}

export const hasDeviceReader = () => nativeRecognizer() != null;

/**
 * Nigerian account numbers are ten digits.
 *
 * Two passes, and the order matters. First an unbroken run of exactly ten,
 * which is how they are printed almost everywhere. Only then line by line,
 * for the ones written in groups ("8165 468975").
 *
 * Matching across whitespace globally was the bug: a pattern that let spaces
 * sit inside a candidate would swallow "5,000  0123456789" whole, reject the
 * thirteen digits it had assembled, and never try the real number inside it.
 * That is rare on a tight camera shot and common on a screenshot, which is why
 * the camera looked fine while the gallery fell through to the server.
 *
 * Longer runs are rejected rather than trimmed - a 14-digit string is a card
 * or a phone number, and taking ten of its digits would invent an account that
 * may well belong to someone.
 */
/**
 * Letters an OCR reader hands back where a digit was printed.
 *
 * Real example from a clean photo: "81654G8975" - the 6 came back as a G. The
 * shapes genuinely are ambiguous out of context, and a reader looking at ten
 * characters has no way to know it is reading a number.
 */
const LOOKALIKE: Record<string, string> = {
  O: "0", o: "0", D: "0", Q: "0",
  I: "1", i: "1", l: "1", "|": "1",
  Z: "2", z: "2",
  E: "3",
  A: "4",
  S: "5", s: "5",
  G: "6", b: "6",
  T: "7",
  B: "8",
  g: "9", q: "9",
};

/**
 * Read one token as an account number, forgiving lookalike letters.
 *
 * Most of it still has to be genuinely numeric - otherwise a ten-letter word
 * could be "corrected" into a valid-looking account. The remainder is a guess,
 * which is exactly why a reading is offered as a chip to confirm and the name
 * is resolved from the bank afterwards: a wrong correction shows up as the
 * wrong person's name before any money moves.
 */
function digitsFromToken(token: string): string | null {
  const cleaned = token.replace(/[ -]/g, "");
  if (cleaned.length !== 10) return null;

  let digits = "";
  let genuine = 0;
  for (const ch of cleaned) {
    if (ch >= "0" && ch <= "9") {
      digits += ch;
      genuine += 1;
    } else if (LOOKALIKE[ch]) {
      digits += LOOKALIKE[ch];
    } else {
      return null;
    }
  }
  return genuine >= 7 ? digits : null;
}

function findAccountNumber(text: string): string | null {
  if (__DEV__) console.log("[READER] text:", JSON.stringify(text));

  // Maximal runs of digits. No lookbehind: Hermes's support for it is
  // inconsistent, and a run's own length already rules out the neighbours a
  // lookaround was there to exclude.
  for (const run of text.match(/[0-9]+/g) || []) {
    if (run.length === 10) return run;
  }

  // Then groups written apart ("8165 468975"). Only groups separated by a
  // single space or dash are joined, so a number never merges with a time or
  // an amount elsewhere on the line - which is what stripping every non-digit
  // from the whole line used to do.
  for (const line of text.split(/[\r\n]+/)) {
    for (const group of line.match(/[0-9]+(?:[ -][0-9]+)*/g) || []) {
      const digits = group.replace(/[^0-9]/g, "");
      if (digits.length === 10) return digits;
    }
  }

  // Last, allowing for misread characters. Tried only after the clean passes,
  // so a correctly read number is never second-guessed.
  for (const token of text.split(/[\s,;:]+/)) {
    const digits = digitsFromToken(token);
    if (digits) return digits;
  }
  return null;
}

/**
 * Match a bank by name, then by the short forms people actually write.
 *
 * "GTB" and "First Bank" never appear verbatim in the official list, and they
 * are what a screenshot says.
 */
const ALIASES: Record<string, string> = {
  gtb: "Guaranty Trust Bank",
  gtbank: "Guaranty Trust Bank",
  "first bank": "First Bank of Nigeria",
  firstbank: "First Bank of Nigeria",
  uba: "United Bank for Africa",
  fcmb: "First City Monument Bank",
  zenith: "Zenith Bank",
  access: "Access Bank",
  opay: "Opay",
  palmpay: "Palmpay",
  kuda: "Kuda Bank",
  moniepoint: "Moniepoint",
  sterling: "Sterling Bank",
  fidelity: "Fidelity Bank",
  union: "Union Bank",
  wema: "Wema Bank",
  polaris: "Polaris Bank",
  stanbic: "Stanbic IBTC Bank",
  ecobank: "Ecobank",
};

function findBank(text: string): string | null {
  const hay = text.toLowerCase();

  // Longest first, so "First Bank of Nigeria" is not shadowed by "First City".
  const byName = [...NIGERIAN_BANKS]
    .sort((a, b) => b.length - a.length)
    .find((bank) => hay.includes(bank.toLowerCase()));
  if (byName) return byName;

  const alias = Object.keys(ALIASES)
    .sort((a, b) => b.length - a.length)
    .find((key) => hay.includes(key));
  return alias ? ALIASES[alias] : null;
}

/**
 * Read an account out of an image.
 *
 * Tries the phone first: it is free, works offline, and answers in well under a
 * second. The server reader is the fallback for builds without the native
 * module, and for images the phone read text from but could not find an
 * account in - a vision model can make sense of a cluttered receipt in a way
 * that matching against a list cannot.
 */
export async function readAccountFromImage(uri: string): Promise<ReadAccount> {
  const recognizer = nativeRecognizer();

  if (recognizer?.recognize) {
    try {
      /**
       * Try the URI as given, then the bare path.
       *
       * Native readers differ on whether they want the "file://" scheme, and
       * the one that does not simply returns nothing rather than complaining -
       * which is indistinguishable from a picture with no text in it. Trying
       * both costs one extra call only when the first found nothing.
       */
      let text: string = (await recognizer.recognize(uri))?.text ?? "";
      if (!text.trim() && uri.startsWith("file://")) {
        const bare = uri.replace(/^file:\/\//, "");
        console.log("[READER] empty with scheme, retrying bare path");
        text = (await recognizer.recognize(bare))?.text ?? "";
      }

      /**
       * Read nothing at all, and the reader did not work - that is not the
       * same as reading a picture with no account in it.
       *
       * The distinction matters: a photo of a wall genuinely has no number and
       * should cost nothing, while empty text from a photo that plainly does
       * have one means this image never got decoded. Only the second is worth
       * a server call.
       */
      if (!text.trim()) {
        console.warn("[READER] on-device returned no text at all, asking the server:", uri);
      } else {
        return {
          accountNumber: findAccountNumber(text),
          bankName: findBank(text),
          via: "device",
        };
      }
    } catch (err) {
      // Only a reader that actually failed falls back.
      console.warn("[READER] on-device read failed, falling back:", err);
    }
  }

  const server = await scanAccountFromImage(uri);
  return { accountNumber: server.accountNumber, bankName: server.bankName, via: "server" };
}
