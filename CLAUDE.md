# CLAUDE.md - MoonTV Project Rules

> 细节规则见 `docs/rules/` 目录下对应文件，此处仅保留索引和关键规则。

## Project Overview

MoonTV is a Next.js video aggregation platform with multi-source search, playback, favorites, and watch history. Includes an Android TV native client.

## Tech Stack

- **Web**: Next.js (App Router) + React 18 + TypeScript 5.9 + Tailwind CSS + ArtPlayer + HLS.js
- **Storage**: localStorage / Redis / D1 / Upstash (unified via `src/lib/db.ts`)
- **Package Manager**: pnpm (v10.12.4)
- **Android TV**: Kotlin + Leanback + ExoPlayer + OkHttp → 详见 `android-tv.md`

## Directory Structure

```
src/
├── app/              # Next.js App Router (pages + API routes)
│   ├── api/          # Edge Runtime API routes
│   ├── play/         # Playback page
│   └── search/       # Search page
├── components/       # React components
└── lib/              # Business logic (downstream.ts, db.ts, config.ts, utils.ts)

android-tv/          # Android TV native app → 详见 android-tv.md
```

## Critical Rules

### Confirm Before Coding (Highest Priority)

- **不明确需求** → 必须先提问确认，再写代码
- **明确指令**（如 "run build and fix errors"）→ 直接执行

### Build Quality Gates

```bash
pnpm check:fast          # lint + typecheck（每次改动后运行）
pnpm run build           # production build（提交前必须通过）
```

- 修 build 错误时只做**最小改动**，不重构无关代码

### Git Commit

Format: `<type>(<scope>): <subject>`
Types: `feat`, `fix`, `docs`, `chore`, `style`, `refactor`, `ci`, `test`, `perf`, `revert`, `vercel`

- subject 小写，≤72 字符，无句号
- 中英文均可
- 禁止 `--no-verify`
- 提交前 build 必须通过

## Architecture (详见 `architecture.md`)

- API routes 薄层化，业务逻辑放 `lib/`
- DB 操作统一走 `lib/db.ts` 抽象层
- Server Components 优先，`'use client'` 仅用于交互组件
- RESTful API，Edge Runtime，`Promise.allSettled` 容错

## Security

- 敏感值用环境变量，禁止硬编码
- D1 用参数化查询，API 路由验证权限
- 禁止提交 `.env` 文件

## Coding Standards (详见 `coding-standards.md`)

- 函数必须有显式类型，避免 `any`
- 命名：文件 kebab-case，类 PascalCase，变量 camelCase，常量 UPPER_SNAKE_CASE
- API 路由必须 try/catch，客户端检查 `response.ok`
- 禁止记录敏感数据

## MoonTV Business (详见 `moontv-business.md`)

- 搜索：多源聚合，高优先级 3s 超时，≥10 结果提前返回，2h 缓存
- 播放：4s 测速超时，支持切源保持进度
- 存储：多后端统一抽象，支持跨设备同步

## Android TV (详见 `android-tv.md`)

- Kotlin + MVVM + OkHttp + ExoPlayer
- `FragmentActivity`（非 AppCompatActivity），`Theme.Leanback`
- 网络调用必须在 `Dispatchers.IO`
- `./gradlew assembleDebug` 必须通过
- Release: `gh release create v<ver>-android-tv <apk绝对路径> --title "..." --notes "..."`（单行命令）

## Documentation

- PRD: `docs/features/YYMMDD-功能名称-PRD.md`
- 技术文档: `docs/technical/`
- 规则细节: `docs/rules/`
- 先查已有文档再创建，一功能一文档

## Common Commands

```bash
# --- Web ---
pnpm dev                 # dev server (port 51000)
pnpm run build           # production build
pnpm check:fast          # lint + typecheck
pnpm lint:fix            # auto-fix
pnpm test                # Jest tests

# --- Android TV ---
cd android-tv && JAVA_HOME="/opt/homebrew/opt/openjdk@17" ./gradlew assembleDebug
```
