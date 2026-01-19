# OrionTV 兼容性修复：官方资源 episodes 转换

## 📋 问题描述

### 现象
- OrionTV 使用 MoonTV 作为后端时，提示"没有可用的视频源，请检查或联系管理员"
- MoonTV 常规使用（Web 端）正常，但 OrionTV 无法播放

### 根本原因
1. **官方资源搜索返回格式问题**：
   - 官方资源搜索接口返回的 `episodes` 数组包含的是 HTML 页面 URL（如 `https://youku.com/video.html`）
   - 这些 URL 不是直接的 m3u8 播放链接，需要先通过 `/api/parse` 解析才能得到 m3u8 URL

2. **OrionTV 的期望**：
   - OrionTV 期望 `episodes` 数组中的每个元素都是可以直接播放的 m3u8 URL
   - OrionTV 直接使用 `episodes` 数组中的 URL 播放，不调用 `/api/detail` 或 `/api/parse`
   - 当 OrionTV 尝试播放 HTML URL 时，播放器无法识别，导致"没有可用的视频源"

3. **MoonTV Web 端的处理**：
   - MoonTV Web 端在播放时会检测 URL 类型，如果是 HTML URL 会自动调用 `/api/parse` 进行解析
   - 但 OrionTV 作为客户端，期望服务端直接返回可播放的 URL

---

## 🔧 修复方案

### 核心思路
在搜索接口返回结果前，对官方资源的 `episodes` 进行预处理，将 HTML URL 转换为 m3u8 URL。

### 实施内容

#### 1. 创建解析辅助函数 (`src/lib/parse-helper.ts`)
- `isLikelyWebPageUrl()`: 检测 URL 是否是 HTML 页面（需要解析）
- `parseToM3u8Url()`: 调用解析 API 将 HTML URL 转换为 m3u8 URL
- `convertOfficialEpisodes()`: 批量转换官方资源的 episodes（为了性能，只转换第一个需要解析的 URL）

#### 2. 修复 `/api/search` 接口 (`src/app/api/search/route.ts`)
- 在返回结果前，对官方资源的 `episodes` 进行预处理
- 检测 HTML URL 并转换为 m3u8 URL
- 处理内网地址，自动转换为代理 URL

#### 3. 修复 `/api/search/one` 接口 (`src/app/api/search/one/route.ts`)
- 同样对官方资源的 `episodes` 进行预处理
- 支持通过 `source_type === 'official'` 或 `official_parser` 配置判断是否为官方资源

---

## 📝 技术细节

### URL 检测逻辑
```typescript
function isLikelyWebPageUrl(url: string): boolean {
  // 检测：
  // 1. 路径以 .html 结尾
  // 2. 已知的视频网站域名（youku.com, iqiyi.com, v.qq.com, mgtv.com, bilibili.com）
}
```

### 解析流程
1. 检测第一个 episode 是否是 HTML URL
2. 如果是，调用解析 API (`/api/parse` 或直接调用解析服务)
3. 将解析后的 m3u8 URL 替换原 URL
4. 如果解析失败，返回空数组（避免返回不可播放的 URL）

### 性能优化
- **只转换第一个 episode**：OrionTV 通常只播放第一个 episode，所以只转换第一个可以提升性能
- **超时控制**：解析 API 调用设置 5 秒超时，避免阻塞
- **错误处理**：解析失败时返回空数组，避免返回不可播放的 URL

### 内网地址处理
- 检测解析后的 m3u8 URL 是否是内网地址（192.168.x.x, 10.x.x.x, 172.16-31.x.x 等）
- 如果是内网地址，自动转换为代理 URL (`/api/proxy/m3u8?url=...`)
- 确保 OrionTV 可以正常访问内网资源

---

## ✅ 修复效果

### 修复前
- OrionTV 搜索到官方资源，但 `episodes` 包含 HTML URL
- 播放器无法识别 HTML URL，提示"没有可用的视频源"

### 修复后
- OrionTV 搜索到官方资源，`episodes` 包含可直接播放的 m3u8 URL
- 播放器可以正常识别并播放
- 内网地址自动转换为代理 URL，确保可访问

---

## 🧪 测试建议

### 测试场景
1. **官方资源搜索**：
   - 使用 OrionTV 搜索官方资源（如优酷、爱奇艺等）
   - 验证返回的 `episodes` 数组包含 m3u8 URL 而非 HTML URL

2. **播放测试**：
   - 在 OrionTV 中点击播放官方资源
   - 验证可以正常播放，不再提示"没有可用的视频源"

3. **内网地址测试**：
   - 如果解析后的 m3u8 URL 是内网地址
   - 验证自动转换为代理 URL，可以正常访问

### 验证方法
1. 检查 `/api/search?q=xxx` 返回的 `episodes` 数组
2. 确认官方资源的 `episodes` 是 m3u8 URL 而非 HTML URL
3. 在 OrionTV 中测试播放功能

---

## 📌 注意事项

1. **性能影响**：
   - 解析 API 调用会增加响应时间（最多 5 秒）
   - 只转换第一个 episode，减少性能影响
   - 如果解析失败，返回空数组，避免返回不可播放的 URL

2. **向后兼容**：
   - 非官方资源的 `episodes` 不受影响（已经是 m3u8 URL）
   - MoonTV Web 端的播放逻辑不受影响（仍然支持自动解析）

3. **错误处理**：
   - 解析失败时返回空数组，OrionTV 会显示"没有可用的视频源"
   - 这比返回不可播放的 HTML URL 更好（至少不会误导用户）

---

## 🔗 相关文档

- [官方与非官方资源搜索独立 - 实施总结](../features/250201-官方与非官方资源搜索独立-实施总结.md)
- [去除 config 依赖与本地下载播放回归修复总结](../session-summary/2026-01-16-去除config依赖与本地下载播放回归修复总结.md)

---

**修复时间**：2026-01-19  
**影响范围**：`/api/search`、`/api/search/one` 接口  
**兼容性**：向后兼容，不影响 MoonTV Web 端使用
