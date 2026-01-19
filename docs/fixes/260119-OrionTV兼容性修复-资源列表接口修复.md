# OrionTV 兼容性修复：资源列表接口修复

## 📋 修复概述

本次修复解决了 OrionTV 使用 MoonTV 作为后端时显示"没有可用的视频源，请检查设置或联系管理员"的核心问题。

## 🔍 问题分析

### 现象
- OrionTV 显示错误："没有可用的视频源，请检查设置或联系管理员"
- MoonTV Web 端正常工作
- OrionTV 无法进行搜索和播放

### 根本原因
1. **MoonTV 搜索功能独立化**：不再使用 `config.json` 中的 `api_site` 配置，转而使用环境变量配置的搜索接口
2. **资源列表接口返回空数组**：`/api/search/resources` 接口依赖 `config.json` 中的 `api_site`，但该配置为空
3. **OrionTV 依赖资源列表**：OrionTV 通过 `/api/search/resources` 获取可用视频源列表，用于界面显示和源过滤
4. **认证限制**：搜索接口需要认证，但 OrionTV 需要在登录前获取资源列表

## 🔧 修复内容

### 1. 修复资源列表接口

**修改文件**：`src/app/api/search/resources/route.ts`

**修复前**：
```typescript
// 返回 config.json 中的空配置（因为搜索已独立化）
const apiSites = await getAvailableApiSites(); // 返回 []
```

**修复后**：
```typescript
// 返回基于环境变量配置的资源列表
const resources = [
  {
    key: 'official',
    name: '官方资源',
    api: process.env.NEXT_PUBLIC_OFFICIAL_SEARCH_URL || 'https://789jx.riowang.win',
    official_parser: true,
  },
  {
    key: 'unofficial',
    name: '非官方资源',
    api: process.env.NEXT_PUBLIC_UNOFFICIAL_SEARCH_URL || 'https://ss.riowang.win',
    official_parser: false,
  },
];
```

### 2. 修复认证中间件

**修改文件**：`src/middleware.ts`

**修复内容**：将 `/api/search` 路径添加到跳过认证的路径列表中，确保 OrionTV 可以无认证访问搜索相关接口。

```typescript
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login|warning|api/login|api/register|api/logout|api/cron|api/server-config|api/decrypt|api/search).*)',
  ],
};
```

## ✅ 修复效果

### 修复前
- ❌ `/api/search/resources` 返回空数组 `[]`
- ❌ OrionTV 显示"没有可用的视频源"错误
- ❌ 无法进行搜索和播放

### 修复后
- ✅ `/api/search/resources` 返回正确的资源列表：

```json
[
  {
    "key": "official",
    "name": "官方资源",
    "api": "https://789jx.riowang.win",
    "official_parser": true
  },
  {
    "key": "unofficial",
    "name": "非官方资源",
    "api": "https://ss.riowang.win",
    "official_parser": false
  }
]
```

- ✅ OrionTV 正常显示可用视频源
- ✅ 搜索和播放功能恢复正常

## 📝 涉及文件

1. **`src/app/api/search/resources/route.ts`** - 修复资源列表接口实现
2. **`src/middleware.ts`** - 添加搜索接口到认证跳过列表

## 🧪 测试验证

### 测试场景
1. **资源列表获取**：
   ```bash
   curl http://localhost:51000/api/search/resources
   # 应该返回包含 official 和 unofficial 资源的 JSON 数组
   ```

2. **OrionTV 兼容性**：
   - OrionTV 启动后不再显示"没有可用的视频源"错误
   - 设置页面能正确显示可用视频源
   - 搜索功能正常工作

## 📌 注意事项

1. **环境变量依赖**：
   - 官方资源搜索：`NEXT_PUBLIC_OFFICIAL_SEARCH_URL`（默认：`https://789jx.riowang.win`）
   - 非官方资源搜索：`NEXT_PUBLIC_UNOFFICIAL_SEARCH_URL`（默认：`https://ss.riowang.win`）

2. **兼容性**：
   - 向后兼容 MoonTV Web 端
   - 修复 OrionTV 的资源获取问题
   - 不影响其他功能

3. **认证策略**：
   - 搜索接口无需认证，确保客户端可以在登录前获取资源列表
   - 其他敏感接口仍需要认证保护

## 🔗 相关文档

- [OrionTV 兼容性完整修复：非官方资源代理 + 本地资源播放 + 自动下载优化](./260119-OrionTV兼容性完整修复-非官方资源代理-本地资源播放-自动下载优化.md)
- [OrionTV 兼容性修复：官方资源 episodes 转换](./260119-OrionTV兼容性修复-官方资源episodes转换.md)

---

**修复时间**：2026-01-19
**影响范围**：`/api/search/resources` 接口、认证中间件
**兼容性**：向后兼容，不影响 MoonTV Web 端使用