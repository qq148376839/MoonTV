import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { redactDownloadUrl, redactUrlsInText } from './download-transaction';
import type {
  DownloadStage,
  DownloadTaskSnapshot,
  DownloadTaskStatus,
  EpisodeDownloadState,
} from './download-types';

type EpisodeSummary = Omit<
  EpisodeDownloadState,
  | 'completedSegmentIndices'
  | 'failedSegmentIndices'
  | 'activeItems'
  | 'failures'
>;

type PersistedTask = Omit<DownloadTaskSnapshot, 'episodes'> & {
  episodes: Record<string, EpisodeSummary>;
};

const RECOVERABLE_TASK_STATUSES = new Set<DownloadTaskStatus>([
  'pending',
  'downloading',
  'paused',
  'recovery_wait',
]);

const TASK_STATUSES = new Set<DownloadTaskStatus>([
  'pending',
  'downloading',
  'paused',
  'recovery_wait',
  'partial_completed',
  'completed',
  'failed',
  'cancelled_resumable',
]);

const DOWNLOAD_STAGES = new Set<DownloadStage>([
  'queued',
  'preparing',
  'downloading',
  'validating',
  'committing',
  'completed',
  'pausing',
  'paused',
  'partial_failed',
  'cancelled_resumable',
  'recovery_wait',
]);

const DOWNLOAD_UNIT_KINDS = new Set(['segment', 'key', 'map']);
const FAILURE_CATEGORIES = new Set([
  'timeout',
  'http_auth',
  'http_server',
  'io',
  'empty',
  'length',
  'other',
]);

const TERMINAL_EPISODE_STAGES = new Set<DownloadStage>([
  'completed',
  'partial_failed',
  'cancelled_resumable',
]);

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

function episodeFileName(episode: number): string {
  if (!Number.isInteger(episode) || episode < 0) {
    throw new Error(`Invalid episode number: ${episode}`);
  }
  return `${String(episode).padStart(2, '0')}.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lstatIfExists(filePath: string): fs.Stats | null {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function assertNotSymbolicLink(filePath: string, label: string): void {
  if (lstatIfExists(filePath)?.isSymbolicLink()) {
    throw new Error(`Refusing symbolic link for ${label}: ${filePath}`);
  }
}

function assertExistingDirectory(filePath: string, label: string): boolean {
  const stats = lstatIfExists(filePath);
  if (!stats) return false;
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing symbolic link for ${label}: ${filePath}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Invalid ${label}: expected directory at ${filePath}`);
  }
  return true;
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Invalid ${label}: expected object`);
  return value;
}

function required(
  value: Record<string, unknown>,
  key: string,
  label: string
): unknown {
  if (!(key in value)) throw new Error(`Invalid ${label}: missing ${key}`);
  return value[key];
}

function assertString(value: unknown, label: string): void {
  if (typeof value !== 'string')
    throw new Error(`Invalid ${label}: expected string`);
}

function assertBoolean(value: unknown, label: string): void {
  if (typeof value !== 'boolean')
    throw new Error(`Invalid ${label}: expected boolean`);
}

function assertFiniteNumber(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}: expected finite number`);
  }
}

function assertNullableNumber(value: unknown, label: string): void {
  if (value !== null) assertFiniteNumber(value, label);
}

function assertNumberArray(value: unknown, label: string): void {
  if (!Array.isArray(value))
    throw new Error(`Invalid ${label}: expected array`);
  value.forEach((item, index) =>
    assertFiniteNumber(item, `${label}[${index}]`)
  );
}

