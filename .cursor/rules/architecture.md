# 项目架构规范

## 📐 目录结构

```
MoonTV/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # API 路由（Edge Runtime）
│   │   │   ├── search/         # 搜索聚合 API
│   │   │   ├── detail/         # 详情获取 API
│   │   │   ├── playrecords/   # 播放记录 API
│   │   │   ├── favorites/      # 收藏 API
│   │   │   └── admin/          # 管理后台 API
│   │   ├── play/               # 播放页面
│   │   ├── search/             # 搜索页面
│   │   ├── login/              # 登录页面
│   │   └── admin/              # 管理后台页面
│   ├── components/             # React 组件
│   │   ├── VideoCard.tsx       # 视频卡片组件
│   │   ├── EpisodeSelector.tsx # 集数选择器
│   │   ├── ContinueWatching.tsx # 继续观看组件
│   │   └── ...
│   └── lib/                    # 工具库
│       ├── downstream.ts       # 资源站 API 调用
│       ├── utils.ts            # 通用工具函数
│       ├── db.ts               # 数据库抽象层
│       ├── d1.db.ts            # D1 数据库实现
│       ├── redis.db.ts         # Redis 数据库实现
│       └── ...
├── public/                     # 静态资源
├── workers/                    # Cloudflare Workers
├── config.json                 # 资源站配置
└── docs/                       # 项目文档
```

## 🏗️ 核心架构

### Next.js App Router 架构

- **路由层** (`src/app/api/`) - Edge Runtime API 路由，处理搜索、详情、播放记录等
- **页面层** (`src/app/`) - Next.js 页面组件，使用 Server Components 和 Client Components
- **组件层** (`src/components/`) - 可复用的 React 组件
- **工具层** (`src/lib/`) - 业务逻辑和工具函数

### 数据存储架构

项目支持多种存储方式，通过统一的抽象层 (`src/lib/db.ts`) 访问：

- **localStorage** - 浏览器本地存储（默认）
- **Redis** - 分布式存储（支持多端同步）
- **Cloudflare D1** - 边缘数据库（Cloudflare Pages）
- **Upstash Redis** - 云端 Redis（Vercel/Zeabur）

### 架构原则

1. **分层架构**

   - ✅ API 路由层（`app/api/`）- 处理 HTTP 请求，使用 Edge Runtime
   - ✅ 业务逻辑层（`lib/`）- 资源搜索、测速、数据存储等核心功能
   - ✅ 组件层（`components/`）- UI 组件，遵循单一职责原则
   - ✅ 配置层（`config.json`）- 资源站配置和自定义分类

2. **依赖关系**

   - ✅ API 路由依赖业务逻辑层
   - ✅ 组件可以依赖业务逻辑层和工具层
   - ✅ 禁止组件之间的循环依赖

3. **代码组织**
   - ✅ API 路由文件应该简洁，业务逻辑放在 `lib/` 目录
   - ✅ 工具函数放在 `lib/utils.ts` 或独立的工具文件
   - ✅ 数据库操作通过统一的抽象层 (`lib/db.ts`) 访问
   - ✅ 资源站相关逻辑放在 `lib/downstream.ts`
