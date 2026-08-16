# 下载中心详细进度与可靠并发实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 MoonTV 增加全局公平分片并发、NAS 持久续传、详细可信进度、SSE 更新和可展开的下载诊断 UI。

**非目标：** 不实现边下边播、DASH、FFmpeg 转码、浏览器扩展、下载限速、启动后自动恢复、历史目录批量迁移或生产部署。

**架构：** 把当前 `DownloadService` 中的任务状态、持久化、调度和事件职责拆成独立模块；下载执行器通过一个全局公平调度器获取 TS/KEY/MAP 槽位，并将完成写盘后的进度写入 NAS 状态仓库。REST 提供快照和命令，SSE 推送增量变化，React 下载中心先加载摘要、展开时再加载详情。

**技术栈：** Next.js App Router、TypeScript、Node.js 文件系统、React、SSE、Jest、Testing Library、Tailwind CSS。

**设计依据：** `docs/superpowers/specs/2026-08-16-download-center-progress-and-concurrency-design.md`

---

## 文件结构

### 新建

- `src/lib/download-types.ts`：任务、剧集、工作项、快照、事件和命令的共享类型。
- `src/lib/download-progress.ts`：阶段权重、速度窗口、ETA 和任务聚合计算。
- `src/lib/download-state-store.ts`：NAS 原子持久化、重启恢复扫描、历史清理。
- `src/lib/download-scheduler.ts`：全局公平并发池、优先权重、暂停派发。
- `src/lib/download-event-bus.ts`：进程内事件序号、订阅和有限重放缓冲区。
- `src/app/api/download/[taskId]/detail/route.ts`：按需任务详情快照。
- `src/app/api/download/[taskId]/command/route.ts`：暂停、恢复、取消、清理、重试和优先命令。
- `src/app/api/download/events/route.ts`：SSE 事件流。
- `src/hooks/useDownloadTasks.ts`：摘要快照、SSE、断线轮询兜底。
- `src/components/downloads/DownloadTaskCard.tsx`：默认摘要卡。
- `src/components/downloads/DownloadTaskDetails.tsx`：展开详情容器。
- `src/components/downloads/EpisodeProgressPanel.tsx`：剧集阶段和失败状态。
- `src/components/downloads/SegmentDiagnostics.tsx`：分片状态图、并发槽和失败项。
- `src/lib/__tests__/download-progress.test.ts`
- `src/lib/__tests__/download-state-store.test.ts`
- `src/lib/__tests__/download-scheduler.test.ts`
- `src/lib/__tests__/download-event-bus.test.ts`
- `src/app/api/download/__tests__/routes.test.ts`
- `src/components/downloads/__tests__/DownloadTaskCard.test.tsx`
- `src/components/downloads/__tests__/DownloadTaskDetails.test.tsx`

### 修改

- `src/lib/download-service.ts`：改为编排执行器，接入状态仓库、调度器和事件总线。
- `src/lib/download-transaction.ts`：暴露完成写盘校验结果，支持恢复分片校验。
- `src/app/api/download/route.ts`：列表接口返回新版摘要，旧 POST/PATCH/DELETE 保持兼容。
- `src/components/DownloadTaskList.tsx`：改为组合新 hook 和下载卡组件。
- `src/app/offline/page.tsx`：保持标签结构，只调整下载列表容器。
- `src/app/api/server-config/route.ts`：公开脱敏后的全局并发配置。
- `.env.example`：记录 `LOCAL_STORAGE_DOWNLOAD_CONCURRENCY=8`。

## 实施约束

- 当前工作区包含上一轮未提交改动。每个任务开始前先运行 `git status --short`，只暂存本任务明确列出的文件。
- 不覆盖或回退用户已有改动。
- 每个代码任务先写失败测试，再写最少实现。
- 每次 commit 前运行该任务定向测试、`pnpm typecheck` 和相关文件 ESLint。
- 仓库 commit hook 会自动更新 `VERSION.txt` 和 `src/lib/version.ts`；若执行者不希望功能子提交产生版本噪音，应先由用户决定是否允许 `HUSKY=0 git commit`，不得自行绕过。

---

### 任务 1：定义下载状态、快照和命令契约

**文件：**

- 创建：`src/lib/download-types.ts`
- 创建：`src/lib/__tests__/download-progress.test.ts`
- 创建：`src/lib/download-progress.ts`

- [ ] **步骤 1：为阶段进度、速度和 ETA 编写失败测试**

