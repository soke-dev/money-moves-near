/**
 * Which rail a payment runs on.
 *
 * Test mode is the simulator, always - in production too, so a business can
 * try everything before it's verified. Live mode follows NAIRA_RAILS: the
 * simulator on staging and in development, Flutterwave when it says so, and
 * nothing at all when it's off.
 */
import type { Mode } from "@prisma/client";
import { env, isDev } from "../config/env";
import { flutterwaveBanks, flutterwaveReady, flutterwaveResolve } from "../lib/flutterwave";
import { HttpError } from "../lib/http";
import { flutterwave } from "./flutterwave";
import { simulator } from "./simulator";
import type { NairaRails } from "./types";

const liveOff = () => new HttpError(503, "Live naira payments aren't switched on yet. Test mode works in the meantime.", "rails_off");

export function railsFor(mode: Mode): NairaRails {
  if (mode === "TEST" || env.NAIRA_RAILS === "simulated") return simulator;
  if (env.NAIRA_RAILS === "flutterwave") return flutterwave;
  throw liveOff();
}

/**
 * For checking whose a bank account is, in Payout places and activation:
 * Flutterwave's real lookup wherever its credentials are set - staging
 * included, because a name is only worth showing if the bank said it. Only
 * local development falls back to the simulator, for tests.
 */
export function lookupRails(): Pick<NairaRails, "banks" | "resolve"> {
  if (flutterwaveReady()) return { banks: flutterwaveBanks, resolve: (code, number) => flutterwaveResolve(code, number) };
  if (isDev) return simulator;
  throw new HttpError(503, "Bank account checks aren't switched on yet. Try again a little later.", "lookup_off");
}

/** Whether the test checkout's "pretend it arrived" buttons work for a payment. */
export const canSimulate = (mode: Mode) => mode === "TEST" || env.NAIRA_RAILS === "simulated";
