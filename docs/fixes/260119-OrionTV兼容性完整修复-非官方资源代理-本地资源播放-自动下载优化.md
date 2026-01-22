# OrionTV 兼容性完整修复：资源列表接口 + 非官方资源代理 + 本地资源播放 + 自动下载优化

## 📋 修复概述

本次修复针对 OrionTV 使用 MoonTV 作为后端时的四个核心问题：

1. **资源列表 key 不匹配 / 或为空**：`/api/search/resources[].key` 必须与 `SearchResult.source` 一致；返回 `official/unofficial` 这类“分类 key”会导致 `/api/search/one` 返回不准确数据（甚至 episodes 为空、无法播放/换源）
2. **非官方资源无法播放**：CORS 问题导致 m3u8 URL 无法访问
3. **本地资源无法播放**：OrionTV 无法检测和使用本地已下载资源
4. **自动下载优化**：根据电影/连续剧类型设置不同的下载范围

---

## 🔧 修复内容

### 0. 资源列表接口修复（前提修复）

**问题**：

- MoonTV 搜索功能已独立化，不再使用 `config.json` 中的 `api_site` 配置
- OrionTV 的契约是：`/api/search/resources[].key` 会作为 `resourceId` 调用 `/api/search/one`，并且期望返回结果的 `source === resourceId`
- 返回 `official/unofficial` 这类“分类 key”会导致返回数据不准确（例如 episodes 为空/不可用）
- 这是最基础的问题，必须先修复才能解决后续问题

**解决方案**：

- 修改 `/api/search/resources` 接口，返回“真实资源站 key”（必须与搜索结果 `SearchResult.source` 一致）
  - **重要更正**：OrionTV 会先拉 `/api/search/resources`，然后对每个 `resourceId` 调用 `/api/search/one`，因此 resources 必须覆盖 `/api/search/stream` 可能返回的非官方源 key（例如 `ruyi`），否则会出现“Web 端能搜到但 OrionTV 搜不到”
- 修复认证中间件，放行 OrionTV 播放链路必需接口（`/api/search*`、`/api/proxy/*`、`/api/local-*`、`/api/image-proxy`、`/api/official-play.m3u8`、`/api/unofficial-play.m3u8` 等）

**实现位置**：

- `src/app/api/search/resources/route.ts`：返回真实资源站 key 的资源列表
- `src/middleware.ts`：放行 OrionTV 所需接口
- `src/app/api/official-play.m3u8/route.ts`：官方播放入口（按需解析 + 本地完整集优先 + 触发下载；兼容旧的 `?url=...` 形式）
- `src/app/api/unofficial-play.m3u8/route.ts`：非官方播放入口（代理播放 + 本地完整集优先 + 触发下载）

**代码逻辑**：

```typescript
// 返回真实资源站 key（必须与 SearchResult.source 一致）
const resources = [
  {
    key: '789caiji',
    name: '789采集（官方解析）',
    api:
      process.env.NEXT_PUBLIC_OFFICIAL_SEARCH_URL ||
      'https://789jx.riowang.win',
    official_parser: true,
  },
  {
    key: 'jisu',
    name: '极速资源（非官方）',
    api:
      process.env.NEXT_PUBLIC_UNOFFICIAL_SEARCH_URL || 'https://ss.riowang.win',
    official_parser: false,
  },
];
```

---

### 1. 非官方资源代理（方案 A - 保守方案）

**问题**：

- 非官方资源在搜索结果中已经是 m3u8 URL
- 但可能因为 CORS、内网地址等问题无法播放
- 不确定本地地址在 OrionTV 中是否会有 CORS 问题

**解决方案**：
（方案更新为 B）

- 在 `/api/search/one`（以及 OrionTV 会用到的 `/api/search`）中，将非官方资源的 `episodes[]` **全量替换**为：
  - `/api/unofficial-play.m3u8?q=...&source=...&id=...&ep=...&total=...&url=<m3u8>`
- `unofficial-play.m3u8` 行为：
  - 若本地该集已**完整下载**：302 到 `/api/local-video?path=<episode_XX.m3u8>`
  - 否则：异步触发下载（当前集 + 后 N 集；默认 3，可用 `LOCAL_STORAGE_AUTO_DOWNLOAD_NEXT` 覆盖），并 302 到 `/api/proxy/m3u8?url=<m3u8>`（解决 CORS）

**实现位置**：
（方案更新为 B）

- `src/app/api/unofficial-play.m3u8/route.ts`
- `src/app/api/search/one/route.ts`
- `src/app/api/search/route.ts`（OrionTV 分支）

**代码逻辑**（示意）：