```ts
import {
  aggregateTaskProgress,
  calculateEpisodeProgress,
  DownloadSpeedWindow,
} from '../download-progress';

describe('download progress', () => {
  test('weights media download as 85 percent', () => {
    expect(
      calculateEpisodeProgress({
        stage: 'downloading',
        completedBytes: 50,
        estimatedBytes: 100,
        completedSegments: 5,
        totalSegments: 10,
      })
    ).toEqual({ percent: 52.5, estimated: false });
  });

  test('falls back to segment counts when total bytes are unknown', () => {
    expect(
      calculateEpisodeProgress({
        stage: 'downloading',
        completedBytes: 50,
        estimatedBytes: null,
        completedSegments: 2,
        totalSegments: 4,
      })
    ).toEqual({ percent: 52.5, estimated: true });
  });

  test('uses a ten second window and hides unstable ETA', () => {
    const window = new DownloadSpeedWindow(10_000);
    window.record(0, 0);
    window.record(10_000, 10_000_000);
    expect(window.snapshot(20_000_000)).toEqual({
      bytesPerSecond: 1_000_000,
      etaSeconds: 10,
    });
    expect(new DownloadSpeedWindow(10_000).snapshot(100)).toEqual({
      bytesPerSecond: 0,
      etaSeconds: null,
    });
  });

  test('aggregates known episode sizes and marks unknown estimates', () => {
    expect(
      aggregateTaskProgress([
        { percent: 100, estimatedBytes: 100 },
        { percent: 50, estimatedBytes: 300 },
      ])
    ).toEqual({ percent: 62.5, estimated: false });
  });
});
```

- [ ] **步骤 2：运行测试并确认模块尚不存在**

运行：

```bash
pnpm exec jest --runInBand src/lib/__tests__/download-progress.test.ts
```

预期：FAIL，提示无法解析 `../download-progress`。

- [ ] **步骤 3：创建共享类型**

在 `src/lib/download-types.ts` 定义并导出以下契约：

```ts
export type DownloadStage =
  | 'queued'
  | 'preparing'
  | 'downloading'
  | 'validating'
  | 'committing'
  | 'completed'
  | 'pausing'
  | 'paused'
  | 'partial_failed'
  | 'cancelled_resumable'
  | 'recovery_wait';

export type DownloadUnitKind = 'segment' | 'key' | 'map';

export interface DownloadWorkItem {
  taskId: string;
  episode: number;
  generationId: string;
  kind: DownloadUnitKind;
  index: number;
  attempt: number;
}

export interface DownloadFailure {
  kind: DownloadUnitKind;
  index: number;
  category:
    | 'timeout'
    | 'http_auth'
    | 'http_server'
    | 'io'
    | 'empty'
    | 'length'
    | 'other';
  attempts: number;
  path: string;
  message: string;
}

export interface EpisodeDownloadState {
  episode: number;
  generationId: string;
  stage: DownloadStage;
  totalSegments: number;
  completedSegmentIndices: number[];
  failedSegmentIndices: number[];
  activeItems: DownloadWorkItem[];
  keyTotal: number;
  keyCompleted: number;
  mapTotal: number;
  mapCompleted: number;
  completedBytes: number;
  estimatedBytes: number | null;
  progress: number;
  progressEstimated: boolean;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
  failures: DownloadFailure[];
  oldEntryRetained: boolean;
  recoverable: boolean;
  refreshCount: number;
  updatedAt: number;
}

export interface DownloadTaskSnapshot {
  schemaVersion: 1;
  taskId: string;
  source: string;
  resourceId: string;
  title: string;
  year: string;
  poster?: string;
  episodeNumbers: number[];
  status:
    | 'pending'
    | 'downloading'
    | 'paused'
    | 'recovery_wait'
    | 'partial_completed'
    | 'completed'
    | 'failed'
    | 'cancelled_resumable';
  priority: 'normal' | 'high';
  currentEpisode: number | null;
  progress: number;
  progressEstimated: boolean;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
  completedBytes: number;
  createdAt: number;
  updatedAt: number;
  episodes: Record<string, EpisodeDownloadState>;
}

export type DownloadCommand =
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'cancel_and_clean'
  | 'retry_failed'
  | 'prioritize';
```

- [ ] **步骤 4：实现纯进度计算**

在 `src/lib/download-progress.ts` 实现：

```ts
const STAGE_BASE: Record<string, number> = {
  queued: 0,
  preparing: 0,
  downloading: 10,
  validating: 95,
  committing: 97.5,
  completed: 100,
};

export function calculateEpisodeProgress(input: {
  stage: string;
  completedBytes: number;
  estimatedBytes: number | null;
  completedSegments: number;
  totalSegments: number;
}): { percent: number; estimated: boolean } {
  if (input.stage !== 'downloading') {
    return { percent: STAGE_BASE[input.stage] ?? 0, estimated: false };
  }
  const byBytes =
    input.estimatedBytes && input.estimatedBytes > 0
      ? input.completedBytes / input.estimatedBytes
      : null;
  const ratio =
    byBytes ??
    (input.totalSegments > 0
      ? input.completedSegments / input.totalSegments
      : 0);
  return {
    percent: Math.min(95, 10 + Math.max(0, Math.min(1, ratio)) * 85),
    estimated: byBytes === null,
  };
}
```

同文件实现 `DownloadSpeedWindow`，只保留最近 10 秒累计样本；少于两个样本或速度为零时 `etaSeconds` 返回 `null`。实现 `aggregateTaskProgress`，已知预计字节时按字节加权，否则等权且标记 estimated。

