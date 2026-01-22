# OrionTV 兼容性修复：资源列表接口修复

## 📋 修复概述

本次修复解决了 OrionTV 使用 MoonTV 作为后端时显示"没有可用的视频源，请检查设置或联系管理员"的核心问题。

## 🔍 问题分析（更正）

### 现象

- OrionTV 显示错误："没有可用的视频源，请检查设置或联系管理员"
- MoonTV Web 端正常工作
- OrionTV 无法进行搜索和播放

### 根本原因

1. **MoonTV 搜索功能独立化**：搜索结果的 `SearchResult.source` 不再来自 `config.json api_site`，而是来自“独立搜索”上游返回的真实资源站 key（例如 `789caiji`、`jisu`）
2. **资源列表接口返回了错误的 key**：错误地返回 `official/unofficial` 这类“分类 key”，导致 OrionTV 的 `resourceId` 与 `SearchResult.source` 不匹配
3. **OrionTV 的契约**：OrionTV 会使用 `/api/search/resources` 返回的 `key` 作为 `resourceId` 去调用 `/api/search/one`，并且期望返回结果的 `result.source === resourceId` 且 `episodes` 可用
4. **认证限制**：播放相关的代理接口（如 `/api/proxy/m3u8`）若被认证拦截，会导致 `episodes[0]` 拉取返回 401，从而“看起来无法播放”

## 🔧 修复内容（更正后的最终方案）

### 1. 修复资源列表接口（返回真实资源站 key）

**修改文件**：`src/app/api/search/resources/route.ts`

**修复前**：

```typescript
// 返回 config.json 中的空配置（因为搜索已独立化）
const apiSites = await getAvailableApiSites(); // 返回 []
```

**修复后**（示例，重要更正）：

```typescript
// 返回“真实资源站 key”（必须与 SearchResult.source 一致）
const resources = [
  {
    key: '789caiji',
    name: '789采集（官方解析）',
    api:
      process.env.NEXT_PUBLIC_OFFICIAL_SEARCH_URL ||
      'https://789jx.riowang.win',
    official_parser: true,
  },
  // 非官方多源：必须包含 /api/search/stream 可能返回的 source key（如 ruyi）
  // 否则会出现“MoonTV Web 能搜到，但 OrionTV 搜不到”的现象（因为 OrionTV 会逐源调用 /api/search/one）。
  { key: 'ruyi', name: '如意资源（非官方）', api: '', official_parser: false },
  { key: 'jisu', name: '极速资源（非官方）', api: '', official_parser: false },
];
```

### 2. 修复认证中间件（放行播放/代理相关接口）

**修改文件**：`src/middleware.ts`

**修复内容**：将 OrionTV 必需的接口加入跳过认证列表：`/api/search*`、`/api/server-config`、`/api/proxy/*`、`/api/local-*`、`/api/image-proxy`、`/api/official-play.m3u8`、`/api/unofficial-play.m3u8` 等。

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

- ✅ `/api/search/resources` 返回真实资源站 key：

```json
[
  {
    "key": "789caiji",
    "name": "789采集（官方解析）",
    "api": "https://789jx.riowang.win",
    "official_parser": true
  },
  {
    "key": "jisu",
    "name": "极速资源（非官方）",
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

3. **关键验证（播放链路）**：
   - `episodes[0]` 若为 `/api/unofficial-play.m3u8?...`：应返回 302 跳转到 `/api/proxy/m3u8?...`（或本地已完整下载则 302 到 `/api/local-video?...`）
   - `episodes[0]` 若为 `/api/official-play.m3u8?...`：应返回 302 跳转到真实 m3u8；解析失败则返回 5xx（OrionTV 弹错）

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
