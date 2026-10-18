import { api } from "./api";

/**
 * A statement, built on the server and emailed.
 *
 * Never downloaded. A link that returns somebody's whole financial history is
 * a link that can leak one, so the file only ever goes to the verified address
 * on the account - which is also why this call takes no destination.
 */

export type StatementType =
  | "DEPOSIT"
  | "WITHDRAW"
  | "BUY"
  | "SELL"
  | "TRANSFER"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "AIRTIME"
  | "TV";

/** The groups offered, and the types each one covers. */
export const STATEMENT_GROUPS: { key: string; label: string; types: StatementType[] }[] = [
  { key: "in", label: "Money in", types: ["DEPOSIT", "TRANSFER_IN"] },
  { key: "fund", label: "Funding", types: ["BUY"] },
  { key: "sent", label: "Crypto sent", types: ["TRANSFER", "TRANSFER_OUT"] },
  { key: "bank", label: "Bank transfers", types: ["SELL"] },
  { key: "withdraw", label: "Withdrawals", types: ["WITHDRAW"] },
  { key: "bills", label: "Bills", types: ["AIRTIME", "TV"] },
];

export interface StatementResult {
  sent: boolean;
  /** Masked - a confirmation that the right inbox was used, not the address. */
  email: string;
  rows: number;
  number: string;
}

export async function emailStatement(
  from: Date,
  to: Date,
  types: StatementType[] | null,
): Promise<StatementResult> {
  const res = await api.post("/statement", {
    // Date only. The server decides where a day starts and ends, so a phone in
    // another timezone cannot shift the period by sending its own midnight.
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    ...(types && types.length ? { types } : {}),
  });
  return res.data;
}
