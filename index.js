// Entry point — order matters. First stub browser APIs some Web3Auth web deps
// expect (window.addEventListener), then install the crypto polyfills, then the
// app. Imports evaluate top-to-bottom, so the shim runs before the SDK loads.
import "./web3auth-shim";
// Web3Auth is being replaced by Dynamic.xyz. Loading its /setup here pulls in the
// @toruslabs controllers at boot, which crash under Metro (require("url").pathToFileURL
// is undefined in RN). Keep it out of the boot path. The old wallet-setup screen that
// still uses Web3Auth is only reached by explicit navigation, not on launch.
// import "@web3auth/react-native-sdk/setup";
import "expo-router/entry";
