# 前端开发规范

## 🎨 Next.js 规范

### 页面组织

- ✅ 使用 App Router（`app/` 目录）
- ✅ 页面组件使用 Server Components（默认）
- ✅ 需要交互的组件使用 Client Components（`'use client'`）

### 组件规范

- ✅ 组件文件使用 PascalCase（如 `VideoCard.tsx`）
- ✅ 组件应该单一职责
- ✅ Props 必须定义 TypeScript 类型
- ✅ 组件放在 `src/components/` 目录

### 样式规范

- ✅ 使用 Tailwind CSS 进行样式设计
- ✅ 使用 Headless UI 组件库（如 Dialog、Menu）
- ✅ 使用 Heroicons 和 Lucide React 图标库
- ✅ 响应式设计使用 Tailwind 断点（sm, md, lg, xl）
- ✅ 支持深色模式（使用 `next-themes`）

## 🔄 状态管理

### 数据获取

- ✅ 使用 `fetch` API 进行数据获取（Server Components）
- ✅ 客户端数据获取直接使用 `fetch`（Client Components）
- ✅ API 调用使用相对路径（如 `/api/search`）

### 状态管理

- ✅ 简单状态使用 React Hooks（useState, useEffect）
- ✅ 复杂状态考虑使用 Context API（如 ThemeProvider、SiteProvider）
- ✅ 避免过度使用全局状态
- ✅ 播放器状态使用 useRef 管理（ArtPlayer 实例）

## 🎬 播放器规范

### ArtPlayer 集成

- ✅ 使用 ArtPlayer 5.x 作为播放器
- ✅ 集成 HLS.js 支持 HLS 流媒体
- ✅ 自定义 loader 实现去广告功能
- ✅ 监听播放事件（ready、timeupdate、ended、error）

### 播放源管理

- ✅ 支持多播放源切换
- ✅ 实现播放源测速和优选功能
- ✅ 保存播放记录和进度

## 🚀 前端优化

- ✅ 使用 Next.js 自动代码分割
- ✅ 图片使用 Next.js Image 组件或自定义 ImagePlaceholder
- ✅ 避免不必要的重新渲染（使用 useMemo、useCallback）
- ✅ 支持 PWA（离线缓存、安装到桌面）
- ✅ 使用虚拟滚动优化长列表（如需要）
