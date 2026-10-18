// The entry for the update-gate bundle, used ONLY when publishing to the old
// runtime versions (1.0.0, 1.0.6, 1.0.7). It deliberately does not import
// web3auth-shim or expo-router/entry: both pull in the app, and the app pulls
// in native modules those builds were compiled without.
//
// package.json's "main" is pointed here for the duration of those publishes and
// put back immediately afterwards. If you find the repo in this state, that is
// a publish that did not finish - restore "main" to "index.js" before shipping
// anything else.
import { registerRootComponent } from "expo";
import UpdateGate from "./update-gate";

registerRootComponent(UpdateGate);