- [ ] **步骤 5：运行测试、类型和 lint**

```bash
pnpm exec jest --runInBand src/lib/__tests__/download-progress.test.ts
pnpm typecheck
pnpm exec eslint --max-warnings=0 src/lib/download-types.ts src/lib/download-progress.ts src/lib/__tests__/download-progress.test.ts
```

预期：全部退出码为 0。

- [ ] **步骤 6：提交任务 1**

```bash
git add src/lib/download-types.ts src/lib/download-progress.ts src/lib/__tests__/download-progress.test.ts
git commit -m "feat(download): define progress state model"
```

---

### 任务 2：实现 NAS 原子任务状态仓库

**文件：**

- 创建：`src/lib/download-state-store.ts`
- 创建：`src/lib/__tests__/download-state-store.test.ts`

- [ ] **步骤 1：编写状态持久化和重启恢复失败测试**

```ts
test('writes snapshots atomically without signed URLs', () => {
  const store = new DownloadStateStore(root);
  store.saveTask(snapshotWithFailure('https://cdn/a.ts?token=secret#x'));
  const raw = fs.readFileSync(
    path.join(root, 'download-tasks/t1/task.json'),
    'utf8'
  );
  expect(raw).not.toContain('token=secret');
  expect(raw).not.toContain('#x');
  expect(
    fs.existsSync(path.join(root, 'download-tasks/t1/task.json.tmp'))
  ).toBe(false);
});

test('loads unfinished tasks into recovery_wait without starting them', () => {
  const store = new DownloadStateStore(root);
  store.saveTask(activeSnapshot());
  const [loaded] = store.loadRecoverableTasks();
  expect(loaded.status).toBe('recovery_wait');
  expect(loaded.episodes['1'].stage).toBe('recovery_wait');
});

test('keeps completed history for seven days and failures for thirty', () => {
  const store = new DownloadStateStore(root);
  seedExpiredAndFreshTasks(store);
  expect(store.cleanupHistory(now)).toEqual({
    removed: ['completed-old', 'failed-old'],
  });
});
```

- [ ] **步骤 2：运行测试验证类尚不存在**

```bash
pnpm exec jest --runInBand src/lib/__tests__/download-state-store.test.ts
```

预期：FAIL，提示 `DownloadStateStore` 未定义。

- [ ] **步骤 3：实现目录和原子 JSON 写入**

在 `src/lib/download-state-store.ts` 实现：

```ts
export class DownloadStateStore {
  constructor(private readonly storageRoot: string) {}

  private taskDir(taskId: string) {
    return path.join(this.storageRoot, 'download-tasks', taskId);
  }

  private writeJsonAtomic(filePath: string, value: unknown) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temporary, filePath);
  }

  saveTask(snapshot: DownloadTaskSnapshot) {
    const { episodes, ...task } = sanitizeSnapshot(snapshot);
    this.writeJsonAtomic(path.join(this.taskDir(task.taskId), 'task.json'), {
      ...task,
      episodes: Object.fromEntries(
        Object.values(episodes).map((episode) => [
          String(episode.episode),
          summarizeEpisode(episode),
        ])
      ),
    });
    for (const episode of Object.values(episodes)) {
      this.writeJsonAtomic(
        path.join(
          this.taskDir(task.taskId),
          'episodes',
          `${String(episode.episode).padStart(2, '0')}.json`
        ),
        sanitizeEpisode(episode)
      );
    }
  }
}
```

`sanitizeSnapshot`、`sanitizeEpisode` 必须对 `message` 和 `path` 调用现有 `redactUrlsInText` / `redactDownloadUrl`。公开状态 JSON 不新增源 URL 字段。

- [ ] **步骤 4：实现加载、恢复标记和历史清理**

实现 `loadTask`、`listTasks`、`loadRecoverableTasks`、`deleteTaskState` 和 `cleanupHistory(now)`。加载到的活动状态统一转换为 `recovery_wait`；清理只删除 `download-tasks/<id>`，不得操作资源正式目录。

- [ ] **步骤 5：运行定向验证**

```bash
pnpm exec jest --runInBand src/lib/__tests__/download-state-store.test.ts src/lib/__tests__/download-transaction.test.ts
pnpm typecheck
pnpm exec eslint --max-warnings=0 src/lib/download-state-store.ts src/lib/__tests__/download-state-store.test.ts
```

预期：全部通过。

- [ ] **步骤 6：提交任务 2**

```bash
git add src/lib/download-state-store.ts src/lib/__tests__/download-state-store.test.ts
git commit -m "feat(download): persist resumable task state"
```

---

### 任务 3：实现全局公平分片调度器

**文件：**

- 创建：`src/lib/download-scheduler.ts`
- 创建：`src/lib/__tests__/download-scheduler.test.ts`

- [ ] **步骤 1：编写并发上限、公平性、暂停和优先级失败测试**

