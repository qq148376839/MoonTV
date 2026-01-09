# 更新日志（CHANGELOG）

本文档记录 MoonTV 项目的所有重要更新。

---

## 2025-01-30

### Docker 环境本地存储功能修复 ⭐ 关键修复

**问题描述**：在 Docker 环境中部署后，本地资源下载和播放功能无法使用，API 返回 503 错误。

**修复内容**：
1. ✅ 改进环境变量读取逻辑：Docker 环境中未设置 `LOCAL_STORAGE_ENABLED` 时默认启用
2. ✅ 增强错误处理和日志记录：添加详细的诊断信息（权限、用户信息等）
3. ✅ 更新 Docker 配置：确保 volume mount 有明确的读写权限
4. ✅ 创建诊断脚本：`scripts/check-docker-env.js` 用于排查环境问题

**相关文档**：
- 📄 [Docker 环境本地存储功能未启用修复](docs/fixes/250130-Docker环境本地存储功能未启用-FIX.md)

### 构建内存溢出问题修复 ⭐ 优化

**问题描述**：Next.js 构建过程在 TypeScript 类型检查阶段出现内存溢出错误。

**修复内容**：
1. ✅ 增加 Node.js 内存限制：构建脚本使用 6GB 内存限制
2. ✅ 添加跳过类型检查的构建选项：`build:skip-typecheck` 用于内存不足时快速构建
3. ✅ 优化 Next.js 配置：支持通过环境变量控制类型检查
4. ✅ 优化 Docker 构建配置：默认跳过类型检查，支持通过构建参数灵活配置

**相关文档**：
- 📄 [构建内存溢出问题修复](docs/fixes/250130-构建内存溢出问题-FIX.md)

---

## 2025-01-28

### 本地资源检测多平台优化 ⭐ 关键修复

**问题描述**：
- 前端页面疯狂刷新，无限循环请求
- Edge Runtime 构建错误：`eval('require')` 和 `crypto` 模块不可用
- TypeScript 版本过旧导致内存不足

**修复内容**：
1. ✅ **无限循环问题修复**：
   - 添加 `isInitializingRef` 跟踪初始化状态
   - 在 `useEffect` 中添加检查，避免重复调用 `updateVideoUrl`
   - 在 `initAll` 中设置和重置标志

2. ✅ **Edge Runtime 兼容性修复**：
   - 修复 `config.ts` 中的 `eval('require')` 问题，改为直接使用 `require`
   - 修复 `decrypt.ts` 中的 `crypto` 模块导入问题，改为动态加载
   - 添加 `isEdgeRuntime()` 检查函数，在 Edge Runtime 中跳过 Node.js API 调用

3. ✅ **TypeScript 升级**：
   - 从 4.9.5 升级到 5.9.3
   - 解决了类型检查内存不足的问题

**关键修复**：
- 修复前端无限循环问题，页面不再疯狂刷新
- 修复 Edge Runtime 构建错误，构建成功
- 升级 TypeScript，解决内存问题

**相关文档**：
- 📄 [本地资源检测多平台优化方案 - PRD](docs/optimization/250128-本地资源检测多平台优化方案-PRD.md)
- 📄 [本地资源检测多平台优化方案 - 实施总结](docs/optimization/250128-本地资源检测多平台优化方案-实施总结.md)
- 📄 [本地资源播放路径和 SSR 错误修复](docs/fixes/250128-本地资源播放路径和SSR错误修复-FIX.md)

---

## 2025-01-26

### 官方解析 API 层自动解密功能 ⭐ 新功能

**功能描述**：实现了官方解析 API 层自动解密功能，支持在 API 返回前自动解密官方解析资源，返回真实的 m3u8 或 MP4 播放地址。OrionTV 等第三方客户端可以直接使用解密后的 URL，无需客户端解密。

**实现内容**：
1. ✅ 代码重构：提取解密核心逻辑到独立模块
2. ✅ API 层自动解密：在 `searchFromApi` 和 `getDetailFromApi` 中自动解密
3. ✅ Edge Runtime 兼容：通过 HTTP API 调用解决 Edge Runtime 不支持 Node.js crypto 的问题
4. ✅ 错误处理：解密失败时清空 episodes，不返回无法播放的原始 URL
5. ✅ 修复 base URL 获取：`0.0.0.0` → `localhost`
6. ✅ 修复 401 错误：将 `/api/decrypt` 添加到 middleware 跳过认证列表
7. ✅ 修复配置传递：确保 `official_parser` 字段正确传递

**关键修复**：
- 修复 Edge Runtime 中 base URL 获取错误（`0.0.0.0` → `localhost`）
- 修复 `/api/decrypt` 路由被 middleware 拦截导致的 401 错误
- 修复解密失败时返回原始 URL 的问题（现在返回空数组）

**相关文档**：
- 📄 [官方解析 API 层自动解密功能 - PRD](docs/features/250126-官方解析API层自动解密功能-PRD.md)
- 📄 [官方解析 API 层自动解密功能 - 实现总结](docs/features/250126-官方解析API层自动解密功能-实现总结.md)
- 📄 [官方解析 API 层自动解密功能 - 测试验证](docs/features/250126-官方解析API层自动解密功能-测试验证.md)

---

## 2025-01-24

### 直接播放路由功能 ⭐ 新功能

**功能描述**：实现了直接播放路由功能，用户可以通过 `/player?url=<视频地址>` 的方式直接播放视频，无需经过搜索、详情页等复杂流程。

**实现内容**：
1. ✅ 创建 `/player` 路由页面
2. ✅ 实现URL参数解析功能（支持包含多个查询参数的URL）
3. ✅ 集成ArtPlayer播放器（复用现有配置）
4. ✅ 实现加载状态提示
5. ✅ 实现错误处理和重试机制
6. ✅ 确保响应式布局适配
7. ✅ 修复播放器容器初始化失败问题

**相关文档**：
- 📄 [直接播放路由功能 - PRD](docs/features/direct-player-prd.md)
- 📄 [直接播放路由功能 - 实施总结](docs/features/250124-直接播放路由功能.md)
- 📄 [直接播放路由 - 使用指南](docs/guides/250124-直接播放路由-使用指南.md)
- 📄 [播放器容器初始化失败修复](docs/fixes/250124-播放器容器初始化失败-FIX.md)

---

**版本**：v1.2  
**最后更新**：2025-01-28



