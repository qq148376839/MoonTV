/** @type {import('next').NextConfig} */
/* eslint-disable @typescript-eslint/no-var-requires */
const nextConfig = {
  output: 'standalone',
  typescript: {
    // 构建时忽略 TypeScript 错误，减少内存消耗
    // 建议在 CI/CD 中单独运行类型检查
    // 如果设置了 SKIP_TYPE_CHECK 环境变量，则跳过类型检查
    ignoreBuildErrors: process.env.SKIP_TYPE_CHECK === 'true',
  },

  reactStrictMode: false,

  // Next.js 16 默认使用 Turbopack，但项目中有 webpack 配置
  // 固定 Turbopack 根目录，避免在存在多个 lockfile 时被错误推断为上级目录
  turbopack: { root: __dirname },

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
