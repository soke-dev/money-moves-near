import { Redirect } from "expo-router";

/**
 * Catch route for the `money-moves://auth` deep link.
 *
 * Android delivers it after email login, and Expo Router would otherwise treat
 * it as a missing `/auth` screen (404).
 *
 * It used to redirect straight to `/(tabs)` to avoid "re-gating on the PIN
 * unlock screen", which assumed the link only ever arrives on an unlocked
 * session. It does not: it also arrives around sign-out, and sending a
 * signed-out user into the tabs left them on a Home screen that could never
 * load - no account, spinners forever. The same bypass is how a fresh sign-in
 * skipped the PIN entirely.
 *
 * Hand off to the root router instead and let it decide from the actual auth
 * state: signed out to onboarding, locked to the PIN screen, no PIN to set-pin.
 */
export default function AuthRedirectCatch() {
  return <Redirect href="/" />;
}
