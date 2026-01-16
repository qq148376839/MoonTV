#!/usr/bin/env node
/* eslint-disable */
// AUTO-GENERATED SCRIPT: Converts config.json to TypeScript definition.
// Usage: node scripts/convert-config.js

const fs = require('fs');
const path = require('path');

// Resolve project root (one level up from scripts folder)
const projectRoot = path.resolve(__dirname, '..');

// Paths
const configPath = path.join(projectRoot, 'config.json');
const libDir = path.join(projectRoot, 'src', 'lib');
const oldRuntimePath = path.join(libDir, 'runtime.ts');
const newRuntimePath = path.join(libDir, 'runtime.ts');

// Delete the old runtime.ts file if it exists
if (fs.existsSync(oldRuntimePath)) {
  fs.unlinkSync(oldRuntimePath);
  console.log('旧的 runtime.ts 已删除');
}

// Read and parse config.json
let config;
if (fs.existsSync(configPath)) {
  let rawConfig;
  try {
    rawConfig = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    console.error(`无法读取 ${configPath}:`, err);
    process.exit(1);
  }

  try {
    config = JSON.parse(rawConfig);
  } catch (err) {
    console.error('config.json 不是有效的 JSON:', err);
    process.exit(1);
  }
} else {
  // 不再强依赖 config.json：缺失时生成最小 runtime 配置，保证 dev/build 可运行
  console.warn(
    `未找到 ${configPath}，将生成最小 runtime 配置（SourceConfig 为空）。`
  );
  config = {
    cache_time: 7200,
    api_site: {},
    custom_category: [],
  };
}

// Ensure required fields exist (even if config.json contents are partial/legacy)
if (!config || typeof config !== 'object') {
  config = { cache_time: 7200, api_site: {}, custom_category: [] };
}
if (!config.api_site || typeof config.api_site !== 'object') {
  config.api_site = {};
}
if (!Array.isArray(config.custom_category)) {
  config.custom_category = [];
}

// Prepare TypeScript file content
const tsContent =
  `// 该文件由 scripts/convert-config.js 自动生成，请勿手动修改\n` +
  `/* eslint-disable */\n\n` +
  `export const config = ${JSON.stringify(config, null, 2)} as const;\n\n` +
  `export type RuntimeConfig = typeof config;\n\n` +
  `export default config;\n`;

// Ensure lib directory exists
if (!fs.existsSync(libDir)) {
  fs.mkdirSync(libDir, { recursive: true });
}

// Write to runtime.ts
try {
  fs.writeFileSync(newRuntimePath, tsContent, 'utf8');
  console.log('已生成 src/lib/runtime.ts');
} catch (err) {
  console.error('写入 runtime.ts 失败:', err);
  process.exit(1);
}
