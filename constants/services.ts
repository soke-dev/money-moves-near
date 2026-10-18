/**
 * What a paused service is, said in one place that imports nothing.
 *
 * Deliberately dependency-free. The API client needs the titles to caption a
 * 503, the sheet needs the time formatter, and the sheet is what the API
 * client calls - so anything these two share that lived beside the fetch
 * would close a loop between them, and a cycle in Metro resolves to
 * `undefined` at whichever end evaluates first rather than to an error you
 * can find.
 */

export type ServiceKey =
  | "bank"
  | "funding"
  | "airtime"
  | "data"
  | "electricity"
  | "username"
  | "withdraw"
  | "cable"
  | "betting"
  | "signups";

export type ServiceState = {
  paused: boolean;
  /** The short line for the row. */
  note: string | null;
  /** The full sentence for the sheet. */
  message: string | null;
  /** ISO, or null when nobody said. */
  backBy: string | null;
};

export type ServiceMap = Partial<Record<ServiceKey, ServiceState>>;

/**
 * Written out rather than built from the key, because English will not build.
 * "Electricity are under maintenance" is what you get from a template.
 */
export const PAUSED_TITLES: Record<ServiceKey, string> = {
  bank: "Bank transfers are under maintenance",
  funding: "Crypto purchases are under maintenance",
  airtime: "Airtime is under maintenance",
  data: "Data bundles are under maintenance",
  electricity: "Electricity bills are under maintenance",
  username: "Username transfers are under maintenance",
  withdraw: "Crypto withdrawals are under maintenance",
  cable: "Cable TV is under maintenance",
  betting: "Betting top-ups are under maintenance",
  // Not "under maintenance": nothing is broken, and the message under it says
  // existing accounts can still sign in.
  signups: "New sign-ups are paused",
};

/**
 * Shown when the console left the message blank.
 *
 * Says nothing the title has already said. The title names the service, so a
 * body that named it again would be the same sentence twice - which is what
 * you get when the server's default and the app's title are written apart.
 * The server sends this exact wording for the same reason.
 */
export const PAUSED_FALLBACK =
  "We are doing a bit of maintenance here. Please try again shortly.";

/** The line on the row when the console left the note blank. */
export const PAUSED_NOTE = "Undergoing maintenance";

/**
 * "Around 4:00 PM", "Tomorrow, 9:00 AM", or the date for anything further out.
 *
 * Deliberately vague at the hour. A payout partner coming back is not a train
 * timetable, and a promise of 16:00 that slips to 16:40 is worse than one that
 * was never that precise.
 */
export function backByLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;

  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;

  const time = when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const days = Math.floor((when.getTime() - midnight.getTime()) / 86_400_000);

  if (days <= 0) return `Around ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  return when.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
