# SSR 错误诊断报告

## 错误信息

```
TypeError: Cannot read properties of undefined (reading 'length')
at <unknown> (.next\dev\server\app\play\page.js:694:47)
```

## 问题分析

### 1. 错误位置

- 编译后的代码位置：`play/page.js:694:47`
- 源代码位置：可能在 `src/app/play/page.tsx` 第 690-700 行附近

### 2. 可能的原因

#### 2.1 `sourceConfig` 访问问题

- **位置**：第 553 行、第 979 行
- **问题**：直接访问 `sourceConfig.length`，没有检查是否为数组
- **修复**：添加 `Array.isArray(sourceConfig)` 检查

#### 2.2 `sourceConfig.find()` 调用问题

- **位置**：第 545 行
- **问题**：如果 `sourceConfig` 不是数组，调用 `.find()` 会报错
- **修复**：添加数组检查

### 3. 修复方案

#### 3.1 修复 `sourceConfig.length` 访问

```typescript
// 修复前
sourceConfigLength: sourceConfig.length,

// 修复后
sourceConfigLength: Array.isArray(sourceConfig) ? sourceConfig.length : 0,
```

#### 3.2 修复 `sourceConfig.find()` 调用

```typescript
// 修复前
const apiSite = sourceConfig.find((s) => s.key === detailData.source);

// 修复后
const apiSite = Array.isArray(sourceConfig)
  ? sourceConfig.find((s) => s && s.key === detailData.source)
  : null;
```

#### 3.3 修复 `useEffect` 中的检查

```typescript
// 修复前
if (sourceConfig.length === 0) {

// 修复后
if (!Array.isArray(sourceConfig) || sourceConfig.length === 0) {
```

## 测试结果

运行 `scripts/test-ssr-safety.js` 后，发现：

- 总计 70 处访问 `.length` 的位置
- 第 553 行和第 979 行缺少安全检查（已修复）
- 第 545 行缺少数组检查（已修复）

## 验证步骤

1. 清除 `.next` 目录
2. 重新启动开发服务器
3. 访问播放页面
4. 检查控制台是否还有错误

## 相关文件

- `src/app/play/page.tsx` - 主要修复文件
- `scripts/test-ssr-safety.js` - 诊断脚本
- `src/app/play/__tests__/ssr-safety.test.ts` - 单元测试
