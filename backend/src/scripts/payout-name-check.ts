import { payoutNameParts } from "../lib/flutterwave";

const cases = [
  "(OKash) IWINOSA SAMIRA AYOBAHAN",
  "COLLINS OKOTETE",
  "MR. JOHN A. ADEYEMI-OKON",
  "O'BRIEN CHIOMA",
  "(PalmPay) ADE  BOLA",
  "[Kuda] NGOZI EZE",
  "12345",
  "",
];
for (const c of cases) {
  const p = payoutNameParts(c);
  const name = p.length ? { first: p[0], last: p.length > 1 ? p[p.length - 1] : p[0] } : undefined;
  console.log(`${JSON.stringify(c).padEnd(36)} -> ${name ? `first=${name.first} last=${name.last}` : "(no name sent)"}`);
}