```typescript
// 非官方：episodes 全量改写为 /api/unofficial-play.m3u8?...（播放时触发下载 + 在线代理）
result.episodes = result.episodes.map(
  (m3u8Url, idx) =>
    `${origin}/api/unofficial-play.m3u8?q=${q}&source=${source}&id=${id}&ep=${
      idx + 1
    }&total=${total}&url=${encodeURIComponent(m3u8Url)}`
);
```

---

### 2. 本地资源播放（完整下载优先；不完整走在线）

**问题**：

- OrionTV 无法检测本地资源
- 即使本地资源已下载，OrionTV 仍使用在线资源播放

**解决方案**：

- 搜索阶段：通过 `/api/local-resource` 获取每集下载完整性
  - 已完整下载的集：将对应 `episodes[i]` 替换为 `/api/local-video?path=<episode_XX.m3u8>`
  - 不完整：保持在线播放入口（`official-play.m3u8` / `unofficial-play.m3u8`）
- 播放阶段：`official-play.m3u8` / `unofficial-play.m3u8` 也会再次检查该集是否完整下载，做到“已下完就本地，否则在线”

**实现位置**：

- `src/app/api/search/route.ts`：新增 `getLocalResourcePlayUrl()` 函数
- `src/app/api/search/one/route.ts`：同样添加本地资源检测逻辑
  （补齐）
- `src/app/api/local-resource/route.ts`：返回 `downloaded_episodes[]`、`episode_m3u8_paths[]`（用于按集替换）

**代码逻辑**：

```typescript
// 检测本地资源（优先使用本地资源播放）
const localPlayUrl = await getLocalResourcePlayUrl(
  result.source,
  result.id,
  0, // 只检测第一个 episode（OrionTV 通常只播放第一个）
  baseUrl
);
if (localPlayUrl) {
  // 替换第一个 episode 为本地播放 URL
  result.episodes[0] = localPlayUrl;
}
```

**技术细节**：

- 在 Edge Runtime 中通过 HTTP 调用 `/api/local-resource` API 检测本地资源
- 只检测第一个 episode（OrionTV 通常只播放第一个）
- 如果本地资源存在，优先使用本地播放 URL

---

### 3. 自动下载（方案 B - 播放触发）

**问题**：

- 当前自动下载逻辑固定下载"当前集 + 下 2 集"
- 对于电影（只有 1 集），会尝试下载不存在的集数

**解决方案**：

- 不依赖 `/api/playrecords`：在播放入口触发下载
- **电影**（`total === 1`）：只下载当前集
- **连续剧**（`total > 1`）：下载当前集 + 后 3 集（默认 3，可配置 `LOCAL_STORAGE_AUTO_DOWNLOAD_NEXT`）

**实现位置**：
（方案更新为 B）

- `src/app/api/official-play.m3u8/route.ts`
- `src/app/api/unofficial-play.m3u8/route.ts`

**代码逻辑**：

```typescript
// 判断是电影还是连续剧
const isMovie = totalEpisodes === 1;

// PlayRecord.index 是从1开始的，需要转换为0-based（episodes数组索引）
const episodeIndex = currentIndex - 1;

let episodeRange: { start: number; end: number };
if (isMovie) {
  // 电影：只下载当前集
  episodeRange = {
    start: episodeIndex,
    end: episodeIndex,
  };
} else {
  // 连续剧：下载当前集 + 下2集
  const downloadNextEpisodes = parseInt(
    process.env.LOCAL_STORAGE_AUTO_DOWNLOAD_NEXT || '2',
    10
  );
  episodeRange = {
    start: episodeIndex,
    end: episodeIndex + downloadNextEpisodes,
  };
}
```

**触发时机**：

- 在 `/api/playrecords` POST 接口中，保存播放记录时异步触发
- 不阻塞响应，后台异步执行

---

## 📝 涉及文件

### 修改的文件

1. **`src/app/api/search/resources/route.ts`**

   - 修改接口实现：返回基于环境变量配置的资源列表，而不是空的 config.json 配置

2. **`src/middleware.ts`**

   - 修改认证配置：添加 `/api/search` 路径到认证跳过列表

3. **`src/lib/parse-helper.ts`**

   - 新增 `convertToProxyUrl()` 函数：将 URL 转换为代理 URL
   - 新增 `convertUnofficialEpisodes()` 函数：批量转换非官方资源的 episodes
   - （调整策略）官方资源不再在 `search/one` 阶段批量解析为 m3u8，而是通过播放时按需解析接口完成

4. **`src/app/api/search/route.ts`**

   - 新增 `getLocalResourcePlayUrl()` 函数：检测本地资源并获取播放 URL
   - 对官方资源：可保持不解析（仅返回原始 HTML），或（OrionTV 兼容分支）替换为按需解析播放 URL（不触发真实解析）
   - 对非官方资源：转换 m3u8 URL 为代理 URL
   - 对所有资源：检测本地资源并优先使用本地播放 URL

