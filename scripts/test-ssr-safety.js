/**
 * SSR 安全性诊断脚本
 * 用于定位 "Cannot read properties of undefined (reading 'length')" 错误
 */

/* eslint-disable @typescript-eslint/no-var-requires, no-console */
const fs = require('fs');
const path = require('path');

const playPagePath = path.join(__dirname, '../src/app/play/page.tsx');
const content = fs.readFileSync(playPagePath, 'utf-8');

// 查找所有访问 .length 的地方
const lengthPattern = /\.length/g;
const lines = content.split('\n');

console.log('🔍 查找所有访问 .length 的位置：\n');

let matchCount = 0;
lines.forEach((line, index) => {
  const matches = line.match(lengthPattern);
  if (matches) {
    matchCount++;
    const lineNum = index + 1;
    const trimmedLine = line.trim();

    // 检查是否有安全检查
    const hasSafetyCheck =
      trimmedLine.includes('?.') ||
      trimmedLine.includes('||') ||
      trimmedLine.includes('Array.isArray') ||
      trimmedLine.includes('&&') ||
      trimmedLine.includes('??');

    const safetyStatus = hasSafetyCheck ? '✅' : '⚠️';

    console.log(
      `${safetyStatus} Line ${lineNum}: ${trimmedLine.substring(0, 100)}`
    );

    if (!hasSafetyCheck && lineNum >= 690 && lineNum <= 700) {
      console.log(`   ⚠️  警告：第 ${lineNum} 行附近可能存在问题！`);
    }
  }
});

console.log(`\n📊 总计找到 ${matchCount} 处访问 .length 的位置`);

// 特别检查第 690-700 行
console.log('\n🔍 检查第 690-700 行（错误发生区域）：\n');
for (let i = 689; i < Math.min(700, lines.length); i++) {
  const line = lines[i];
  if (line.includes('.length')) {
    console.log(`Line ${i + 1}: ${line.trim()}`);
  }
}

// 检查模块顶层的变量初始化
console.log('\n🔍 检查模块顶层的数组/字符串初始化：\n');
const topLevelPattern = /^(const|let|var)\s+(\w+)\s*=\s*(.*?);/gm;
let topLevelMatch;
while ((topLevelMatch = topLevelPattern.exec(content)) !== null) {
  const varName = topLevelMatch[2];
  const initValue = topLevelMatch[3];

  if (
    initValue.includes('length') ||
    initValue.includes('[]') ||
    initValue.includes('get(')
  ) {
    const lineNum = content
      .substring(0, topLevelMatch.index)
      .split('\n').length;
    console.log(`Line ${lineNum}: ${varName} = ${initValue.substring(0, 80)}`);
  }
}
