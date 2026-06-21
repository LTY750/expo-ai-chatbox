// Metro 配置 —— 把 markdown-it 依赖的 Node 模块 punycode 映射到 npm 的 polyfill 包
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  punycode: require.resolve('punycode/'),
};

module.exports = config;
