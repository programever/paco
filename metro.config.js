// Xcode writes thousands of files under ios/ during a build; watching them made
// the phone reload over and over.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.blockList = [/\/ios\/.*/, /\/android\/.*/];
config.watchFolders = [];

module.exports = config;