```ts
test('never exceeds the global concurrency limit', async () => {
  const tracker = new ActiveTracker();
  const scheduler = new DownloadScheduler({ concurrency: 3 });
  enqueueTasks(scheduler, ['a', 'b'], 10, tracker.operation);
  await scheduler.onIdle();
  expect(tracker.maximum).toBe(3);
});

test('round robins work across active tasks', async () => {
  const order: string[] = [];
  const scheduler = new DownloadScheduler({ concurrency: 1 });
  enqueueNamed(scheduler, 'a', 3, order);
  enqueueNamed(scheduler, 'b', 2, order);
  await scheduler.onIdle();
  expect(order.slice(0, 4)).toEqual(['a', 'b', 'a', 'b']);
});

test('pausing stops new dispatch but lets active work finish', async () => {
  const gate = deferred<void>();
  const scheduler = new DownloadScheduler({ concurrency: 1 });
  scheduler.enqueue(item('a', 0), () => gate.promise);
  scheduler.enqueue(item('a', 1), jest.fn());
  scheduler.pauseTask('a');
  gate.resolve();
  await flushPromises();
  expect(scheduler.getTaskStats('a')).toMatchObject({ active: 0, queued: 1 });
});

test('priority changes weight but not concurrency', async () => {
  const scheduler = new DownloadScheduler({ concurrency: 2 });
  scheduler.setPriority('a', 'high');
  // 断言 A 在两个轮次内获得更多派发，但 active 总数不超过 2。
});
```

- [ ] **步骤 2：运行测试验证调度器不存在**

```bash
pnpm exec jest --runInBand src/lib/__tests__/download-scheduler.test.ts
```

预期：FAIL，无法解析 `../download-scheduler`。

- [ ] **步骤 3：实现带权轮转队列**

`DownloadScheduler` 必须提供以下接口：

```ts
export class DownloadScheduler {
  constructor(options: { concurrency: number });
  enqueue<T>(item: DownloadWorkItem, operation: () => Promise<T>): Promise<T>;
  pauseTask(taskId: string): void;
  resumeTask(taskId: string): void;
  cancelQueued(taskId: string): DownloadWorkItem[];
  setPriority(taskId: string, priority: 'normal' | 'high'): void;
  getGlobalStats(): { concurrency: number; active: number; queued: number };
  getTaskStats(taskId: string): { active: number; queued: number };
  onIdle(): Promise<void>;
}
```

内部使用 `Map<taskId, QueueEntry[]>` 保存每任务队列，维护轮转游标；normal 每轮权重 1，high 每轮权重 2。每个 operation 在 `finally` 中释放槽位并继续派发。所有任务共享此唯一实例。

- [ ] **步骤 4：验证调度器**

```bash
pnpm exec jest --runInBand src/lib/__tests__/download-scheduler.test.ts
pnpm typecheck
pnpm exec eslint --max-warnings=0 src/lib/download-scheduler.ts src/lib/__tests__/download-scheduler.test.ts
```

预期：并发、公平、暂停和优先级测试全部通过。

- [ ] **步骤 5：提交任务 3**

```bash
git add src/lib/download-scheduler.ts src/lib/__tests__/download-scheduler.test.ts
git commit -m "feat(download): add fair global segment scheduler"
```

---

### 任务 4：将下载执行器接入调度、进度和持久续传

**文件：**

- 修改：`src/lib/download-service.ts`
- 修改：`src/lib/download-transaction.ts`
- 修改：`src/lib/__tests__/download-service-force.test.ts`
- 修改：`src/lib/__tests__/download-transaction.test.ts`

- [ ] **步骤 1：补充执行器集成失败测试**

新增以下测试场景：

```ts
test('counts a segment only after finish and persists its index', async () => {
  const service = createServiceWithControlledWriter();
  const task = await service.startFixtureTask(fixturePlaylist(2));
  await service.writer.writeResponse(0, 'segment-zero');
  expect(
    service.snapshot(task.id).episodes['1'].completedSegmentIndices
  ).toEqual([0]);
});

test('retries only failed segments and preserves successful files', async () => {
  const service = createServiceWithResponses(['ok', timeout(), 'ok']);
  await service.runEpisode();
  service.setResponsesForRetry(['fixed']);
  await service.retryFailed('task-1');
  expect(service.requestCountFor(0)).toBe(1);
  expect(service.requestCountFor(1)).toBeGreaterThan(1);
});

test('keeps old entry when any key map or segment exhausts retries', async () => {
  const old = seedActivePlaylist();
  await expect(service.runFixture(keyFailureFixture())).rejects.toThrow();
  expect(readActivePlaylist()).toBe(old);
  expect(service.snapshot('task-1').episodes['1'].stage).toBe('partial_failed');
});

test('loads persisted work as recovery_wait without fetching', () => {
  const fetchSpy = jest.spyOn(global, 'fetch');
  const service = createServiceFromPersistedActiveTask();
  expect(service.getTask('task-1')?.status).toBe('recovery_wait');
  expect(fetchSpy).not.toHaveBeenCalled();
});
```

