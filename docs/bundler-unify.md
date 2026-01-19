# dev / build 构建器统一说明（避免反复“修 dev 又坏 build”）

本项目目前 Next.js 版本为 `16.1.1`，`next build` 输出日志显示使用 **Turbopack**。

为避免出现 **dev 用 Webpack、build 用 Turbopack** 导致的行为差异/缓存混用问题，已将默认 `dev` 调整为与 `build` 一致（Turbopack）。

## 当前脚本约定

- **默认（推荐）**：dev + build 都走 Turbopack

  - `pnpm dev`
  - `pnpm build`

- **兜底**：dev 强制 Webpack（仅当 Turbopack 下出现阻塞问题时使用）
  - `pnpm dev:webpack`

## 切换构建器后的必做操作

无论从 Webpack 切到 Turbopack，还是反过来，**都建议先删除 `.next`** 再启动/构建，避免旧产物/缓存影响新的构建器：

- 删除：`.next`
- 然后重新执行：`pnpm dev` 或 `pnpm build`
