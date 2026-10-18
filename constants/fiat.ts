/**
 * The currencies you can deposit from.
 *
 * Most of them do not work yet - which is the point. "Is Ghana supported?" is a
 * question people ask before they trust an app with money, and a list that
 * quietly omits Ghana answers it wrongly. Listed and marked is the honest
 * answer; hidden is not.
 *
 * Everything here settles the same way: naira (or later, cedis) in, a dollar
 * stablecoin on Movement out. The chain is not a choice the depositor makes,
 * so it is not modelled as one.
 */
export interface FiatCountry {
  /** ISO country code, and the key the routes carry. */
  code: string;
  country: string;
  currency: string;
  /** The rail, said the way a depositor would say it. */
  method: string;
  flag: any;
  /** Where tapping the row goes. Empty while a country is not live yet. */
  route: string;
  live: boolean;
}

export const FIAT_COUNTRIES: FiatCountry[] = [
  {
    code: "NG",
    country: "Nigeria",
    currency: "NGN",
    method: "Any bank app",
    flag: require("@/assets/images/flag-ng.png"),
    route: "/deposit-naira",
    live: true,
  },
  {
    code: "GH",
    country: "Ghana",
    currency: "GHS",
    method: "MTN MoMo, AirtelTigo, Telecel",
    flag: require("@/assets/images/flag-gh.png"),
    route: "",
    live: false,
  },
  {
    code: "KE",
    country: "Kenya",
    currency: "KES",
    method: "Safaricom, Airtel",
    flag: require("@/assets/images/kenya-circle.png"),
    route: "",
    live: false,
  },
];

/**
 * What a naira deposit buys.
 *
 * One token, one chain, no picker. The backend swaps USDC on Movement for
 * USDCx on the way in - the depositor never sees that, and should not have to.
 */
export const FIAT_SETTLES = { token: "USDC", chain: "MOVE", network: "Movement" } as const;

/** Floor for a deposit, matching the rest of the app's naira minimum. */
export const FIAT_MIN_NGN = 500;

/**
 * What Money Moves takes on a naira deposit, as a fraction.
 *
 * Mirrors FEE_PERCENT in backend/src/routes/funding.ts, which is where it is
 * actually applied - the server takes it off the naira before converting, and
 * this copy exists only so the app can show the same arithmetic it is about to
 * perform. If one moves, move both.
 */
export const FIAT_FEE_RATE = 0.01;