- [ ] **步骤 2：运行集成测试确认失败**

```bash
pnpm exec jest --runInBand src/lib/__tests__/download-service-force.test.ts src/lib/__tests__/download-transaction.test.ts
```

预期：新状态和恢复接口尚不存在导致失败。

- [ ] **步骤 3：替换每实例 `p-limit` 为全局调度器**

在 `DownloadService` 构造函数注入或创建单例依赖：

```ts
constructor(deps: DownloadServiceDependencies = defaultDependencies()) {
  this.storageManager = deps.storageManager;
  this.stateStore = deps.stateStore;
  this.scheduler = deps.scheduler;
  this.eventBus = deps.eventBus;
  this.restoreSnapshots();
}
```

删除 `tsLimit` 和每任务独立分片并发。TS、KEY、MAP 下载都改为：

```ts
await this.scheduler.enqueue(workItem, async () => {
  const bytes = await this.downloadFile(url, targetPath);
  this.markUnitCompleted(task, episode, workItem, bytes);
  this.persistAndPublish(task);
});
```

- [ ] **步骤 4：实现原子完成、失败分类和三次重试**

将下载文件流程收敛为一次 attempt：只有 writable `finish`、非空和长度匹配后返回成功。外层 `runWorkItem` 最多执行三次，并把错误映射到 `DownloadFailure.category`。退避为 500ms、1000ms、2000ms，并加入 0–250ms 随机抖动；测试中注入 timer 和 random 以避免真实等待。

- [ ] **步骤 5：实现 401/403 单次刷新和安全匹配**

同一剧集首次出现 `http_auth` 时调用现有源详情获取逻辑刷新播放列表，按媒体序号、KEY/MAP 序号和初始化段关系重新生成 URL。新旧结构不一致时写入 `partial_failed`，不复用或混合提交。

- [ ] **步骤 6：实现暂停、恢复、取消和仅重试失败项**

在 `DownloadService` 提供：

```ts
pauseTask(taskId: string): CommandResult;
resumeTask(taskId: string): Promise<CommandResult>;
cancelTask(taskId: string, clean: boolean): Promise<CommandResult>;
retryFailed(taskId: string): Promise<CommandResult>;
prioritizeTask(taskId: string): CommandResult;
```

暂停先设 `pausing`；调度器 active 归零后设 `paused`。恢复 `recovery_wait` 时先调用 `validateResumeFiles`，再刷新地址。默认取消保留 generation；clean 只删除未提交 generation 和任务状态。

- [ ] **步骤 7：持续写入进度快照**

每次阶段变化、分片批量完成、失败、速度窗口更新和命令执行后调用统一方法：

```ts
private persistAndPublish(task: DownloadTaskSnapshot, eventType = 'task.updated') {
  recalculateTaskSnapshot(task);
  this.stateStore.saveTask(task);
  this.eventBus.publish(eventType, summarizeTask(task));
}
```

分片快速完成时按 250ms 或 20 个变化合并持久化和事件，任务暂停、失败、完成和提交必须立即 flush。

- [ ] **步骤 8：运行执行器验证**

```bash
pnpm exec jest --runInBand src/lib/__tests__/download-service-force.test.ts src/lib/__tests__/download-transaction.test.ts src/lib/__tests__/download-scheduler.test.ts src/lib/__tests__/download-state-store.test.ts
pnpm typecheck
pnpm exec eslint --max-warnings=0 src/lib/download-service.ts src/lib/download-transaction.ts
```

预期：全部通过，旧入口保留断言成立。

- [ ] **步骤 9：提交任务 4**

```bash
git add src/lib/download-service.ts src/lib/download-transaction.ts src/lib/__tests__/download-service-force.test.ts src/lib/__tests__/download-transaction.test.ts
git commit -m "feat(download): add resumable scheduled execution"
```

---

### 任务 5：实现事件总线、REST 详情和 SSE

**文件：**

- 创建：`src/lib/download-event-bus.ts`
- 创建：`src/lib/__tests__/download-event-bus.test.ts`
- 创建：`src/app/api/download/[taskId]/detail/route.ts`
- 创建：`src/app/api/download/[taskId]/command/route.ts`
- 创建：`src/app/api/download/events/route.ts`
- 创建：`src/app/api/download/__tests__/routes.test.ts`
- 修改：`src/app/api/download/route.ts`

- [ ] **步骤 1：编写事件重放和 API 脱敏失败测试**

```ts
test('replays events after the supplied event id', () => {
  const bus = new DownloadEventBus(100);
  bus.publish('task.updated', { taskId: 'a' });
  const second = bus.publish('episode.updated', { taskId: 'a', episode: 1 });
  expect(bus.since(second.id - 1)).toEqual([second]);
});

test('detail API returns aggregate ranges and redacted failures', async () => {
  mockDetail(fixtureDetail('https://cdn/a.ts?token=secret#x'));
  const response = await GET_DETAIL(requestFor('task-1'), contextFor('task-1'));
  const body = await response.json();
  expect(body.episodes[0].segment_ranges.completed).toEqual([
    [0, 12],
    [15, 20],
  ]);
  expect(JSON.stringify(body)).not.toContain('token=secret');
});

test('rejects commands that conflict with current state', async () => {
  mockTaskState('completed');
  const response = await POST_COMMAND(
    commandRequest('pause'),
    contextFor('task-1')
  );
  expect(response.status).toBe(409);
});
```

