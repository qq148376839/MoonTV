# 代码地图（CODE_MAP）

本文档记录 MoonTV 项目的代码结构和文件调用关系。

---

## 📁 项目结构

```
MoonTV/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # API 路由（Edge Runtime）
│   │   ├── play/               # 播放页面
│   │   ├── player/             # 直接播放路由 ⭐ 新增
│   │   │   └── page.tsx        # 播放页面组件
│   │   ├── search/             # 搜索页面
│   │   ├── login/              # 登录页面
│   │   └── admin/              # 管理后台页面
│   ├── components/             # React 组件
│   │   ├── PageLayout.tsx      # 页面布局组件（已更新）
│   │   └── ...
│   └── lib/                    # 工具库
│       ├── utils.ts            # 通用工具函数
│       └── ...
├── docs/                       # 项目文档
│   ├── features/               # 功能文档
│   ├── guides/                 # 使用指南
│   └── fixes/                  # 修复文档
└── ...
```

---

## 🆕 新增文件

### 2025-01-24

#### 页面组件

- `src/app/player/page.tsx` - 直接播放路由页面组件

#### 文档文件

- `docs/features/direct-player-prd.md` - PRD 文档
- `docs/features/250124-直接播放路由功能.md` - 实施总结
- `docs/guides/250124-直接播放路由-使用指南.md` - 使用指南
- `docs/fixes/250124-播放器容器初始化失败-FIX.md` - 修复文档

---

## 🔄 修改文件

### 2025-01-28

#### 核心修复

- `src/app/play/page.tsx` - 修复无限循环问题，添加初始化标志
- `src/lib/config.ts` - 修复 Edge Runtime 兼容性，添加运行时检查
- `src/lib/decrypt.ts` - 修复 Edge Runtime 兼容性，动态加载 crypto 模块

#### 依赖更新

- `package.json` - TypeScript 从 4.9.5 升级到 5.9.3

### 2025-01-24

#### 组件更新

- `src/components/PageLayout.tsx` - 添加 `/player` 路由支持返回按钮

---

## 📊 文件调用关系

### 直接播放路由 (`/player`)

```
src/app/player/page.tsx
├── ArtPlayer (播放器库)
├── HLS.js (HLS支持)
├── PageLayout (页面布局)
└── useSearchParams (URL参数解析)
```

### 页面布局组件

```
src/components/PageLayout.tsx
├── MobileHeader (移动端头部)
├── Sidebar (侧边栏)
├── MobileBottomNav (移动端底部导航)
├── BackButton (返回按钮)
├── ThemeToggle (主题切换)
└── UserMenu (用户菜单)
```

---

## 🔗 相关文档

- **功能文档**：[直接播放路由功能 - 实施总结](docs/features/250124-直接播放路由功能.md)
- **使用指南**：[直接播放路由 - 使用指南](docs/guides/250124-直接播放路由-使用指南.md)
- **修复文档**：[播放器容器初始化失败修复](docs/fixes/250124-播放器容器初始化失败-FIX.md)

---

**版本**：v1.2  
**最后更新**：2025-01-28
