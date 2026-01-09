/** @type {import('next').NextConfig} */
/* eslint-disable @typescript-eslint/no-var-requires */
const nextConfig = {
  output: 'standalone',

  reactStrictMode: false,

  // Next.js 16 默认使用 Turbopack，但项目中有 webpack 配置
  // 设置空的 turbopack 配置以禁用 Turbopack，使用 webpack
  turbopack: {},

  // Uncoment to add domain whitelist
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },

  webpack(config, { isServer }) {
    // Grab the existing rule that handles SVG imports
    const fileLoaderRule = config.module.rules.find((rule) =>
      rule.test?.test?.('.svg')
    );

    config.module.rules.push(
      // Reapply the existing rule, but only for svg imports ending in ?url
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/, // *.svg?url
      },
      // Convert all other *.svg imports to React components
      {
        test: /\.svg$/i,
        issuer: { not: /\.(css|scss|sass)$/ },
        resourceQuery: { not: /url/ }, // exclude if *.svg?url
        loader: '@svgr/webpack',
        options: {
          dimensions: false,
          titleProp: true,
        },
      }
    );

    // Modify the file loader rule to ignore *.svg, since we have it handled now.
    fileLoaderRule.exclude = /\.svg$/i;

    config.resolve.fallback = {
      ...config.resolve.fallback,
      net: false,
      tls: false,
      crypto: false,
      // 确保 http 和 https 模块只在服务器端可用
      http: isServer ? require.resolve('http') : false,
      https: isServer ? require.resolve('https') : false,
    };

    // 确保 http-client.ts 只在服务器端使用
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        '@/lib/http-client': false, // 在客户端禁用此模块
      };
    }

    // 修复浏览器环境中的 exports 未定义问题
    if (!isServer) {
      config.output = {
        ...config.output,
        globalObject: 'self',
      };

      // 确保 webpack 正确处理 CommonJS 模块
      // Next.js 16 的 webpack 应该自动处理，但如果出现问题，可能需要显式配置
      // 注意：这个错误可能来自 Next.js 的 react-refresh-utils 或第三方依赖
      
      // 如果问题仍然存在，可能需要：
      // 1. 清除 .next 目录和 node_modules，重新安装依赖
      // 2. 检查是否有第三方依赖使用 CommonJS，考虑使用 next-transpile-modules
      // 3. 检查 Tampermonkey userscript 是否干扰了模块加载
    }

    return config;
  },
};

const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
});

module.exports = withPWA(nextConfig);