- [ ] **步骤 2：运行测试确认接口不存在**

```bash
pnpm exec jest --runInBand src/lib/__tests__/download-event-bus.test.ts src/app/api/download/__tests__/routes.test.ts
```

预期：FAIL，缺少事件总线和路由模块。

- [ ] **步骤 3：实现有限事件重放缓冲**

```ts
export interface DownloadEvent {
  id: number;
  type: 'task.updated' | 'episode.updated' | 'segment.batch' | 'task.removed';
  data: unknown;
  createdAt: number;
}

export class DownloadEventBus {
  publish(type: DownloadEvent['type'], data: unknown): DownloadEvent;
  subscribe(listener: (event: DownloadEvent) => void): () => void;
  since(lastEventId: number): DownloadEvent[] | null;
}
```

保留最近 1000 个事件；请求序号早于缓冲区时 `since` 返回 `null`，通知客户端读取 REST 快照。

- [ ] **步骤 4：实现摘要、详情和命令 API**

`GET /api/download` 映射 `DownloadTaskSnapshot` 为摘要，不返回完整 episodes。详情路由返回按区间压缩的分片状态、活动槽和失败列表。命令路由解析 `{ action: DownloadCommand }`，调用服务并将非法状态映射为 409。

- [ ] **步骤 5：实现 SSE 路由**

SSE 路由使用 `ReadableStream`：

```ts
const stream = new ReadableStream({
  start(controller) {
    const send = (event: DownloadEvent) =>
      controller.enqueue(
        encoder.encode(
          `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(
            event.data
          )}\n\n`
        )
      );
    const unsubscribe = bus.subscribe(send);
    request.signal.addEventListener('abort', () => {
      unsubscribe();
      controller.close();
    });
  },
});
```

处理 `Last-Event-ID`：可重放则先发送缺失事件；不可重放则发送 `snapshot.required`。每 15 秒发送注释心跳。响应头包含 `Content-Type: text/event-stream`、`Cache-Control: no-cache, no-transform` 和 `X-Accel-Buffering: no`。

- [ ] **步骤 6：运行 API 验证**

```bash
pnpm exec jest --runInBand src/lib/__tests__/download-event-bus.test.ts src/app/api/download/__tests__/routes.test.ts
pnpm typecheck
pnpm exec eslint --max-warnings=0 src/lib/download-event-bus.ts src/app/api/download/route.ts 'src/app/api/download/[taskId]/detail/route.ts' 'src/app/api/download/[taskId]/command/route.ts' src/app/api/download/events/route.ts
```

预期：事件重放、快照要求、409 和脱敏测试通过。

- [ ] **步骤 7：提交任务 5**

```bash
git add src/lib/download-event-bus.ts src/lib/__tests__/download-event-bus.test.ts src/app/api/download
git commit -m "feat(download): expose detailed progress events"
```

---

### 任务 6：实现下载摘要卡和展开诊断 UI

**文件：**

- 创建：`src/hooks/useDownloadTasks.ts`
- 创建：`src/components/downloads/DownloadTaskCard.tsx`
- 创建：`src/components/downloads/DownloadTaskDetails.tsx`
- 创建：`src/components/downloads/EpisodeProgressPanel.tsx`
- 创建：`src/components/downloads/SegmentDiagnostics.tsx`
- 创建：`src/components/downloads/__tests__/DownloadTaskCard.test.tsx`
- 创建：`src/components/downloads/__tests__/DownloadTaskDetails.test.tsx`
- 修改：`src/components/DownloadTaskList.tsx`

- [ ] **步骤 1：编写摘要卡和展开详情失败测试**

```tsx
test('shows current episode stage speed eta and segment counts', () => {
  render(<DownloadTaskCard task={summaryFixture()} onCommand={jest.fn()} />);
  expect(screen.getByText('第 1 集 · 下载分片')).toBeInTheDocument();
  expect(screen.getByText('318 / 504 分片')).toBeInTheDocument();
  expect(screen.getByText('8.4 MB/s')).toBeInTheDocument();
  expect(screen.getByText('剩余 01:42')).toBeInTheDocument();
});

test('loads details only when the card expands', async () => {
  const loadDetails = jest.fn().mockResolvedValue(detailFixture());
  render(
    <DownloadTaskCard
      task={summaryFixture()}
      loadDetails={loadDetails}
      onCommand={jest.fn()}
    />
  );
  expect(loadDetails).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '展开详情' }));
  await waitFor(() => expect(loadDetails).toHaveBeenCalledWith('task-1'));
});

test('shows polling fallback without marking the task failed', () => {
  render(
    <DownloadTaskListView connection='polling' tasks={[summaryFixture()]} />
  );
  expect(screen.getByText(/实时连接已断开，正在轮询/)).toBeInTheDocument();
  expect(screen.queryByText('下载失败')).not.toBeInTheDocument();
});
```