function assertEnum(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string
): void {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

function assertEpisodeFields(
  value: unknown,
  label: string,
  includeWorkState: boolean
): void {
  const episode = assertRecord(value, label);
  assertFiniteNumber(required(episode, 'episode', label), `${label}.episode`);
  assertString(
    required(episode, 'generationId', label),
    `${label}.generationId`
  );
  assertEnum(
    required(episode, 'stage', label),
    DOWNLOAD_STAGES,
    `${label}.stage`
  );
  for (const key of [
    'totalSegments',
    'keyTotal',
    'keyCompleted',
    'mapTotal',
    'mapCompleted',
    'completedBytes',
    'progress',
    'speedBytesPerSecond',
    'refreshCount',
    'updatedAt',
  ]) {
    assertFiniteNumber(required(episode, key, label), `${label}.${key}`);
  }
  assertNullableNumber(
    required(episode, 'estimatedBytes', label),
    `${label}.estimatedBytes`
  );
  assertBoolean(
    required(episode, 'progressEstimated', label),
    `${label}.progressEstimated`
  );
  assertNullableNumber(
    required(episode, 'etaSeconds', label),
    `${label}.etaSeconds`
  );
  assertBoolean(
    required(episode, 'oldEntryRetained', label),
    `${label}.oldEntryRetained`
  );
  assertBoolean(
    required(episode, 'recoverable', label),
    `${label}.recoverable`
  );
  if (!includeWorkState) return;

  assertNumberArray(
    required(episode, 'completedSegmentIndices', label),
    `${label}.completedSegmentIndices`
  );
  assertNumberArray(
    required(episode, 'failedSegmentIndices', label),
    `${label}.failedSegmentIndices`
  );
  const activeItems = required(episode, 'activeItems', label);
  if (!Array.isArray(activeItems)) {
    throw new Error(`Invalid ${label}.activeItems: expected array`);
  }
  activeItems.forEach((item, index) => {
    const workItem = assertRecord(item, `${label}.activeItems[${index}]`);
    assertString(
      required(workItem, 'taskId', `${label}.activeItems[${index}]`),
      `${label}.activeItems[${index}].taskId`
    );
    assertFiniteNumber(
      required(workItem, 'episode', `${label}.activeItems[${index}]`),
      `${label}.activeItems[${index}].episode`
    );
    assertString(
      required(workItem, 'generationId', `${label}.activeItems[${index}]`),
      `${label}.activeItems[${index}].generationId`
    );
    assertEnum(
      required(workItem, 'kind', `${label}.activeItems[${index}]`),
      DOWNLOAD_UNIT_KINDS,
      `${label}.activeItems[${index}].kind`
    );
    assertFiniteNumber(
      required(workItem, 'index', `${label}.activeItems[${index}]`),
      `${label}.activeItems[${index}].index`
    );
    assertFiniteNumber(
      required(workItem, 'attempt', `${label}.activeItems[${index}]`),
      `${label}.activeItems[${index}].attempt`
    );
  });
  const failures = required(episode, 'failures', label);
  if (!Array.isArray(failures)) {
    throw new Error(`Invalid ${label}.failures: expected array`);
  }
  failures.forEach((item, index) => {
    const failure = assertRecord(item, `${label}.failures[${index}]`);
    assertEnum(
      required(failure, 'kind', `${label}.failures[${index}]`),
      DOWNLOAD_UNIT_KINDS,
      `${label}.failures[${index}].kind`
    );
    assertFiniteNumber(
      required(failure, 'index', `${label}.failures[${index}]`),
      `${label}.failures[${index}].index`
    );
    assertEnum(
      required(failure, 'category', `${label}.failures[${index}]`),
      FAILURE_CATEGORIES,
      `${label}.failures[${index}].category`
    );
    assertFiniteNumber(
      required(failure, 'attempts', `${label}.failures[${index}]`),
      `${label}.failures[${index}].attempts`
    );
    assertString(
      required(failure, 'path', `${label}.failures[${index}]`),
      `${label}.failures[${index}].path`
    );
    assertString(
      required(failure, 'message', `${label}.failures[${index}]`),
      `${label}.failures[${index}].message`
    );
  });
}

function assertPersistedTask(value: unknown, label: string): void {
  const task = assertRecord(value, label);
  if (required(task, 'schemaVersion', label) !== 1) {
    throw new Error(`Invalid ${label}.schemaVersion`);
  }
  for (const key of ['taskId', 'source', 'resourceId', 'title', 'year']) {
    assertString(required(task, key, label), `${label}.${key}`);
  }
  if ('poster' in task) assertString(task.poster, `${label}.poster`);
  assertNumberArray(
    required(task, 'episodeNumbers', label),
    `${label}.episodeNumbers`
  );
  assertEnum(required(task, 'status', label), TASK_STATUSES, `${label}.status`);
  assertEnum(
    required(task, 'priority', label),
    new Set(['normal', 'high']),
    `${label}.priority`
  );
  assertNullableNumber(
    required(task, 'currentEpisode', label),
    `${label}.currentEpisode`
  );
  for (const key of [
    'progress',
    'speedBytesPerSecond',
    'completedBytes',
    'createdAt',
    'updatedAt',
  ]) {
    assertFiniteNumber(required(task, key, label), `${label}.${key}`);
  }
  assertBoolean(
    required(task, 'progressEstimated', label),
    `${label}.progressEstimated`
  );
  assertNullableNumber(
    required(task, 'etaSeconds', label),
    `${label}.etaSeconds`
  );
  const episodes = assertRecord(
    required(task, 'episodes', label),
    `${label}.episodes`
  );
  Object.entries(episodes).forEach(([key, episode]) =>
    assertEpisodeFields(episode, `${label}.episodes.${key}`, false)
  );
}

export class DownloadStateStore {
  private readonly stateRoot: string;

  constructor(storageRoot: string) {
    this.stateRoot = path.resolve(storageRoot, 'download-tasks');
  }

  saveTask(snapshot: DownloadTaskSnapshot): void {
    this.assertTaskId(snapshot.taskId);
    const taskDir = this.taskDirectory(snapshot.taskId);
    const episodesDir = path.join(taskDir, 'episodes');
    const sanitized = this.sanitizeSnapshot(snapshot);

    this.ensureSafeDirectory(this.stateRoot, 'download state root');
    this.ensureSafeDirectory(taskDir, 'task directory');
    this.ensureSafeDirectory(episodesDir, 'episodes directory');
    assertNotSymbolicLink(path.join(taskDir, 'task.json'), 'task JSON');
    for (const state of Object.values(sanitized.episodes)) {
      const episodePath = path.join(
        episodesDir,
        episodeFileName(state.episode)
      );
      assertNotSymbolicLink(episodePath, 'episode JSON');
      this.writeJsonAtomically(episodePath, state);
    }
    this.writeJsonAtomically(
      path.join(taskDir, 'task.json'),
      this.toPersistedTask(sanitized)
    );
  }

  loadTask(taskId: string): DownloadTaskSnapshot {
    this.assertTaskId(taskId);
    const taskDir = this.taskDirectory(taskId);
    const episodesDir = path.join(taskDir, 'episodes');
    this.assertTaskPathsSafe(taskDir, episodesDir);
    this.removeTemporaryFiles(taskDir);
    this.removeTemporaryFiles(episodesDir);
    const persisted = this.readPersistedTask(path.join(taskDir, 'task.json'));
    if (persisted.taskId !== taskId) {
      throw new Error(`Download task state taskId mismatch for ${taskId}`);
    }

    const episodes: Record<string, EpisodeDownloadState> = {};
    for (const [key, summary] of Object.entries(persisted.episodes)) {
      const episodePath = path.join(
        episodesDir,
        episodeFileName(summary.episode)
      );
      assertNotSymbolicLink(episodePath, 'episode JSON');
      const state = this.readEpisodeState(episodePath);
      if (state.episode !== summary.episode) {
        throw new Error(`Episode state mismatch in ${episodePath}`);
      }
      episodes[key] = state;
    }

    return { ...persisted, episodes };
  }

  listTasks(): DownloadTaskSnapshot[] {
    if (!assertExistingDirectory(this.stateRoot, 'download state root'))
      return [];

    this.removeTemporaryFiles(this.stateRoot);
    const taskIds: string[] = [];
    for (const entry of fs.readdirSync(this.stateRoot, {
      withFileTypes: true,
    })) {
      if (!this.isSafeTaskId(entry.name)) continue;
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Refusing symbolic link for task directory: ${path.join(
            this.stateRoot,
            entry.name
          )}`
        );
      }
      if (entry.isDirectory()) taskIds.push(entry.name);
    }
    return taskIds.map((taskId) => this.loadTask(taskId));
  }

  loadRecoverableTasks(): DownloadTaskSnapshot[] {
    return this.listTasks().flatMap((snapshot) => {
      if (!RECOVERABLE_TASK_STATUSES.has(snapshot.status)) return [];

      const episodes = Object.fromEntries(
        Object.entries(snapshot.episodes).map(([key, episode]) => [
          key,
          TERMINAL_EPISODE_STAGES.has(episode.stage)
            ? episode
            : { ...episode, stage: 'recovery_wait' as const },
        ])
      );
      return [{ ...snapshot, status: 'recovery_wait', episodes }];
    });
  }

  deleteTaskState(taskId: string): void {
    this.assertTaskId(taskId);
    const taskDir = this.taskDirectory(taskId);
    this.assertTaskPathsSafe(taskDir, path.join(taskDir, 'episodes'));
    fs.rmSync(taskDir, { recursive: true, force: true });
  }

  cleanupHistory(now: number): { removed: string[] } {
    if (!Number.isFinite(now)) {
      throw new TypeError('cleanupHistory now must be a finite number');
    }
    if (!assertExistingDirectory(this.stateRoot, 'download state root')) {
      return { removed: [] };
    }

    this.removeTemporaryFiles(this.stateRoot);
    const removed: string[] = [];
    for (const entry of fs.readdirSync(this.stateRoot, {
      withFileTypes: true,
    })) {
      if (!this.isSafeTaskId(entry.name)) continue;
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Refusing symbolic link for task directory: ${path.join(
            this.stateRoot,
            entry.name
          )}`
        );
      }
      if (!entry.isDirectory()) continue;

      const taskId = entry.name;
      const taskDir = this.taskDirectory(taskId);
      const episodesDir = path.join(taskDir, 'episodes');
      this.assertTaskPathsSafe(taskDir, episodesDir);
      this.removeTemporaryFiles(taskDir);
      this.removeTemporaryFiles(episodesDir);
      const persisted = this.readPersistedTask(path.join(taskDir, 'task.json'));
      if (persisted.taskId !== taskId) {
        throw new Error(`Download task state taskId mismatch for ${taskId}`);
      }
      if (this.shouldRemove(persisted.status, persisted.updatedAt, now)) {
        fs.rmSync(taskDir, { recursive: true, force: true });
        removed.push(taskId);
      }
    }
    return { removed };
  }

  private sanitizeSnapshot(
    snapshot: DownloadTaskSnapshot
  ): DownloadTaskSnapshot {
    return this.sanitizeValue({
      ...snapshot,
      schemaVersion: 1,
    }) as DownloadTaskSnapshot;
  }

  private sanitizeValue(value: unknown, key?: string): unknown {
    if (typeof value === 'string') return this.sanitizeString(value, key);
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item));
    }
    if (!isRecord(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        this.sanitizeValue(childValue, childKey),
      ])
    );
  }

  private sanitizeString(value: string, key?: string): string {
    if (key === 'poster' || key?.toLowerCase().endsWith('url')) {
      return redactDownloadUrl(value);
    }
    if (key !== 'path' && key !== 'message') return value;

    const redactedUrls = redactUrlsInText(value);
    const withoutPathTails = redactedUrls.replace(
      /((?:[^\s/?#：:，,。！？!?]+\/)+[^\s/?#：:，,。！？!?]+|[^\s/?#：:，,。！？!?]+\.[^\s/?#：:，,。！？!?]+)(?:\?[^\s#]*(?:#[^\s]*)?|#[^\s]*)/g,
      '$1'
    );
    if (key === 'path') {
      return withoutPathTails.split(/[?#]/, 1)[0];
    }
    return withoutPathTails;
  }

  private toPersistedTask(snapshot: DownloadTaskSnapshot): PersistedTask {
    return {
      ...snapshot,
      episodes: Object.fromEntries(
        Object.entries(snapshot.episodes).map(([key, state]) => {
          const {
            completedSegmentIndices: _completedSegmentIndices,
            failedSegmentIndices: _failedSegmentIndices,
            activeItems: _activeItems,
            failures: _failures,
            ...summary
          } = state;
          return [key, summary];
        })
      ),
    };
  }

  private readPersistedTask(filePath: string): PersistedTask {
    const parsed = this.readJson(filePath, 'task.json');
    assertPersistedTask(parsed, `task.json at ${filePath}`);
    return parsed as unknown as PersistedTask;
  }

  private readEpisodeState(filePath: string): EpisodeDownloadState {
    const parsed = this.readJson(
      filePath,
      `episode state ${path.basename(filePath)}`
    );
    assertEpisodeFields(parsed, `episode state at ${filePath}`, true);
    return parsed as unknown as EpisodeDownloadState;
  }

  private readJson(filePath: string, label: string): unknown {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to read ${label} at ${filePath}: ${detail}`);
    }
  }

  private writeJsonAtomically(filePath: string, value: unknown): void {
    assertNotSymbolicLink(filePath, 'JSON state file');
    const temporaryPath = `${filePath}.${
      process.pid
    }.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(value), {
        encoding: 'utf8',
        flag: 'wx',
      });
      fs.renameSync(temporaryPath, filePath);
      assertNotSymbolicLink(filePath, 'JSON state file');
    } catch (error) {
      fs.rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  private shouldRemove(
    status: DownloadTaskStatus,
    updatedAt: number,
    now: number
  ): boolean {
    if (status === 'completed') return updatedAt <= now - SEVEN_DAYS;
    return (
      (status === 'failed' ||
        status === 'partial_completed' ||
        status === 'cancelled_resumable') &&
      updatedAt <= now - THIRTY_DAYS
    );
  }

  private taskDirectory(taskId: string): string {
    const directory = path.resolve(this.stateRoot, taskId);
    if (directory !== path.join(this.stateRoot, taskId)) {
      throw new Error(`Invalid taskId: ${taskId}`);
    }
    return directory;
  }

  private assertTaskId(taskId: string): void {
    if (!this.isSafeTaskId(taskId))
      throw new Error(`Invalid taskId: ${taskId}`);
  }

  private isSafeTaskId(taskId: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(taskId);
  }

  private ensureSafeDirectory(directory: string, label: string): void {
    assertNotSymbolicLink(directory, label);
    fs.mkdirSync(directory, { recursive: true });
    assertExistingDirectory(directory, label);
  }

  private assertTaskPathsSafe(taskDir: string, episodesDir: string): void {
    assertNotSymbolicLink(this.stateRoot, 'download state root');
    assertNotSymbolicLink(taskDir, 'task directory');
    assertNotSymbolicLink(episodesDir, 'episodes directory');
    assertNotSymbolicLink(path.join(taskDir, 'task.json'), 'task JSON');
    if (assertExistingDirectory(episodesDir, 'episodes directory')) {
      for (const entry of fs.readdirSync(episodesDir, {
        withFileTypes: true,
      })) {
        if (entry.isSymbolicLink()) {
          throw new Error(
            `Refusing symbolic link for episode state: ${path.join(
              episodesDir,
              entry.name
            )}`
          );
        }
      }
    }
  }

  private removeTemporaryFiles(directory: string): void {
    if (!assertExistingDirectory(directory, 'state directory')) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.tmp')) {
        fs.rmSync(path.join(directory, entry.name), { force: true });
      }
    }
  }
}
