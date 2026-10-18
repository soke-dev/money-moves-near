/**
 * dynamic.ts — Dynamic.xyz embedded email-wallet client.
 *
 * New-user wallets: user signs up with email → Dynamic sends the OTP itself
 * (native, in-app, no browser) → Dynamic provisions a non-custodial TSS-MPC
 * embedded wallet (EVM + Solana). Existing users keep their 12-word mnemonic
 * wallet and migrate later via an opt-in button.
 *
 * Unlike the Web3Auth path, Dynamic NEVER exposes the raw private key (export is
 * a user-facing reveal UI only). So signing cannot reuse the local ethers/nacl
 * signers in services/wallet-core — it routes through services/dynamic-wallet:
 *   - EVM:    wallets.signMessage (personal_sign)
 *   - Ed25519 (Solana + Movement): wallets.signMessage → base58 64-byte sig
 *
 * The environmentId is a PUBLIC client-side identifier (safe to ship in the
 * bundle, like the Web3Auth client id was). Enabled chains + email login are
 * configured in the Dynamic dashboard for this environment.
 */
import { createClient } from "@dynamic-labs/client";
import { ReactNativeExtension } from "@dynamic-labs/react-native-extension";
import { ViemExtension } from "@dynamic-labs/viem-extension";

// Public environment id — safe to ship.
export const DYNAMIC_ENVIRONMENT_ID = "fc3e249c-2359-4773-8334-571176f9d8ea";

function buildClient() {
  return createClient({
    environmentId: DYNAMIC_ENVIRONMENT_ID,
    appName: "Money Moves",
  })
    .extend(
      ReactNativeExtension({
        // Used by the SDK for SIWE messages, fetch Origin headers and passkeys.
        // Must be allow-listed under CORS in the Dynamic dashboard. Deep-link
        // redirects are auto-configured from the app scheme via expo-linking.
        appOrigin: "https://app.usemoneymoves.xyz",
        // NOTE: embeddedWebView (native overlay) is intentionally OFF. The overlay
        // is a native window we cannot position or hide, and it painted over our
        // sign-in UI. The in-tree WebView is kept instead so app/_layout.tsx can
        // host it off-screen (it exposes no style prop of its own). The WaaS
        // "client replaced" problem is handled by the globalThis singleton below
        // plus mounting the WebView above the router so it never unmounts.
        embeddedWebView: false,
      })
    )
    .extend(ViemExtension());
}

type DynamicClient = ReturnType<typeof buildClient>;

// Keep ONE client for the lifetime of the JS context. Metro Fast Refresh
// re-evaluates this module on edit, and calling createClient() again replaces
// the WaaS client and revokes the in-flight signed session — which surfaced as
// "Error creating wallet account". Stashing it on globalThis makes reloads reuse
// the same instance.
const g = globalThis as any;
export const dynamicClient: DynamicClient =
  g.__mmDynamicClient ?? (g.__mmDynamicClient = buildClient());

// ─── WebView visibility during signing ──────────────────────
//
// The SDK's WebView is normally parked off-screen and non-interactive so it
// cannot paint over the app. That is fine for headless calls, but signing is
// not reliably headless: an off-screen, fully transparent WKWebView can be
// throttled by iOS, and if Dynamic needs to render an approval step there is
// nowhere for it to appear. Either way `signMessage` never settles and the UI
// waits forever.
//
// So signing brings the WebView on-screen for the duration and puts it back
// afterwards. A tiny external store rather than context: the toggle is called
// from plain async functions in services/, which have no React tree to read.

type VisibilityListener = (visible: boolean) => void;

let webViewVisible = false;
const visibilityListeners = new Set<VisibilityListener>();

export function setDynamicWebViewVisible(visible: boolean): void {
  if (webViewVisible === visible) return;
  webViewVisible = visible;
  for (const listener of visibilityListeners) listener(visible);
}

export function isDynamicWebViewVisible(): boolean {
  return webViewVisible;
}

export function subscribeDynamicWebView(listener: VisibilityListener): () => void {
  visibilityListeners.add(listener);
  return () => {
    visibilityListeners.delete(listener);
  };
}