- [ ] **步骤 2：运行组件测试确认组件不存在**

```bash
pnpm exec jest --runInBand src/components/downloads/__tests__/DownloadTaskCard.test.tsx src/components/downloads/__tests__/DownloadTaskDetails.test.tsx
```

预期：FAIL，组件模块不存在。

- [ ] **步骤 3：实现摘要/SSE hook**

`useDownloadTasks` 首次请求 `/api/download`，随后创建 `EventSource('/api/download/events')`。事件到达时按 task ID 合并摘要；收到 `snapshot.required` 重新请求快照。`onerror` 关闭 EventSource，状态改为 `polling` 并每 2 秒请求摘要；下一轮重新尝试 SSE。页面隐藏时轮询降为 8 秒。

hook 返回：

```ts
{
  tasks,
  connection: 'connecting' | 'live' | 'polling',
  error,
  loadDetails(taskId),
  command(taskId, action),
  refresh(),
}
```

- [ ] **步骤 4：实现摘要卡**

按批准原型实现：标题、年份、状态、当前集、阶段、进度条、分片数、速度、ETA、写盘大小和状态对应操作。速度为零或 ETA 为 null 时显示 `—`，不得伪造数值。

- [ ] **步骤 5：实现展开详情**

`DownloadTaskDetails` 组合：

- `EpisodeProgressPanel`：五阶段、每集状态、旧入口和广告过滤摘要。
- `SegmentDiagnostics`：状态图、成功/活动/等待/重试/失败计数、当前槽位、失败项和仅重试失败按钮。

失败路径仅显示 API 已脱敏值。分片图以区间生成视觉块，不渲染数百行 URL。

- [ ] **步骤 6：替换旧列表内部卡片**

`DownloadTaskList.tsx` 只保留列表空态、连接提示和新 hook/组件组合；删除原有 2 秒固定轮询和内联任务卡 JSX。`offline/page.tsx` 的“下载中 / 已下载”标签结构保持不变。

- [ ] **步骤 7：运行 UI 验证**

```bash
pnpm exec jest --runInBand src/components/downloads/__tests__/DownloadTaskCard.test.tsx src/components/downloads/__tests__/DownloadTaskDetails.test.tsx src/components/__tests__/DownloadConfirmDialog.test.tsx
pnpm typecheck
pnpm exec eslint --max-warnings=0 src/hooks/useDownloadTasks.ts src/components/DownloadTaskList.tsx src/components/downloads
```

预期：摘要、按需加载、SSE 降级、移动折叠和命令按钮测试通过。

- [ ] **步骤 8：提交任务 6**

```bash
git add src/hooks/useDownloadTasks.ts src/components/DownloadTaskList.tsx src/components/downloads
git commit -m "feat(download): add detailed progress interface"
```

---

### 任务 7：配置、历史兼容和任务清理

**文件：**

- 修改：`src/app/api/server-config/route.ts`
- 修改：`.env.example`
- 修改：`src/lib/download-service.ts`
- 修改：`src/lib/download-state-store.ts`
- 修改：`src/lib/__tests__/download-state-store.test.ts`

- [ ] **步骤 1：编写配置边界和旧任务兼容失败测试**

```ts
test.each([
  ['1', 2],
  ['8', 8],
  ['99', 16],
  ['invalid', 8],
])('normalizes concurrency %s to %i', (raw, expected) => {
  expect(readDownloadConcurrency(raw)).toBe(expected);
});

test('shows in-memory legacy tasks without persisting or migrating media', () => {
  const service = createServiceWithLegacyTask();
  expect(service.getTaskSummary('legacy')).toMatchObject({
    progressEstimated: true,
  });
  expect(fs.readdirSync(resourceRoot)).toEqual(originalResourceFiles);
});

test('history cleanup never removes resource directories', () => {
  store.cleanupHistory(now);
  expect(fs.existsSync(activeMovieDirectory)).toBe(true);
});
```

- [ ] **步骤 2：运行测试确认边界尚未实现**

```bash
pnpm exec jest --runInBand src/lib/__tests__/download-state-store.test.ts src/lib/__tests__/download-service-force.test.ts
```

预期：新配置标准化和 legacy summary 断言失败。

- [ ] **步骤 3：实现配置读取**

新增纯函数：

```ts
export function readDownloadConcurrency(
  raw = process.env.LOCAL_STORAGE_DOWNLOAD_CONCURRENCY
) {
  const parsed = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(parsed)) return 8;
  return Math.max(2, Math.min(16, parsed));
}
```

`.env.example` 增加：

```dotenv
# 全局 TS/KEY/MAP 下载槽位，范围 2-16
LOCAL_STORAGE_DOWNLOAD_CONCURRENCY=8
```

