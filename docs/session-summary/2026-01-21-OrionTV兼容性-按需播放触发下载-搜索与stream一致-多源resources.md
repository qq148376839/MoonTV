# 2026-01-21 OrionTV 兼容性：按需播放触发下载 + 搜索与 stream 一致 + 多源 resources

## 📋 背景

在完成 `/api/search/one` 与官方按需解析播放后，逐步暴露出三个“OrionTV 侧契约差异”导致的实际问题：

- `/api/search` 与 MoonTV Web 端搜索结果不一致（Web 端依赖 `/api/search/stream` 多源 SSE）
- OrionTV 实际搜索路径是：先 `/api/search/resources` 拉资源列表，再逐源调用 `/api/search/one?q=...&resourceId=...`
- “可播放 != 可下载”：播放入口变为可控 URL 后，需要把“下载触发”移动到播放链路（方案 B）

---

## ✅ 本次修复目标

1. **搜索结果一致性**：`/api/search` 返回结果与 `/api/search/stream` 一致（避免“Web 能搜到、API 搜不到”）
2. **OrionTV 可搜到多源内容**：`/api/search/resources` 覆盖 stream 可能返回的非官方源 key（例如 `ruyi`）
3. **方案 B（播放触发下载）**：
   - 官方/非官方播放入口统一触发下载（默认后 3 集，可用 `LOCAL_STORAGE_AUTO_DOWNLOAD_NEXT` 覆盖）
   - 已完整下载的集：搜索阶段就返回本地 m3u8（不完整则在线）

---

## 🔧 关键实现

### 1) `/api/search` 与 Web/OrionTV 搜索一致（最终方案：直连 independent search，避免 SSE 缓冲）

最初方案是“聚合 `/api/search/stream` 的 SSE 返回 JSON”，但线上（Cloudflare/反代链路）可能对 SSE **缓冲**，导致 `/api/search` 读不到首包而误判为空。

最终落地改为：

- `/api/search` **不再自调用** `/api/search/stream`
- 直接并发调用：
  - `searchOfficialResources(query)`（默认 `NEXT_PUBLIC_OFFICIAL_SEARCH_URL`，未配置时直连 `789jx.riowang.win`）
  - `searchUnofficialResources(query)`（优先 `NEXT_PUBLIC_UNOFFICIAL_SEARCH_URL`，否则 `NEXT_PUBLIC_CF_SEARCH_WORKER_URL`，都未配则直连 `ss.riowang.win`）
- 合并 + 去重后返回 JSON（并保留 `Cache-Control: no-store`）
- **非官方 SSE 长连接**：当达到超时（Abort）时，返回 **已收集到的部分结果**，避免“超时就整段丢弃 -> results 为空”
- 增加 `X-MoonTV-Search-Rev` 响应头用于快速验证线上是否命中新代码

### 2) `/api/search/resources` 扩展多源 key

- OrionTV 会逐源调用 `/api/search/one`，因此 resources 必须包含 `ruyi` 等非官方源 key
- 否则会出现：`/api/search/stream` 能返回 `ruyi` 结果，但 OrionTV 永远不会去搜它

### 3) 方案 B：播放入口触发下载 + 本地完整集优先

- **官方**：`/api/official-play.m3u8`
  - 支持两种形式：
    - 新：`q/source/id/ep/total/url`（播放时触发下载 + 本地完整集优先）
    - 旧：仅 `url`（向后兼容，仅解析并 302，不触发下载）
- **非官方**：`/api/unofficial-play.m3u8`
  - 未下载：302 到 `/api/proxy/m3u8?url=...`
  - 已完整下载：302 到 `/api/local-video?path=...`
  - 播放时异步触发下载（当前集 + 后 3 集/可配置）

### 4) 搜索阶段本地优先（不完整则在线）

- `/api/local-resource` 补齐：
  - `downloaded_episodes[]`：每集是否完整下载（与 `isEpisodeDownloaded` 口径一致）
  - `episode_m3u8_paths[]`：每集对应 `episode_XX.m3u8` 路径
- `/api/search/one`：
  - 官方 episodes 全量改写为 `official-play.m3u8?...`
  - 非官方 episodes 全量改写为 `unofficial-play.m3u8?...`
  - 若该集完整下载：直接替换为 `local-video` 本地 m3u8

---

## 🧪 验证要点

- `/api/search?q=新僵尸先生粤语` 应返回 `ruyi` 结果（OrionTV 搜索页依赖此接口）
- `/api/search/resources` 必须包含 `ruyi`
- `/api/search/one?q=新僵尸先生粤语&resourceId=ruyi` 应返回结果且 `episodes[0]` 可播放
- `official-play.m3u8`：
  - `?url=...` 仍可直接 302（兼容）
  - 新参数形式可触发下载并优先本地

线上排障建议：

- `curl -i /api/search?...` 检查 `X-MoonTV-Search-Rev` 是否为最新
- 若 `results` 为空，优先查看服务端日志中：
  - `[searchUnofficialResources] 请求超时`
  - `[searchOfficialResources] SSE 解析后数据为空`

---

## 📝 涉及文件（核心）

- `src/app/api/search/route.ts`
- `src/app/api/search/resources/route.ts`
- `src/app/api/search/one/route.ts`
- `src/app/api/official-play.m3u8/route.ts`
- `src/app/api/unofficial-play.m3u8/route.ts`
- `src/app/api/local-resource/route.ts`
- `src/middleware.ts`

## 🚀 部署效率优化（Docker）

为减少 `docker compose build` 时间：

- 补齐 `.dockerignore`，忽略 `node_modules/`、`.next/`、`data/`、`.git/` 等，显著缩小 build context
- 部署流程可优先使用：
  - `git pull`
  - `docker compose up -d --build`
