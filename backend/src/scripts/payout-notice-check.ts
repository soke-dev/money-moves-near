import { payoutNotice } from "../lib/payout-notice";

const cases: [string, any][] = [
  ["resolved name, shouting",  { ngnNet: 500, accountName: "OKORO COLLINS CHUKWUEMEKA", bankName: "GTBank", accountNumber: "0123456789" }],
  ["resolved name, mixed",     { ngnNet: 12500, accountName: "Collins Okoro", bankName: "Kuda", accountNumber: "2233445566" }],
  ["no name, bank + number",   { ngnNet: 7500, bankName: "Opay", accountNumber: "8100001234" }],
  ["bank only",                { ngnNet: 1000, bankName: "Moniepoint" }],
  ["nothing at all",           { ngnNet: 500 }],
  ["empty metadata",           {}],
  ["name with an apostrophe",  { ngnNet: 250000, accountName: "CHIOMA O'BRIEN-ADEYEMI" }],
];

for (const [label, meta] of cases) {
  for (const outcome of ["sent", "failed"] as const) {
    const n = payoutNotice(meta, outcome);
    console.log(`${label.padEnd(26)} ${outcome.padEnd(7)} | ${n.title.padEnd(16)} | ${n.body}`);
  }
}