server-config 仅返回归一化后的并发数字，不返回路径或敏感环境变量。

- [ ] **步骤 4：实现旧任务和保留期兼容**

没有新状态文件的现有内存任务继续通过摘要适配器展示，`progressEstimated: true`。旧下载目录不创建任务状态、不移动文件；下一次安全重下时才创建新模型。启动和每日首次列表请求调用一次 `cleanupHistory`，只删除状态目录。

- [ ] **步骤 5：运行兼容验证**

```bash
pnpm exec jest --runInBand src/lib/__tests__/download-state-store.test.ts src/lib/__tests__/download-service-force.test.ts
pnpm typecheck
pnpm exec eslint --max-warnings=0 src/lib/download-service.ts src/lib/download-state-store.ts src/app/api/server-config/route.ts
```

预期：配置夹取、旧目录不迁移和清理不删影片测试通过。

- [ ] **步骤 6：提交任务 7**

```bash
git add .env.example src/app/api/server-config/route.ts src/lib/download-service.ts src/lib/download-state-store.ts src/lib/__tests__/download-state-store.test.ts src/lib/__tests__/download-service-force.test.ts
git commit -m "feat(download): add concurrency config and cleanup policy"
```

---

### 任务 8：端到端回归、范围审计和交付

**文件：**

- 修改：仅修复本计划测试暴露出的本计划范围文件。
- 检查：`docs/superpowers/specs/2026-08-16-download-center-progress-and-concurrency-design.md`

- [ ] **步骤 1：运行所有下载相关测试**

```bash
pnpm exec jest --runInBand \
  src/lib/__tests__/download-progress.test.ts \
  src/lib/__tests__/download-state-store.test.ts \
  src/lib/__tests__/download-scheduler.test.ts \
  src/lib/__tests__/download-event-bus.test.ts \
  src/lib/__tests__/download-transaction.test.ts \
  src/lib/__tests__/download-service-force.test.ts \
  src/lib/__tests__/ad-filter.test.ts \
  src/app/api/download/__tests__/routes.test.ts \
  src/components/downloads/__tests__/DownloadTaskCard.test.tsx \
  src/components/downloads/__tests__/DownloadTaskDetails.test.tsx \
  src/components/__tests__/DownloadConfirmDialog.test.tsx
```

预期：全部测试通过。

- [ ] **步骤 2：运行静态检查和生产构建**

```bash
pnpm typecheck
pnpm lint:strict
pnpm format:check
git diff --check
pnpm run build:skip-typecheck
```

预期：命令退出码均为 0；现有 Turbopack 动态文件匹配警告可记录但不得隐藏新增错误。

- [ ] **步骤 3：执行故障注入验收**

使用测试 fixture 或本地测试服务器逐项确认：

```text
1. 两个任务并行时全局 active <= 配置值。
2. 分片写盘延迟时完成计数不提前增加。
3. TS、KEY、MAP 分别失败时旧 m3u8 内容不变。
4. 暂停后 queued 不再减少，active 归零后状态才为 paused。
5. 重建 DownloadService 后任务为 recovery_wait 且 fetch 调用数为 0。
6. 恢复后有效分片不再请求，无效分片重新下载。
7. SSE 中断后 UI 显示轮询提示且任务状态不变。
8. API、SSE 和 rendered HTML 均不存在 token 查询参数。
```

- [ ] **步骤 4：执行规格覆盖与范围审计**

逐条对照设计规格第 13 节 17 项自动化验证和第 15 节完成定义。运行：

```bash
git diff --name-only $(git merge-base HEAD origin/main)..HEAD
rg -n "DASH|ffmpeg|边下边播|speed.limit|自动恢复" src/lib src/app/api/download src/components/downloads src/hooks/useDownloadTasks.ts
```

预期：变更文件均属于本计划文件清单；搜索结果不得显示新增的范围外实现。文案或非功能性注释命中需人工说明。

- [ ] **步骤 5：运行完整 Jest 并隔离既有失败**

```bash
pnpm exec jest --runInBand 2>&1 | tee /tmp/moontv-download-center-full-jest.log
```

预期：若完整测试仍有既有搜索测试失败，将其与实现前基线比较；本计划涉及的下载、API 和组件测试必须全部通过。不得删除测试或放宽断言。

- [ ] **步骤 6：提交最终测试修正**

如果步骤 1–5 导致计划范围内修正：

```bash
git add <仅本计划范围内实际修正文件>
git commit -m "test(download): complete progress regression coverage"
```

若没有文件变化，跳过 commit，不创建空提交。

- [ ] **步骤 7：交付说明**

最终回复必须列出：

- 新的并发、续传、进度、SSE 和 UI 能力。
- 关键文件链接。
- 每条验证命令、退出码和关键测试数量。
- 完整 Jest 中与基线一致的无关失败。
- 未完成或剩余风险。
- 明确声明未执行 NAS 生产部署。
