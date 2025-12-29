/** @type {import('next').NextConfig} */
/* eslint-disable @typescript-eslint/no-var-requires */
const nextConfig = {
  output: 'standalone',
  eslint: {
    dirs: ['src'],
    // 构建时忽略 ESLint 错误，减少内存消耗
    ignoreDuringBuilds: false,
  },
  typescript: {
    // 构建时忽略 TypeScript 错误，减少内存消耗
    // 建议在 CI/CD 中单独运行类型检查
    // 如果设置了 SKIP_TYPE_CHECK 环境变量，则跳过类型检查
    ignoreBuildErrors: process.env.SKIP_TYPE_CHECK === 'true',
  },

  reactStrictMode: false,
  swcMinify: true,

  // Next.js 16 默认使用 Turbopack，但项目中有 webpack 配置
  // 设置空的 turbopack 配置以禁用 Turbopack，使用 webpack
  turbopack: {},

  // 优化构建性能
  experimental: {
    // 减少内存使用
    optimizeCss: false,
  },

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

  webpack(config) {
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
    };

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
