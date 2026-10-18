const { getDefaultConfig } = require("expo/metro-config");
const { withWeb3Auth } = require("@web3auth/react-native-sdk/metro-config");

// Web3Auth needs Node core polyfills (crypto, stream, buffer, …) for its key
// management to run in React Native. withWeb3Auth wires those into Metro.
module.exports = withWeb3Auth(getDefaultConfig(__dirname));
