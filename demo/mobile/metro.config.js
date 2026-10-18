// This app lives inside the Money Moves repo but stands alone: Metro serves from this folder only.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.projectRoot = __dirname;
config.watchFolders = [__dirname];
config.server = { ...config.server, unstable_serverRoot: __dirname };
config.resolver.nodeModulesPaths = [require("path").join(__dirname, "node_modules")];

module.exports = config;