5. **`src/app/api/search/one/route.ts`**

   - 新增 `getLocalResourcePlayUrl()` 函数：检测本地资源并获取播放 URL
   - 对官方资源：将 `episodes[]` **全量替换**为按需解析播放 URL（`/api/official-play.m3u8?url=...`，确保 URL 以 `.m3u8` 结尾，OrionTV 不会过滤）
   - 对非官方资源：转换 m3u8 URL 为代理 URL
   - 对所有资源：检测本地资源并优先使用本地播放 URL

6. **`src/app/api/official-play.m3u8/route.ts`**

   - 新增：官方资源按需解析播放接口
   - 输入：`url=<原始HTML地址>`
   - 输出：解析成功 302 跳转到真实 m3u8；解析失败返回 5xx（OrionTV 弹错）

7. **`src/app/api/playrecords/route.ts`**
   - 修改 `triggerAutoDownload()` 函数：添加 `totalEpisodes` 参数
   - 根据 `totalEpisodes` 判断是电影还是连续剧
   - 电影：只下载当前集
   - 连续剧：下载当前集 + 下 2 集

---

## ✅ 修复效果

### 修复前

- ❌ OrionTV 显示"没有可用的视频源"（资源列表接口返回空数组）
- ❌ 非官方资源无法播放（CORS 问题）
- ❌ 本地资源无法使用（OrionTV 无法检测）
- ❌ 电影自动下载会尝试下载不存在的集数

### 修复后

- ✅ OrionTV 正常显示可用视频源（资源列表接口返回正确配置）
- ✅ 非官方资源通过代理 URL 正常播放
- ✅ 本地资源优先使用，自动替换为本地播放 URL
- ✅ 电影只下载当前集，连续剧下载当前集 + 下 2 集

---

## 🧪 测试建议

### 测试场景 0：资源列表接口修复

1. 验证 `/api/search/resources` 接口返回正确的资源列表
2. 确认包含 `official` 和 `unofficial` 两个资源
3. OrionTV 不再显示"没有可用的视频源"错误

### 测试场景 1：非官方资源播放

1. 在 OrionTV 中搜索非官方资源
2. 验证返回的 `episodes` 数组中的 URL 是代理 URL（`/api/proxy/m3u8?url=...`）
3. 点击播放，验证可以正常播放

### 测试场景 2：本地资源播放

1. 在 MoonTV 中下载资源（至少下载第一集）
2. 在 OrionTV 中搜索相同资源
3. 验证返回的 `episodes[0]` 是本地播放 URL（`/api/local-video?path=...`）
4. 点击播放，验证使用本地资源播放

### 测试场景 3：自动下载优化

1. **电影测试**：
   - 在 OrionTV 中播放电影（`total_episodes = 1`）
   - 验证只下载当前集，不尝试下载第 2 集
2. **连续剧测试**：
   - 在 OrionTV 中播放连续剧（`total_episodes > 1`）
   - 验证下载当前集 + 下 2 集

---

## 📌 注意事项

1. **性能考虑**：

   - 官方资源不在 `search/one` 阶段批量解析，避免连续剧全量解析导致接口超时
   - 播放时按需解析：仅在用户实际播放某一集时触发解析（天然限流）
   - 本地资源检测通过 HTTP 调用，可能增加响应时间（目前只检测第一个 episode）
   - 异步触发下载，不阻塞搜索响应

2. **Edge Runtime 限制**：

   - 搜索接口使用 Edge Runtime，无法直接访问文件系统
   - 通过 HTTP 调用 `/api/local-resource` API 检测本地资源
   - 如果本地资源检测失败，自动降级到在线资源

3. **代理 URL 构建**：

   - 需要正确获取 `origin`，用于构建代理 URL
   - 如果无法获取 `origin`，代理转换会失败，保持原 URL

4. **自动下载触发**：
   - 只在播放记录保存时触发（`/api/playrecords` POST）
   - 需要播放记录中包含 `source` 和 `id` 字段
   - 需要启用本地存储功能（`LOCAL_STORAGE_ENABLED !== 'false'`）

---

## 🔗 相关文档

- [OrionTV 兼容性修复：官方资源 episodes 转换](./260119-OrionTV兼容性修复-官方资源episodes转换.md)
- [去除 config 依赖与本地下载播放回归修复总结](../session-summary/2026-01-16-去除config依赖与本地下载播放回归修复总结.md)
- [本地资源混合代理与自动下载修订总结](../session-summary/2026-01-15-本地资源混合代理与自动下载修订总结.md)

---

**修复时间**：2026-01-19
**影响范围**：`/api/search/resources`、`/api/search`、`/api/search/one`、`/api/playrecords` 接口，认证中间件
**兼容性**：向后兼容，不影响 MoonTV Web 端使用
