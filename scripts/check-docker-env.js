#!/usr/bin/env node

/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-console */

/**
 * 诊断脚本：检查 Docker 环境中的环境变量和权限
 */

const fs = require('fs');
const path = require('path');

console.log('=== Docker 环境诊断 ===\n');

// 检查环境变量
console.log('1. 环境变量检查:');
const envVars = [
  'LOCAL_STORAGE_ENABLED',
  'LOCAL_STORAGE_PATH',
  'LOCAL_STORAGE_MAX_CONCURRENT',
  'LOCAL_STORAGE_TS_CONCURRENT',
  'LOCAL_STORAGE_AUTO_DOWNLOAD_NEXT',
  'DOCKER_ENV',
  'NODE_ENV',
  'HOSTNAME',
  'PORT',
];

envVars.forEach((varName) => {
  const value = process.env[varName];
  console.log(`   ${varName}: ${value !== undefined ? value : '(未设置)'}`);
});

// 检查存储路径
console.log('\n2. 存储路径检查:');
const storagePath =
  process.env.LOCAL_STORAGE_PATH || path.join(process.cwd(), 'data', 'videos');
console.log(`   配置路径: ${storagePath}`);
console.log(`   当前工作目录: ${process.cwd()}`);

// 检查路径是否存在
if (fs.existsSync(storagePath)) {
  console.log(`   ✓ 路径存在`);

  // 检查权限
  try {
    fs.accessSync(storagePath, fs.constants.R_OK | fs.constants.W_OK);
    console.log(`   ✓ 路径可读写`);
  } catch (err) {
    console.log(`   ✗ 路径权限不足:`, err.message);
  }

  // 检查统计信息
  try {
    const stats = fs.statSync(storagePath);
    console.log(`   路径类型: ${stats.isDirectory() ? '目录' : '文件'}`);
    console.log(`   权限: ${stats.mode.toString(8)}`);
  } catch (err) {
    console.log(`   ✗ 无法获取路径统计信息:`, err.message);
  }
} else {
  console.log(`   ✗ 路径不存在`);

  // 尝试创建目录
  try {
    fs.mkdirSync(storagePath, { recursive: true });
    console.log(`   ✓ 已创建目录`);
  } catch (err) {
    console.log(`   ✗ 无法创建目录:`, err.message);
  }
}

// 检查测试写入
console.log('\n3. 写入测试:');
const testFile = path.join(storagePath, '.test');
try {
  fs.writeFileSync(testFile, 'test');
  console.log(`   ✓ 写入测试成功`);
  fs.unlinkSync(testFile);
  console.log(`   ✓ 删除测试文件成功`);
} catch (err) {
  console.log(`   ✗ 写入测试失败:`, err.message);
  if (err.code) {
    console.log(`   错误代码: ${err.code}`);
  }
}

// 检查用户信息
console.log('\n4. 用户信息:');
console.log(`   用户 ID: ${process.getuid ? process.getuid() : 'N/A'}`);
console.log(`   组 ID: ${process.getgid ? process.getgid() : 'N/A'}`);
console.log(`   用户名: ${process.env.USER || process.env.USERNAME || 'N/A'}`);

console.log('\n=== 诊断完成 ===\n');
