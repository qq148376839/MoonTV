# 边下载边播放实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框跟踪进度。

**目标：** 下载任务存在从第 0 段开始的连续完整分片时，可直接播放动态增长的本地 HLS 清单，下载完成后自动使用正式清单。

**非目标：** 不转码、不合并 MP4、不增加第二套下载任务、不允许播放器跨越缺失分片、不修改广告识别策略。

**架构：** 在下载事务层提供纯函数，将已过滤的源清单裁剪为连续可播放前缀并重写 KEY、MAP、分片地址。下载服务根据任务快照和实际文件生成动态 EVENT 清单；API 暴露该清单，任务卡显示“边下边播”入口。正式提交后 API 重定向现有正式播放清单。

**技术栈：** TypeScript、Next.js App Router、HLS/M3U8、Jest、React Testing Library。

---

### 任务 1：安全生成连续临时播放清单

**文件：**

- 修改：`src/lib/download-transaction.ts`
- 测试：`src/lib/__tests__/download-transaction.test.ts`

- [ ] 写失败测试：乱序完成 `[0,1,3]` 只输出 0、1；重写 KEY/MAP/segment；未完成时含 `PLAYLIST-TYPE:EVENT` 且不含 `ENDLIST`。
- [ ] 运行 `pnpm jest src/lib/__tests__/download-transaction.test.ts --runInBand`，确认因生成函数不存在而失败。
- [ ] 实现 `buildProgressivePlaylist`，只输出连续前缀并保留每段关联标签。
- [ ] 再次运行测试并确认通过。

### 任务 2：服务与 API 动态提供可播放清单

**文件：**

- 修改：`src/lib/download-service.ts`
- 创建：`src/app/api/download/[taskId]/play.m3u8/route.ts`
- 测试：`src/lib/__tests__/download-service-force.test.ts`
- 测试：`src/app/api/download/__tests__/progressive-playback.test.ts`

- [ ] 写失败测试：无连续分片返回未就绪；存在连续分片返回动态 EVENT 清单；完成任务返回正式清单重定向信息。
- [ ] 运行定向测试确认失败。
- [ ] 服务按 snapshot、generation 和实际非空文件计算连续前缀；API 返回 `application/vnd.apple.mpegurl`、`no-store`，完成后 302 到正式本地入口。
- [ ] 运行定向测试确认通过。

### 任务 3：任务卡播放入口

**文件：**

- 修改：`src/app/api/download/public-view.ts`
- 修改：`src/components/downloads/DownloadTaskCard.tsx`
- 测试：`src/components/downloads/__tests__/DownloadTaskCard.test.tsx`
- 测试：`src/app/api/download/__tests__/routes.test.ts`

- [ ] 写失败测试：仅当当前集从第 0 段开始连续可播时显示“边下边播”，点击调用原生播放器，浏览器环境回退打开动态清单。
- [ ] 运行定向测试确认失败。
- [ ] 在摘要中提供 `playable_episode`、`playable_segments`、`play_url`，任务卡增加播放按钮和缓冲分片文案。
- [ ] 运行定向测试确认通过。

### 任务 4：回归验证与部署

**文件：** 本计划涉及文件。

- [ ] 运行全部下载域测试、typecheck、严格 ESLint、Prettier、`git diff --check` 和生产构建。
- [ ] 审计只覆盖本计划范围，提交并推送功能分支。
- [ ] 构建精确 SHA GHCR 镜像，使用 NAS 技能串行部署 `moontv` 服务。
- [ ] 生产验证动态清单只暴露连续非空分片、两个下载任务不受影响、容器 revision/health/restart policy 正确。
