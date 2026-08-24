/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-require-imports */

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { finished } from 'stream/promises';

import { filterM3U8Ads } from './ad-filter';
import { getAvailableApiSites } from './config';
import { getDownloadEventBus } from './download-event-bus';
import {
  calculateEpisodeProgress,
  DownloadSpeedWindow,
} from './download-progress';
import {
  DownloadCancelledError,
  DownloadScheduler,
} from './download-scheduler';
import {
  assertSafeGenerationId,
  DownloadStateStore,
} from './download-state-store';
import type {
  ParsedMediaPlaylistResources,
  RemappedMediaPlaylistResources,
} from './download-transaction';
import {
  acquireEpisodeLock,
  commitPlaylistAtomically,
  createEpisodeGeneration,
  parseMediaPlaylistResources,
  redactDownloadUrl,
  releaseEpisodeLock,
  remapMediaPlaylistResources,
  validateLocalPlaylist,
  validateResumeFiles,
} from './download-transaction';
import type {
  DownloadAddressSource,
  DownloadFailure,
  DownloadTaskSnapshot,
  DownloadWorkItem,
  EpisodeDownloadState,
} from './download-types';
import { getDetailFromApi } from './downstream';
import {
  EpisodeDownloadAuditSummary,
  getStorageManager,
  StorageManager,
} from './local-storage';
import { SearchResult } from './types';

/**
 * 带重试和超时的 fetch 请求
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries = 3,
  timeoutMs = 30000
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | null = null;

    try {
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const fetchOptions: RequestInit = {
        ...options,
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          Referer: url,
          Accept: '*/*',
          ...options.headers,
        },
      };

      const response = await fetch(url, fetchOptions);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      return response;
    } catch (error) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      lastError = error instanceof Error ? error : new Error(String(error));

      // 如果是最后一次尝试，直接抛出错误
      if (attempt === maxRetries) {
        throw lastError;
      }

      // 等待后重试（指数退避）
      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(
        `[DownloadService] 请求失败，${waitTime}ms 后重试 (${attempt}/${maxRetries}): ${redactDownloadUrl(
          url
        )}`
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  throw lastError || new Error('请求失败');
}

async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs = 60000
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          void reader.cancel().catch(() => undefined);
          reject(new Error('下载流读取超时'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function isLikelyWebPageUrl(url: string): boolean {
  try {
    if (!(url.startsWith('http://') || url.startsWith('https://')))
      return false;
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const p = u.pathname.toLowerCase();
    const isHtml = p.endsWith('.html') || url.toLowerCase().includes('.html#');
    const isKnownVideoPageHost =
      host.includes('youku.com') ||
      host.includes('iqiyi.com') ||
      host.includes('v.qq.com') ||
      host.includes('mgtv.com') ||
      host.includes('bilibili.com');
    return isHtml || isKnownVideoPageHost;
  } catch {
    return false;
  }
}

async function parseToM3u8Url(videoUrl: string): Promise<string | null> {
  let parseApiUrl =
    process.env.NEXT_PUBLIC_PARSE_API_URL ||
    'https://gfjx.riowang.win/api/v1/parse';
  parseApiUrl = parseApiUrl.replace(/([^:]\/)\/+/g, '$1');
  const parseUrl = `${parseApiUrl}?url=${encodeURIComponent(videoUrl)}`;

  try {
    const resp = await fetchWithRetry(
      parseUrl,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
      },
      2,
      8000
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as unknown;
    const m3u8 =
      typeof data === 'object' && data
        ? (data as { data?: { m3u8_url?: unknown } }).data?.m3u8_url
        : undefined;
    return typeof m3u8 === 'string' && m3u8.trim().length > 0 ? m3u8 : null;
  } catch (e) {
    console.warn(
      '[DownloadService] 解析 API 失败:',
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

// 下载任务状态
export enum DownloadStatus {
  PENDING = 'pending',
  DOWNLOADING = 'downloading',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

// 下载任务接口
export interface DownloadTask {
  id: string;
  source: string;
  resourceId: string;
  resource: SearchResult;
  episodes: string[];
  /**
   * 1-based episode numbers aligned with `episodes` (same length).
   * This is critical for range/partial downloads so we never "10-12 => 01-03".
   */
  episodeNumbers: number[];
  forceRedownload: boolean;
  addressMethod:
    | 'direct'
    | 'refreshed'
    | 'client_fallback'
    | 'historical_fallback';
  status: DownloadStatus;
  progress: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

// 下载进度回调
export type ProgressCallback = (
  taskId: string,
  progress: number,
  downloaded: number,
  total: number
) => void;

interface DownloadStateStoreLike {
  loadRecoverableTasks(): DownloadTaskSnapshot[];
  saveTask(snapshot: DownloadTaskSnapshot): void;
  deleteTaskState(taskId: string): void;
  cleanupHistory?(now: number): { removed: string[] };
}

export interface CommandResult {
  ok: boolean;
  status: DownloadTaskSnapshot['status'] | 'not_found' | 'conflict';
}

export interface DownloadServiceDependencies {
  storageManager: StorageManager;
  stateStore: DownloadStateStoreLike;
  scheduler: DownloadScheduler;
  publishProgress: (
    type: 'task.updated' | 'episode.updated' | 'segment.batch',
    data: unknown
  ) => void;
  timer: (milliseconds: number) => Promise<void>;
  random: () => number;
  reacquireEpisode?: (
    task: DownloadTaskSnapshot,
    episode: number
  ) => Promise<{ playlistUrl: string; content: string }>;
}

async function defaultReacquireEpisode(
  task: DownloadTaskSnapshot,
  episode: number
): Promise<{ playlistUrl: string; content: string }> {
  const sites = await getAvailableApiSites();
  const site = sites.find((candidate) => candidate.key === task.source);
  if (!site)
    throw new Error('unable to reacquire playlist: source unavailable');
  const detail = await getDetailFromApi(site, task.resourceId);
  let playlistUrl = detail.episodes[episode - 1];
  if (!playlistUrl)
    throw new Error('unable to reacquire playlist: episode unavailable');
  if (!playlistUrl.toLowerCase().includes('m3u8')) {
    const parsed = await parseToM3u8Url(playlistUrl);
    if (!parsed) throw new Error('unable to reacquire playlist URL');
    playlistUrl = parsed;
  }
  return fetchCurrentMediaPlaylist(playlistUrl);
}

async function reacquireEpisodeFromCurrentResource(
  resource: SearchResult,
  episode: number
): Promise<{ playlistUrl: string; content: string }> {
  const playlistUrl = resource.episodes[episode - 1];
  if (!playlistUrl)
    throw new Error('unable to reacquire playlist: episode unavailable');
  return reacquireEpisodeFromEntry(playlistUrl);
}

async function reacquireEpisodeFromEntry(
  entry: string
): Promise<{ playlistUrl: string; content: string }> {
  let playlistUrl = entry;
  if (!playlistUrl.toLowerCase().includes('m3u8')) {
    const parsed = await parseToM3u8Url(playlistUrl);
    if (!parsed) throw new Error('unable to reacquire playlist URL');
    playlistUrl = parsed;
  }
  return fetchCurrentMediaPlaylist(playlistUrl);
}

async function fetchCurrentMediaPlaylist(
  playlistUrl: string
): Promise<{ playlistUrl: string; content: string }> {
  const response = await fetchWithRetry(playlistUrl, {}, 3, 30000);
  if (!response.ok) {
    throw new Error(`playlist refresh failed: ${response.status}`);
  }
  const content = await response.text();
  if (!content.includes('#EXT-X-STREAM-INF')) return { playlistUrl, content };

  const lines = content.split('\n');
  let selectedUrl = '';
  let selectedBandwidth = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const bandwidth = Number.parseInt(
      line.match(/BANDWIDTH=(\d+)/)?.[1] ?? '0',
      10
    );
    const candidate = lines[index + 1]?.trim();
    if (
      candidate &&
      !candidate.startsWith('#') &&
      bandwidth > selectedBandwidth
    ) {
      selectedBandwidth = bandwidth;
      selectedUrl = new URL(candidate, playlistUrl).href;
    }
  }
  if (!selectedUrl)
    throw new Error('playlist refresh master has no media stream');
  const mediaResponse = await fetchWithRetry(selectedUrl, {}, 3, 30000);
  if (!mediaResponse.ok) {
    throw new Error(`playlist refresh failed: ${mediaResponse.status}`);
  }
  return { playlistUrl: selectedUrl, content: await mediaResponse.text() };
}

export function readDownloadConcurrency(
  raw = process.env.LOCAL_STORAGE_DOWNLOAD_CONCURRENCY
): number {
  const parsed = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(parsed)) return 8;
  return Math.max(2, Math.min(16, parsed));
}

function defaultDependencies(): DownloadServiceDependencies {
  const storageManager = getStorageManager();
  const concurrency = readDownloadConcurrency();
  return {
    storageManager,
    stateStore: new DownloadStateStore(
      typeof storageManager.getStoragePath === 'function'
        ? storageManager.getStoragePath()
        : process.env.LOCAL_STORAGE_PATH ||
          path.join(process.cwd(), 'data', 'videos')
    ),
    scheduler: sharedScheduler(concurrency),
    publishProgress: (type, data) => getDownloadEventBus().publish(type, data),
    timer: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    random: Math.random,
    reacquireEpisode: defaultReacquireEpisode,
  };
}

let globalScheduler: DownloadScheduler | null = null;
function sharedScheduler(concurrency: number): DownloadScheduler {
  globalScheduler ??= new DownloadScheduler({ concurrency });
  return globalScheduler;
}

function containedGenerationPath(
  resourcePath: string,
  episode: number,
  generationId: string
): string {
  assertSafeGenerationId(generationId);
  const generationsRoot = path.resolve(
    resourcePath,
    `episode_${String(episode).padStart(2, '0')}_generations`
  );
  const generationPath = path.resolve(generationsRoot, generationId);
  if (path.dirname(generationPath) !== generationsRoot) {
    throw new Error('Invalid generation path: outside generations directory');
  }
  return generationPath;
}

function realDirectoryWithoutSymlink(
  directoryPath: string,
  label: string
): string {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(directoryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Invalid generation path: missing ${label}`);
    }
    throw error;
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`Invalid generation path: symbolic link ${label}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Invalid generation path: ${label} is not a directory`);
  }
  return fs.realpathSync(directoryPath);
}

function generationPathForRemoval(
  resourcePath: string,
  episode: number,
  generationId: string
): string {
  const generationPath = containedGenerationPath(
    resourcePath,
    episode,
    generationId
  );
  const resourceRoot = path.resolve(resourcePath);
  const generationsRoot = path.dirname(generationPath);
  const realResourceRoot = realDirectoryWithoutSymlink(
    resourceRoot,
    'resource root'
  );
  const realGenerationsRoot = realDirectoryWithoutSymlink(
    generationsRoot,
    'generations directory'
  );
  if (path.dirname(realGenerationsRoot) !== realResourceRoot) {
    throw new Error('Invalid generation path: escaped resource root');
  }
  const realGenerationPath = realDirectoryWithoutSymlink(
    generationPath,
    'generation directory'
  );
  if (path.dirname(realGenerationPath) !== realGenerationsRoot) {
    throw new Error('Invalid generation path: escaped generations directory');
  }
  return realGenerationPath;
}

// 下载服务类
export class DownloadService {
  private storageManager: StorageManager;
  private tasks: Map<string, DownloadTask> = new Map();
  private maxConcurrent: number;
  private activeDownloads: Set<string> = new Set();
  private readonly stateStore: DownloadStateStoreLike;
  private readonly scheduler: DownloadScheduler;
  private readonly publishProgress: DownloadServiceDependencies['publishProgress'];
  private readonly timer: DownloadServiceDependencies['timer'];
  private readonly random: DownloadServiceDependencies['random'];
  private readonly reacquireEpisode: NonNullable<
    DownloadServiceDependencies['reacquireEpisode']
  >;
  private readonly snapshots = new Map<string, DownloadTaskSnapshot>();
  private readonly failedWork = new Map<
    string,
    { item: DownloadWorkItem; operation: () => Promise<number>; path: string }
  >();
  private readonly pendingFlushes = new Map<
    string,
    { changes: number; timer: NodeJS.Timeout | null }
  >();
  private readonly recoveryPlans = new Map<
    string,
    RemappedMediaPlaylistResources
  >();
  private readonly taskLifecycleVersions = new Map<string, number>();
  private readonly resumeOperations = new Map<string, Promise<CommandResult>>();
  private lastCleanupDay: number | null = null;

  constructor(deps: DownloadServiceDependencies = defaultDependencies()) {
    this.storageManager = deps.storageManager;
    this.stateStore = deps.stateStore;
    this.scheduler = deps.scheduler;
    this.publishProgress = deps.publishProgress;
    this.timer = deps.timer;
    this.random = deps.random;
    this.reacquireEpisode = deps.reacquireEpisode ?? defaultReacquireEpisode;
    this.maxConcurrent =
      parseInt(process.env.LOCAL_STORAGE_MAX_CONCURRENT || '3', 10) || 3;
    for (const snapshot of this.stateStore.loadRecoverableTasks()) {
      this.snapshots.set(snapshot.taskId, snapshot);
    }
    this.cleanupHistoryOncePerDay();
  }

  private restorePendingTask(snapshot: DownloadTaskSnapshot): boolean {
    if (this.tasks.has(snapshot.taskId)) return true;
    const entries = Object.entries(snapshot.recovery?.episodeEntries ?? {})
      .map(([episode, entry]) => ({ episode: Number(episode), entry }))
      .filter(
        ({ episode, entry }) =>
          Number.isInteger(episode) &&
          episode > 0 &&
          typeof entry === 'string' &&
          entry.length > 0
      )
      .sort((a, b) => a.episode - b.episode);
    if (entries.length === 0) return false;
    const totalEpisodes = Math.max(
      ...snapshot.episodeNumbers,
      ...entries.map(({ episode }) => episode)
    );
    const resourceEpisodes = Array.from({ length: totalEpisodes }, () => '');
    entries.forEach(({ episode, entry }) => {
      resourceEpisodes[episode - 1] = entry;
    });
    this.tasks.set(snapshot.taskId, {
      id: snapshot.taskId,
      source: snapshot.source,
      resourceId: snapshot.resourceId,
      resource: {
        id: snapshot.resourceId,
        title: snapshot.title,
        poster: snapshot.poster ?? '',
        episodes: resourceEpisodes,
        source: snapshot.source,
        source_name: snapshot.source,
        year: snapshot.year,
      },
      episodes: entries.map(({ entry }) => entry),
      episodeNumbers: entries.map(({ episode }) => episode),
      forceRedownload: false,
      addressMethod: 'direct',
      status: DownloadStatus.PENDING,
      progress: snapshot.progress,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
    });
    return true;
  }

  private cleanupHistoryOncePerDay(now = Date.now()): void {
    const day = Math.floor(now / (24 * 60 * 60 * 1000));
    if (this.lastCleanupDay === day) return;
    const result = this.stateStore.cleanupHistory?.(now);
    result?.removed.forEach((taskId) => this.evictCleanedTask(taskId));
    this.lastCleanupDay = day;
  }

  private evictCleanedTask(taskId: string): void {
    const pending = this.pendingFlushes.get(taskId);
    if (pending?.timer) clearTimeout(pending.timer);
    this.pendingFlushes.delete(taskId);

    this.bumpTaskLifecycle(taskId);
    this.scheduler.pauseTask(taskId);
    this.scheduler.cancelQueued(taskId);
    this.scheduler.setPriority(taskId, 'normal');

    this.snapshots.delete(taskId);
    this.tasks.delete(taskId);
    this.activeDownloads.delete(taskId);
    for (const [key, failed] of this.failedWork) {
      if (failed.item.taskId === taskId) this.failedWork.delete(key);
    }
    for (const key of this.recoveryPlans.keys()) {
      if (key.startsWith(`${taskId}:`)) this.recoveryPlans.delete(key);
    }
    this.taskLifecycleVersions.delete(taskId);
  }

  public getSnapshot(taskId: string): DownloadTaskSnapshot | null {
    return this.snapshots.get(taskId) ?? null;
  }

  public getSchedulerDiagnostics() {
    return this.scheduler.getGlobalStats();
  }

  public getRecoverableTaskIds(): string[] {
    return Array.from(this.snapshots.keys());
  }

  private async runWithRetry<T>(
    operation: (attempt: number) => Promise<T>,
    refresh?: () => Promise<void>
  ): Promise<T> {
    let lastError: unknown;
    let refreshed = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await operation(attempt);
      } catch (error) {
        lastError = error;
        if (
          this.classifyFailure(error) === 'http_auth' &&
          refresh &&
          !refreshed
        ) {
          refreshed = true;
          await refresh();
        }
        if (attempt === 3 || !this.isRetryable(error)) {
          if (error instanceof Error) {
            Object.assign(error, { downloadAttempts: attempt });
          }
          throw error;
        }
        await this.timer(500 * 2 ** (attempt - 1) + this.random() * 250);
      }
    }
    throw lastError;
  }

  private isRetryable(error: unknown): boolean {
    const category = this.classifyFailure(error);
    return [
      'timeout',
      'http_auth',
      'http_server',
      'io',
      'empty',
      'length',
    ].includes(category);
  }

  private classifyFailure(error: unknown): DownloadFailure['category'] {
    const candidate = error as {
      name?: string;
      status?: number;
      code?: string;
      message?: string;
    };
    if (
      candidate.name === 'AbortError' ||
      /timed?\s*out/i.test(candidate.message || '')
    )
      return 'timeout';
    if (
      candidate.status === 401 ||
      candidate.status === 403 ||
      /\b(401|403)\b/.test(candidate.message || '')
    )
      return 'http_auth';
    if (
      (candidate.status ?? 0) >= 500 ||
      /\b5\d\d\b/.test(candidate.message || '')
    )
      return 'http_server';
    if (/empty|\u4e3a\u7a7a/.test(candidate.message || '')) return 'empty';
    if (/length|\u957f\u5ea6/.test(candidate.message || '')) return 'length';
    if (
      candidate.code ||
      /socket|stream|write|read|E[A-Z]+/.test(candidate.message || '')
    )
      return 'io';
    return 'other';
  }

  private workKey(item: DownloadWorkItem): string {
    return `${item.taskId}:${item.episode}:${item.generationId}:${item.kind}:${item.index}`;
  }

  private async executeScheduled(
    episode: EpisodeDownloadState,
    item: DownloadWorkItem,
    filePath: string,
    operation: (
      reportWrittenBytes?: (bytes: number) => void
    ) => Promise<number>,
    refresh?: () => Promise<void>,
    cancelQueuedOnFailure = true
  ): Promise<number> {
    try {
      const bytes = await this.scheduler.enqueue(item, async () => {
        const activeItem: DownloadWorkItem = {
          ...item,
          speedBytesPerSecond: 0,
        };
        episode.activeItems.push(activeItem);
        const speedWindow = new DownloadSpeedWindow(10);
        speedWindow.addSample(Date.now(), 0);
        const reportWrittenBytes = (writtenBytes: number) => {
          speedWindow.addSample(Date.now(), writtenBytes);
          activeItem.speedBytesPerSecond =
            speedWindow.getEstimate(0).bytesPerSecond;
          this.queueSnapshotFlush(item.taskId);
        };
        try {
          return await this.runWithRetry((attempt) => {
            item.attempt = attempt;
            activeItem.attempt = attempt;
            return operation(reportWrittenBytes);
          }, refresh).catch((error) => {
            if (cancelQueuedOnFailure) this.scheduler.cancelQueued(item.taskId);
            throw error;
          });
        } finally {
          episode.activeItems = episode.activeItems.filter(
            (current) => current !== activeItem
          );
          this.queueSnapshotFlush(item.taskId);
        }
      });
      this.failedWork.delete(this.workKey(item));
      this.markUnitCompleted(episode, item, bytes);
      this.queueSnapshotFlush(item.taskId);
      return bytes;
    } catch (error) {
      const category = this.classifyFailure(error);
      const failure: DownloadFailure = {
        kind: item.kind,
        index: item.index,
        category,
        attempts:
          (error as { downloadAttempts?: number }).downloadAttempts ?? 1,
        path: path.relative(process.cwd(), filePath),
        message: redactDownloadUrl(
          error instanceof Error ? error.message : String(error)
        ),
      };
      episode.failures = episode.failures.filter(
        (current) => current.kind !== item.kind || current.index !== item.index
      );
      episode.failures.push(failure);
      if (
        item.kind === 'segment' &&
        !episode.failedSegmentIndices.includes(item.index)
      ) {
        episode.failedSegmentIndices.push(item.index);
      }
      this.failedWork.set(this.workKey(item), {
        item,
        operation,
        path: filePath,
      });
      throw error;
    }
  }

  /**
   * 检查是否启用
   */
  public isEnabled(): boolean {
    return this.storageManager.isEnabled();
  }

  /**
   * 查找是否有相同资源+剧集的正在进行的任务
   */
  private findExistingTask(
    source: string,
    resourceId: string,
    episodeNumbers: number[]
  ): DownloadTask | null {
    // 用 episodeNumbers 判定“同一任务”（URL 可能变，但集号语义不应变）
    const requestedEpisodes = new Set(episodeNumbers);

    // 遍历所有任务
    const tasksArray = Array.from(this.tasks.values());
    for (const task of tasksArray) {
      // 检查是否是相同的资源和源
      if (task.source !== source || task.resourceId !== resourceId) {
        continue;
      }

      // 检查状态：只检查 PENDING 或 DOWNLOADING 状态的任务
      if (
        task.status !== DownloadStatus.PENDING &&
        task.status !== DownloadStatus.DOWNLOADING
      ) {
        continue;
      }

      // 检查剧集是否相同（排序后比较）
      if (
        task.episodeNumbers.some((episode) => requestedEpisodes.has(episode))
      ) {
        return task;
      }
    }

    return null;
  }

  /**
   * 检查所有剧集是否已完全下载
   */
  private areAllEpisodesDownloaded(
    source: string,
    resourceId: string,
    episodeNumbers: number[]
  ): boolean {
    console.log(
      `[DownloadService] 检查所有剧集是否已下载: ${source}_${resourceId}, 剧集数: ${episodeNumbers.length}`
    );

    for (let i = 0; i < episodeNumbers.length; i++) {
      const episodeIndex = episodeNumbers[i];
      const isDownloaded = this.storageManager.isEpisodeDownloaded(
        source,
        resourceId,
        episodeIndex
      );

      console.log(
        `[DownloadService] 剧集 ${episodeIndex} 下载状态: ${
          isDownloaded ? '✓ 已下载' : '✗ 未下载'
        }`
      );

      if (!isDownloaded) {
        console.log(
          `[DownloadService] 发现未下载的剧集: ${episodeIndex}, 返回 false`
        );
        return false;
      }
    }

    console.log(
      `[DownloadService] ✓ 所有剧集都已下载: ${source}_${resourceId}`
    );
    return true;
  }

  /**
   * 创建下载任务
   */
  public createTask(
    resource: SearchResult,
    episodes: string[],
    episodeNumbers?: number[],
    opts: {
      forceRedownload?: boolean;
      addressMethod?: DownloadTask['addressMethod'];
    } = {}
  ): DownloadTask {
    const episodesToDownload = Array.isArray(episodes)
      ? episodes.filter(Boolean)
      : [];
    const numbersToDownload =
      Array.isArray(episodeNumbers) &&
      episodeNumbers.length === episodesToDownload.length
        ? episodeNumbers
        : episodesToDownload.map((_, i) => i + 1);

    const forceRedownload = opts.forceRedownload === true;

    // 进行中的同集任务始终优先复用，强制重下不得并发写同一集。
    const existingTask = this.findExistingTask(
      resource.source,
      resource.id,
      numbersToDownload
    );
    if (existingTask) return existingTask;

    // 检查是否所有剧集都已完全下载
    const allDownloaded = this.areAllEpisodesDownloaded(
      resource.source,
      resource.id,
      numbersToDownload
    );

    if (allDownloaded && !forceRedownload) {
      console.log(
        `[DownloadService] 所有剧集已完全下载: ${resource.source}_${resource.id}, 剧集数: ${episodesToDownload.length}`
      );
      // 返回一个已完成的任务
      const completedTaskId = `completed_${resource.source}_${
        resource.id
      }_${Date.now()}`;
      const completedTask: DownloadTask = {
        id: completedTaskId,
        source: resource.source,
        resourceId: resource.id,
        resource,
        episodes: episodesToDownload,
        episodeNumbers: numbersToDownload,
        forceRedownload: false,
        addressMethod: 'direct',
        status: DownloadStatus.COMPLETED,
        progress: 100,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      // 不添加到任务列表，直接返回
      return completedTask;
    }

    const taskId = `download_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    const task: DownloadTask = {
      id: taskId,
      source: resource.source,
      resourceId: resource.id,
      resource,
      episodes: episodesToDownload,
      episodeNumbers: numbersToDownload,
      forceRedownload,
      addressMethod: opts.addressMethod ?? 'direct',
      status: DownloadStatus.PENDING,
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.tasks.set(taskId, task);
    const now = Date.now();
    const snapshot: DownloadTaskSnapshot = {
      schemaVersion: 1,
      taskId,
      source: task.source,
      resourceId: task.resourceId,
      title: task.resource.title,
      year: task.resource.year,
      poster: task.resource.poster,
      recovery: {
        source: task.source,
        resourceId: task.resourceId,
        episodeEntries: Object.fromEntries(
          numbersToDownload.map((episodeNumber, index) => [
            String(episodeNumber),
            episodesToDownload[index],
          ])
        ),
      },
      episodeNumbers: numbersToDownload,
      status: 'pending',
      priority: 'normal',
      currentEpisode: numbersToDownload[0] ?? null,
      progress: 0,
      progressEstimated: true,
      speedBytesPerSecond: 0,
      etaSeconds: null,
      completedBytes: 0,
      createdAt: now,
      updatedAt: now,
      episodes: {},
    };
    this.snapshots.set(taskId, snapshot);
    this.flushSnapshot(snapshot, 'task.updated');
    this.processQueue();

    return task;
  }

  /**
   * 处理下载队列
   */
  private async processQueue(): Promise<void> {
    while (this.activeDownloads.size < this.maxConcurrent) {
      const pendingTask = Array.from(this.tasks.values()).find(
        (task) => task.status === DownloadStatus.PENDING
      );
      if (!pendingTask) return;

      this.activeDownloads.add(pendingTask.id);
      pendingTask.status = DownloadStatus.DOWNLOADING;
      this.updateTask(pendingTask);
      const snapshot = this.snapshots.get(pendingTask.id);
      if (snapshot) {
        snapshot.status = 'downloading';
        this.flushSnapshot(snapshot, 'task.updated');
      }

      void this.downloadTask(pendingTask)
        .catch((error) => {
          console.error(
            `[DownloadService] 下载任务失败: ${pendingTask.id}`,
            error
          );
          pendingTask.status = DownloadStatus.FAILED;
          pendingTask.error =
            error instanceof Error ? error.message : String(error);
          this.updateTask(pendingTask);
        })
        .finally(() => {
          const completedSnapshot = this.snapshots.get(pendingTask.id);
          if (completedSnapshot) {
            completedSnapshot.status =
              pendingTask.status === DownloadStatus.COMPLETED
                ? 'completed'
                : pendingTask.status === DownloadStatus.FAILED
                ? 'failed'
                : completedSnapshot.status;
            this.flushSnapshot(completedSnapshot, 'task.updated');
          }
          this.activeDownloads.delete(pendingTask.id);
          void this.processQueue();
        });
    }
  }

  /**
   * 执行下载任务
   */
  private async downloadTask(task: DownloadTask): Promise<void> {
    console.log(
      `[DownloadService] 开始下载任务: ${task.id}, 剧集数: ${task.episodes.length}`
    );

    try {
      // 创建资源目录（如果不存在）
      const localPath = this.storageManager.createResourceDirectory(
        task.resource.title,
        task.resource.year,
        task.source,
        task.resourceId
      );

      // 下载所有剧集（跳过已下载的）
      const downloadedEpisodes: string[] = [];
      const episodeAudits: Record<string, EpisodeDownloadAuditSummary> = {};
      const episodeErrors: string[] = [];
      let totalSize = 0;
      let skippedCount = 0;

      // 读取已有 metadata（支持多次增量下载/断点续下）
      const totalEpisodes = Array.isArray(task.resource.episodes)
        ? task.resource.episodes.length
        : 0;
      const existingMetadata = this.storageManager.readMetadata(localPath);
      const existingEpisodes = existingMetadata?.episodes;
      let alignedEpisodes: string[];
      if (
        Array.isArray(existingEpisodes) &&
        existingEpisodes.length === totalEpisodes
      ) {
        alignedEpisodes = [...existingEpisodes];
      } else if (
        Array.isArray(existingEpisodes) &&
        existingEpisodes.length > 0
      ) {
        // 集数变化时保留已有数据，扩展或截断数组
        alignedEpisodes = new Array(totalEpisodes).fill('');
        for (
          let j = 0;
          j < Math.min(existingEpisodes.length, totalEpisodes);
          j++
        ) {
          if (existingEpisodes[j]) {
            alignedEpisodes[j] = existingEpisodes[j];
          }
        }
      } else {
        alignedEpisodes = new Array(totalEpisodes).fill('');
      }

      for (let i = 0; i < task.episodes.length; i++) {
        // 支持 pause：仅在“集边界”生效（TS 片段并发下载中不强行中断）
        while (task.status === DownloadStatus.PAUSED) {
          await new Promise((r) => setTimeout(r, 500));
        }
        if (task.status === DownloadStatus.CANCELLED) break;

        const episodeUrl = task.episodes[i];
        const episodeIndex = task.episodeNumbers[i] ?? i + 1;

        // 检查剧集是否已下载（强制重下时保留旧版本直到新 generation 提交）
        if (
          !task.forceRedownload &&
          this.storageManager.isEpisodeDownloaded(
            task.source,
            task.resourceId,
            episodeIndex
          )
        ) {
          console.log(
            `[DownloadService] 剧集 ${episodeIndex} 已存在，跳过下载`
          );
          skippedCount++;

          // 获取已下载的剧集路径
          const episodeFileName = `episode_${episodeIndex
            .toString()
            .padStart(2, '0')}.m3u8`;
          const episodeFilePath = path.join(localPath, episodeFileName);
          if (fs.existsSync(episodeFilePath)) {
            downloadedEpisodes.push(episodeFilePath);
            if (alignedEpisodes.length >= episodeIndex) {
              alignedEpisodes[episodeIndex - 1] = episodeFilePath;
            }
          }

          // 更新进度
          const progress = ((i + 1) / task.episodes.length) * 100;
          task.progress = Math.round(progress);
          this.updateTask(task);
          continue;
        }

        let lockPath = '';
        try {
          lockPath = acquireEpisodeLock(localPath, episodeIndex, {
            taskId: task.id,
            pid: process.pid,
            generationId: `${Date.now()}-${task.id}`,
          });
          console.log(
            `[DownloadService] 开始下载剧集 ${episodeIndex}/${task.episodes.length}`
          );
          const { localFilePath, fileSize, audit, rollback, finalize } =
            await this.downloadEpisode(
              episodeUrl,
              localPath,
              episodeIndex,
              {
                taskId: task.id,
                preferParse:
                  task.resource?.source_type === 'official' ||
                  task.resource?.source === 'official',
                forceRedownload: task.forceRedownload,
                addressMethod: task.addressMethod,
              },
              (progress) => {
                // 更新总进度
                const episodeProgress = progress / task.episodes.length;
                const baseProgress = (i / task.episodes.length) * 100;
                task.progress = Math.round(baseProgress + episodeProgress);
                this.updateTask(task);
              }
            );

          downloadedEpisodes.push(localFilePath);
          totalSize += fileSize;
          if (audit) episodeAudits[String(episodeIndex)] = audit;
          if (alignedEpisodes.length >= episodeIndex) {
            alignedEpisodes[episodeIndex - 1] = localFilePath;
          }
          console.log(`[DownloadService] ✓ 剧集 ${episodeIndex} 下载完成`);

          // 增量更新 metadata/index，使已完成集数立即在 TVBox 可见
          const metadataPath = path.join(localPath, 'metadata.json');
          const previousMetadata = fs.existsSync(metadataPath)
            ? fs.readFileSync(metadataPath)
            : null;
          try {
            await this.storageManager.generateMetadata(
              task.resource,
              localPath,
              alignedEpisodes.length > 0 ? alignedEpisodes : downloadedEpisodes,
              totalSize,
              episodeAudits
            );
            this.storageManager.updateIndex(
              task.source,
              task.resourceId,
              task.resource.title,
              task.resource.year,
              localPath
            );
            finalize?.();
            const previousGeneration =
              existingMetadata?.episode_audits?.[String(episodeIndex)]
                ?.generation_id;
            if (
              previousGeneration &&
              audit &&
              previousGeneration !== audit.generation_id
            ) {
              try {
                fs.rmSync(
                  path.join(
                    localPath,
                    `episode_${String(episodeIndex).padStart(
                      2,
                      '0'
                    )}_generations`,
                    previousGeneration
                  ),
                  { recursive: true, force: true }
                );
              } catch (cleanupError) {
                console.warn(
                  '[DownloadService] 旧 generation 清理失败，将保留待后续清理:',
                  cleanupError
                );
              }
            }
          } catch (e) {
            rollback?.();
            if (previousMetadata) {
              fs.writeFileSync(metadataPath, previousMetadata);
            } else {
              fs.rmSync(metadataPath, { force: true });
            }
            throw new Error(
              `metadata 更新失败，已恢复旧版本: ${
                e instanceof Error ? e.message : String(e)
              }`
            );
          }
        } catch (error) {
          console.error(
            `[DownloadService] ✗ 下载剧集 ${episodeIndex} 失败: ${redactDownloadUrl(
              episodeUrl
            )}`,
            error
          );
          episodeErrors.push(
            `第 ${episodeIndex} 集: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          // 继续下载其他剧集
        } finally {
          if (lockPath) releaseEpisodeLock(lockPath);
        }
      }

      // 取消：保留已下载进度（写 metadata/index），但不标记 completed
      if (task.status === DownloadStatus.CANCELLED) {
        await this.storageManager.generateMetadata(
          task.resource,
          localPath,
          alignedEpisodes.length > 0 ? alignedEpisodes : downloadedEpisodes,
          totalSize
        );
        this.storageManager.updateIndex(
          task.source,
          task.resourceId,
          task.resource.title,
          task.resource.year,
          localPath
        );
        this.updateTask(task);
        return;
      }

      if (skippedCount === task.episodes.length) {
        console.log(
          `[DownloadService] 所有剧集已存在，跳过下载: ${task.source}_${task.resourceId}`
        );
        // 重要：即便全部跳过，也要“刷新” metadata/index。
        // 场景：历史版本/手动落盘导致 m3u8 已存在，但 metadata.episodes 仍是空占位，
        // 会导致播放页误判“当前集未下载”。
        try {
          await this.storageManager.generateMetadata(
            task.resource,
            localPath,
            alignedEpisodes.length > 0 ? alignedEpisodes : downloadedEpisodes,
            totalSize
          );
          this.storageManager.updateIndex(
            task.source,
            task.resourceId,
            task.resource.title,
            task.resource.year,
            localPath
          );
        } catch (e) {
          console.warn(
            '[DownloadService] 跳过下载但刷新 metadata/index 失败（可忽略）:',
            e
          );
        }
        task.status = DownloadStatus.COMPLETED;
        task.progress = 100;
        this.updateTask(task);
        return;
      }

      // 生成元数据
      await this.storageManager.generateMetadata(
        task.resource,
        localPath,
        alignedEpisodes.length > 0 ? alignedEpisodes : downloadedEpisodes,
        totalSize,
        episodeAudits
      );

      // 更新资源索引
      this.storageManager.updateIndex(
        task.source,
        task.resourceId,
        task.resource.title,
        task.resource.year,
        localPath
      );

      if (episodeErrors.length > 0) {
        task.status = DownloadStatus.FAILED;
        task.error = episodeErrors.join('; ');
        this.updateTask(task);
        return;
      }

      task.status = DownloadStatus.COMPLETED;
      task.progress = 100;
      this.updateTask(task);

      console.log(`[DownloadService] 下载任务完成: ${task.id}`);
    } catch (error) {
      console.error(`[DownloadService] 下载任务失败: ${task.id}`, error);
      task.status = DownloadStatus.FAILED;
      task.error = error instanceof Error ? error.message : String(error);
      this.updateTask(task);
      throw error;
    }
  }

  /**
   * 下载单个剧集
   */
  private async downloadEpisode(
    url: string,
    localPath: string,
    episodeIndex: number,
    opts?: {
      taskId?: string;
      preferParse?: boolean;
      forceRedownload?: boolean;
      addressMethod?: DownloadTask['addressMethod'];
    },
    progressCallback?: (progress: number) => void
  ): Promise<{
    localFilePath: string;
    fileSize: number;
    audit?: EpisodeDownloadAuditSummary;
    rollback?: () => void;
    finalize?: () => void;
  }> {
    // 检测文件格式
    const isM3U8 =
      url.includes('.m3u8') ||
      url.toLowerCase().includes('m3u8') ||
      url.startsWith('/api/proxy/m3u8');

    if (isM3U8) {
      return this.downloadM3U8(url, localPath, episodeIndex, progressCallback, {
        taskId: opts?.taskId ?? `legacy-${episodeIndex}`,
        sourceUrl: url,
        addressMethod:
          opts?.addressMethod === 'direct' || !opts?.addressMethod
            ? 'direct'
            : opts.addressMethod,
      });
    }

    const preferParse = opts?.preferParse === true;

    // 需要解析的场景：
    // - official 资源（SearchResult.source_type === 'official'）的剧集通常是站外播放页 URL
    // - 或者 URL 本身看起来就是站外播放页（*.html / youku 等）
    if (preferParse || isLikelyWebPageUrl(url)) {
      console.log(
        `[DownloadService] 检测到站外播放页，先解析: ${redactDownloadUrl(url)}`
      );
      const m3u8Url = await parseToM3u8Url(url);
      if (m3u8Url) {
        console.log(
          `[DownloadService] ✓ 解析成功，开始下载 M3U8: ${redactDownloadUrl(
            m3u8Url
          )}`
        );
        return this.downloadM3U8(
          m3u8Url,
          localPath,
          episodeIndex,
          progressCallback,
          {
            taskId: opts?.taskId ?? `legacy-${episodeIndex}`,
            sourceUrl: url,
            addressMethod:
              opts?.addressMethod === 'direct' || !opts?.addressMethod
                ? 'parsed'
                : opts.addressMethod,
          }
        );
      }
      if (preferParse) {
        // official 资源解析失败时，避免落盘成不可播放的 .html 文件，直接让该集失败
        throw new Error('解析失败：无法获取 m3u8_url（官方资源需要解析）');
      }
      console.warn(
        '[DownloadService] ✗ 解析失败，回退为直接文件下载（可能不可播放）'
      );
    }

    return this.downloadDirectFile(
      url,
      localPath,
      episodeIndex,
      progressCallback
    );
  }

  /**
   * 下载 M3U8 文件
   */
  private async downloadM3U8(
    m3u8Url: string,
    localPath: string,
    episodeIndex: number,
    progressCallback?: (progress: number) => void,
    auditContext: {
      taskId: string;
      sourceUrl: string;
      addressMethod: EpisodeDownloadAuditSummary['address_method'];
    } = {
      taskId: `legacy-${episodeIndex}`,
      sourceUrl: m3u8Url,
      addressMethod: 'direct',
    }
  ): Promise<{
    localFilePath: string;
    fileSize: number;
    audit: EpisodeDownloadAuditSummary;
    rollback?: () => void;
    finalize?: () => void;
  }> {
    console.log(`[DownloadService] 下载 M3U8: ${redactDownloadUrl(m3u8Url)}`);

    // 下载 M3U8 播放列表（带重试）
    const m3u8Response = await fetchWithRetry(m3u8Url, {}, 3, 30000);
    if (!m3u8Response.ok) {
      throw new Error(`下载 M3U8 失败: ${m3u8Response.status}`);
    }

    const m3u8Content = await m3u8Response.text();
    const baseUrl = new URL(m3u8Url);

    // 检查是否是主播放列表（Master Playlist）
    const isMasterPlaylist = m3u8Content.includes('#EXT-X-STREAM-INF');

    let mediaPlaylistUrl = m3u8Url;
    let mediaPlaylistContent = m3u8Content;

    if (isMasterPlaylist) {
      console.log(`[DownloadService] 检测到主播放列表，解析子播放列表...`);

      // 解析主播放列表，选择最高带宽的流
      const lines = m3u8Content.split('\n');
      let maxBandwidth = 0;
      let selectedStreamUrl = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
          // 提取带宽信息
          const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
          const bandwidth = bandwidthMatch
            ? parseInt(bandwidthMatch[1], 10)
            : 0;

          // 下一行应该是播放列表 URL
          if (i + 1 < lines.length) {
            const streamUrl = lines[i + 1].trim();
            if (streamUrl && !streamUrl.startsWith('#')) {
              if (bandwidth > maxBandwidth) {
                maxBandwidth = bandwidth;
                selectedStreamUrl = streamUrl;
              }
            }
          }
        }
      }

      if (!selectedStreamUrl) {
        throw new Error('无法从主播放列表中找到子播放列表');
      }

      // 构建子播放列表的完整 URL
      if (!selectedStreamUrl.startsWith('http')) {
        mediaPlaylistUrl = new URL(selectedStreamUrl, baseUrl).href;
      } else {
        mediaPlaylistUrl = selectedStreamUrl;
      }

      console.log(
        `[DownloadService] 选择最高质量流: ${redactDownloadUrl(
          mediaPlaylistUrl
        )} (带宽: ${maxBandwidth})`
      );

      // 下载子播放列表（带重试）
      const mediaResponse = await fetchWithRetry(
        mediaPlaylistUrl,
        {},
        3,
        30000
      );
      if (!mediaResponse.ok) {
        throw new Error(`下载子播放列表失败: ${mediaResponse.status}`);
      }
      mediaPlaylistContent = await mediaResponse.text();
    }

    const epNo = episodeIndex.toString().padStart(2, '0');
    const m3u8FileName = `episode_${epNo}.m3u8`;
    const m3u8FilePath = path.join(localPath, m3u8FileName);
    const generationId = `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const generation = createEpisodeGeneration(
      localPath,
      episodeIndex,
      generationId
    );
    const episodeState = this.ensureEpisodeState(
      auditContext.taskId,
      episodeIndex,
      generationId
    );
    episodeState.addressSource = auditContext.addressMethod;
    const episodeDir = generation.segmentsDir;
    const originalSegmentCount = mediaPlaylistContent
      .split('\n')
      .filter((line) => line.trim() && !line.trim().startsWith('#')).length;
    fs.writeFileSync(generation.rawPlaylistPath, mediaPlaylistContent, 'utf-8');

    try {
      // 落盘前去广告：源 m3u8 含原始 URL，可用全部策略（关键词+域名+DISCONTINUITY）
      let adResult = filterM3U8Ads(mediaPlaylistContent, {
        enableDomain: true,
        enableKeyword: true,
        enableDiscontinuity: true,
      });
      if (adResult.applied) {
        console.log(
          `[DownloadService] 去广告: 删除 ${
            adResult.removedSegments
          } 片段 / ${adResult.removedDurationSec.toFixed(1)}s`
        );
        mediaPlaylistContent = adResult.content;
      } else if (adResult.reason) {
        console.log(`[DownloadService] 未去广告: ${adResult.reason}`);
      }
      fs.writeFileSync(
        generation.cleanedPlaylistPath,
        mediaPlaylistContent,
        'utf-8'
      );

      const originalResources = parseMediaPlaylistResources(
        mediaPlaylistContent,
        mediaPlaylistUrl
      );
      let currentResources = originalResources;
      let refreshPromise: Promise<void> | null = null;
      const refreshResources = (): Promise<void> => {
        if (refreshPromise) return refreshPromise;
        refreshPromise = (async () => {
          if (episodeState.refreshCount >= 1) {
            throw new Error('playlist refresh limit reached');
          }
          const snapshot = this.snapshots.get(auditContext.taskId);
          if (!snapshot) throw new Error('download task snapshot unavailable');
          const reacquired = await this.reacquireEpisode(
            snapshot,
            episodeIndex
          );
          const refreshedAdResult = filterM3U8Ads(reacquired.content, {
            enableDomain: true,
            enableKeyword: true,
            enableDiscontinuity: true,
          });
          const refreshedContent = refreshedAdResult.content;
          const refreshedResources = parseMediaPlaylistResources(
            refreshedContent,
            reacquired.playlistUrl
          );
          episodeState.refreshCount += 1;
          episodeState.addressSource = 'refreshed';
          auditContext.addressMethod = 'refreshed';
          const remapped = remapMediaPlaylistResources(
            originalResources,
            refreshedResources,
            episodeState.completedSegmentIndices
          );
          currentResources = refreshedResources;
          mediaPlaylistUrl = reacquired.playlistUrl;
          mediaPlaylistContent = refreshedContent;
          this.recoveryPlans.set(
            `${auditContext.taskId}:${episodeIndex}`,
            remapped
          );
          fs.writeFileSync(
            generation.cleanedPlaylistPath,
            mediaPlaylistContent,
            'utf-8'
          );
          this.flushSnapshotForTask(auditContext.taskId, 'episode.updated');
        })();
        return refreshPromise;
      };

      // 解析媒体播放列表内容，提取 TS 片段 URL
      const tsUrls: string[] = [];
      const lines = mediaPlaylistContent.split('\n');
      let mediaBaseUrl = new URL(mediaPlaylistUrl);

      // 先处理 KEY：下载并改写 URI 为本地相对路径（episode_XX/key_000.key）
      const keyUrlToIndex = new Map<string, number>();
      const mapUrlToIndex = new Map<string, number>();
      let nextKeyIndex = 0;
      let nextMapIndex = 0;
      const episodePrefix = generation.relativePrefix;

      const downloadKeyByUrl = async (keyAbsUrl: string, keyIndex: number) => {
        const keyNo = String(keyIndex).padStart(3, '0');
        const keyFileName = `key_${keyNo}.key`;
        const keyFilePath = path.join(generation.keysDir, keyFileName);

        const resp = await fetchWithRetry(
          keyAbsUrl,
          {
            headers: {
              // 防盗链/防缓存敏感：Referer 指向媒体播放列表 URL
              Referer: mediaPlaylistUrl,
              Accept: '*/*',
              'Cache-Control': 'no-cache',
              Pragma: 'no-cache',
            },
          },
          1,
          30000
        );
        if (!resp.ok) {
          throw new Error(`下载 KEY 失败: ${resp.status}`);
        }

        const ab = await resp.arrayBuffer();
        const buf = Buffer.from(ab);
        if (buf.length === 0) throw new Error('下载 KEY 为空');
        const expectedLength = Number.parseInt(
          resp.headers.get('content-length') || '0',
          10
        );
        if (expectedLength > 0 && buf.length !== expectedLength) {
          throw new Error(
            `下载 KEY 长度不匹配: ${buf.length}/${expectedLength}`
          );
        }
        const h = sha256Hex(buf);

        // 若已存在但 hash 不同：告警并覆盖（观测优先 + 自愈）
        if (fs.existsSync(keyFilePath)) {
          try {
            const old = fs.readFileSync(keyFilePath);
            const oldHash = sha256Hex(old);
            if (oldHash !== h) {
              console.warn(
                `[DownloadService] ⚠️ KEY hash 变化，将覆盖写入: episode=${episodeIndex}, keyIndex=${keyIndex}, old=${oldHash}, new=${h}`
              );
            }
          } catch {
            // ignore
          }
        }

        fs.writeFileSync(keyFilePath, buf);
        console.log(
          `[DownloadService] ✓ KEY 已写入: episode=${episodeIndex}, keyIndex=${keyIndex}, bytes=${buf.length}, sha256=${h}`
        );
        return { keyFileName };
      };

      const downloadMapByUrl = async (mapAbsUrl: string, mapIndex: number) => {
        const mapFileName = `map_${String(mapIndex).padStart(3, '0')}.mp4`;
        const mapFilePath = path.join(generation.mapsDir, mapFileName);
        const resp = await fetchWithRetry(mapAbsUrl, {}, 1, 30000);
        if (!resp.ok) throw new Error(`下载 MAP 失败: ${resp.status}`);
        const buf = Buffer.from(await resp.arrayBuffer());
        if (buf.length === 0) throw new Error('下载 MAP 为空');
        const expectedLength = Number.parseInt(
          resp.headers.get('content-length') || '0',
          10
        );
        if (expectedLength > 0 && buf.length !== expectedLength) {
          throw new Error(
            `下载 MAP 长度不匹配: ${buf.length}/${expectedLength}`
          );
        }
        fs.writeFileSync(mapFilePath, buf);
      };

      for (const line of lines) {
        const trimmedLine = line.trim();
        // EXT-X-KEY: METHOD=AES-128,URI="..."
        if (trimmedLine.startsWith('#EXT-X-KEY')) {
          // METHOD=NONE 不处理
          if (/METHOD=NONE/i.test(trimmedLine)) {
            continue;
          }
          const m = trimmedLine.match(/URI="([^"]+)"/);
          if (m) {
            const rawKeyUri = m[1];
            let keyAbsUrl = rawKeyUri;
            try {
              keyAbsUrl =
                rawKeyUri.startsWith('http://') ||
                rawKeyUri.startsWith('https://')
                  ? rawKeyUri
                  : new URL(rawKeyUri, mediaBaseUrl).href;
            } catch {
              // keep raw
            }
            let keyIndex = keyUrlToIndex.get(keyAbsUrl);
            if (keyIndex == null) {
              keyIndex = nextKeyIndex++;
              keyUrlToIndex.set(keyAbsUrl, keyIndex);
              episodeState.keyTotal = nextKeyIndex;
              const scheduledKeyIndex = keyIndex;
              const item: DownloadWorkItem = {
                taskId: auditContext.taskId,
                episode: episodeIndex,
                generationId,
                kind: 'key',
                index: keyIndex,
                attempt: 1,
              };
              await this.executeScheduled(
                episodeState,
                item,
                path.join(
                  generation.keysDir,
                  `key_${String(keyIndex).padStart(3, '0')}.key`
                ),
                async () => {
                  const result = await downloadKeyByUrl(
                    currentResources.keys[scheduledKeyIndex]?.url ?? keyAbsUrl,
                    scheduledKeyIndex
                  );
                  return fs.statSync(
                    path.join(generation.keysDir, result.keyFileName)
                  ).size;
                },
                refreshResources
              );
            }
          }
          continue;
        }

        if (trimmedLine.startsWith('#EXT-X-MAP')) {
          const match = trimmedLine.match(/URI="([^"]+)"/);
          if (match) {
            const mapAbsUrl = new URL(match[1], mediaBaseUrl).href;
            let mapIndex = mapUrlToIndex.get(mapAbsUrl);
            if (mapIndex == null) {
              mapIndex = nextMapIndex++;
              mapUrlToIndex.set(mapAbsUrl, mapIndex);
              episodeState.mapTotal = nextMapIndex;
              const scheduledMapIndex = mapIndex;
              const item: DownloadWorkItem = {
                taskId: auditContext.taskId,
                episode: episodeIndex,
                generationId,
                kind: 'map',
                index: mapIndex,
                attempt: 1,
              };
              const mapPath = path.join(
                generation.mapsDir,
                `map_${String(mapIndex).padStart(3, '0')}.mp4`
              );
              await this.executeScheduled(
                episodeState,
                item,
                mapPath,
                async () => {
                  await downloadMapByUrl(
                    currentResources.maps[scheduledMapIndex]?.url ?? mapAbsUrl,
                    scheduledMapIndex
                  );
                  return fs.statSync(mapPath).size;
                },
                refreshResources
              );
            }
          }
          continue;
        }

        if (trimmedLine && !trimmedLine.startsWith('#')) {
          // 相对路径转换为绝对路径
          let tsUrl = trimmedLine;
          if (!tsUrl.startsWith('http')) {
            tsUrl = new URL(tsUrl, mediaBaseUrl).href;
          }
          tsUrls.push(tsUrl);
        }
      }

      episodeState.totalSegments = tsUrls.length;
      episodeState.keyTotal = keyUrlToIndex.size;
      episodeState.mapTotal = mapUrlToIndex.size;
      episodeState.stage = 'downloading';
      this.flushSnapshotForTask(auditContext.taskId, 'episode.updated');

      // 检查已下载的片段
      let existingCount = 0;
      const existingSizes: Map<number, number> = new Map();
      for (let i = 0; i < tsUrls.length; i++) {
        const segmentFileName = `segment_${i.toString().padStart(3, '0')}.ts`;
        const segmentFilePath = path.join(episodeDir, segmentFileName);
        if (fs.existsSync(segmentFilePath)) {
          const stats = fs.statSync(segmentFilePath);
          if (stats.size > 0) {
            existingSizes.set(i, stats.size);
            existingCount++;
          }
        }
      }

      if (existingCount > 0) {
        console.log(
          `[DownloadService] 检测到 ${existingCount}/${tsUrls.length} 个 TS 片段已存在，将跳过下载`
        );
      }

      // 下载所有 TS 片段（使用 p-limit 控制并发）
      let totalSize = 0;
      let completed = 0;
      let skipped = 0;
      const startTime = Date.now();

      const downloadPromises = tsUrls.map((tsUrl, i) => {
        const workItem: DownloadWorkItem = {
          taskId: auditContext.taskId,
          episode: episodeIndex,
          generationId,
          kind: 'segment',
          index: i,
          attempt: 1,
        };
        return (async () => {
          const segmentFileName = `segment_${i.toString().padStart(3, '0')}.ts`;
          const segmentFilePath = path.join(episodeDir, segmentFileName);

          // 检查文件是否已存在
          if (fs.existsSync(segmentFilePath)) {
            const stats = fs.statSync(segmentFilePath);
            if (stats.size > 0) {
              // 文件已存在且大小大于0，跳过下载
              const existingSize = existingSizes.get(i) || stats.size;
              totalSize += existingSize;
              completed++;
              skipped++;

              // 更新进度
              if (progressCallback) {
                const progress = (completed / tsUrls.length) * 100;
                progressCallback(progress);
              }

              // 每完成 10% 或每 50 个片段输出一次日志
              if (
                completed % Math.max(1, Math.floor(tsUrls.length / 10)) === 0 ||
                completed % 50 === 0
              ) {
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                const speed = (completed / parseFloat(elapsed)).toFixed(1);
                console.log(
                  `[DownloadService] TS 片段进度: ${completed}/${
                    tsUrls.length
                  } (${((completed / tsUrls.length) * 100).toFixed(
                    1
                  )}%) - 已跳过: ${skipped}, 速度: ${speed} 片段/秒`
                );
              }
              return;
            }
          }

          // 文件不存在或大小为0，需要下载
          try {
            const segmentSize = await this.executeScheduled(
              episodeState,
              workItem,
              segmentFilePath,
              (reportWrittenBytes) =>
                this.downloadFile(
                  currentResources.segments[i]?.url ?? tsUrl,
                  segmentFilePath,
                  (_progress, writtenBytes) =>
                    reportWrittenBytes?.(writtenBytes)
                ),
              refreshResources
            );
            if (segmentSize <= 0) {
              throw new Error(`下载片段为空: index=${i}`);
            }
            totalSize += segmentSize;
            completed++;

            // 更新进度
            if (progressCallback) {
              const progress = (completed / tsUrls.length) * 100;
              progressCallback(progress);
            }

            // 每完成 10% 或每 50 个片段输出一次日志
            if (
              completed % Math.max(1, Math.floor(tsUrls.length / 10)) === 0 ||
              completed % 50 === 0
            ) {
              const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
              const speed = (completed / parseFloat(elapsed)).toFixed(1);
              console.log(
                `[DownloadService] TS 片段进度: ${completed}/${
                  tsUrls.length
                } (${((completed / tsUrls.length) * 100).toFixed(
                  1
                )}%) - 已跳过: ${skipped}, 速度: ${speed} 片段/秒`
              );
            }
          } catch (error) {
            console.error(
              `[DownloadService] 下载 TS 片段失败 [${i + 1}/${tsUrls.length}]`,
              error
            );
            throw error;
          }
        })();
      });

      // 任一片段失败都不得提交 generation；先取消队列，再等待 active work
      // 全部 settle，确保返回后不会继续写 generation 或修改状态。
      const segmentResults = await Promise.allSettled(downloadPromises);
      const firstFailure = segmentResults.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected' &&
          !(result.reason instanceof DownloadCancelledError)
      );
      if (firstFailure) throw firstFailure.reason;
      const cancellation = segmentResults.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected'
      );
      if (cancellation) throw cancellation.reason;

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const downloadedCount = completed - skipped;
      console.log(
        `[DownloadService] ✓ TS 片段处理完成: ${completed}/${
          tsUrls.length
        } 个片段 (已跳过: ${skipped}, 新下载: ${downloadedCount})，总大小: ${(
          totalSize /
          1024 /
          1024
        ).toFixed(2)}MB，耗时: ${elapsed}秒`
      );

      let localSegmentIndices = tsUrls.map((_, index) => index);
      const segmentByteLengths = localSegmentIndices.map((index) => {
        const segmentFilePath = path.join(
          episodeDir,
          `segment_${index.toString().padStart(3, '0')}.ts`
        );
        return fs.statSync(segmentFilePath).size;
      });
      const metricsAdResult = filterM3U8Ads(mediaPlaylistContent, {
        enableDomain: true,
        enableKeyword: true,
        enableDiscontinuity: true,
        segmentByteLengths,
      });
      if (metricsAdResult.applied) {
        const removedIndices = new Set(
          metricsAdResult.removedSegmentIndices ?? []
        );
        mediaPlaylistContent = metricsAdResult.content;
        localSegmentIndices = localSegmentIndices.filter(
          (index) => !removedIndices.has(index)
        );
        for (const index of removedIndices) {
          fs.rmSync(
            path.join(
              episodeDir,
              `segment_${index.toString().padStart(3, '0')}.ts`
            ),
            { force: true }
          );
        }
        adResult = {
          ...metricsAdResult,
          removedSegments:
            adResult.removedSegments + metricsAdResult.removedSegments,
          removedDurationSec:
            adResult.removedDurationSec + metricsAdResult.removedDurationSec,
          matchedReasons: Array.from(
            new Set([
              ...(adResult.matchedReasons ?? []),
              ...(metricsAdResult.matchedReasons ?? []),
            ])
          ),
        };
        fs.writeFileSync(
          generation.cleanedPlaylistPath,
          mediaPlaylistContent,
          'utf-8'
        );
        console.log(
          `[DownloadService] 下载后去广告: 删除 ${
            metricsAdResult.removedSegments
          } 片段 / ${metricsAdResult.removedDurationSec.toFixed(1)}s`
        );
      }

      // 更新 M3U8 文件中的路径为相对路径（TS + KEY）
      // 始终保存媒体播放列表的内容（因为实际下载的是媒体播放列表的 TS 片段）
      let updatedM3U8Content = mediaPlaylistContent;
      mediaBaseUrl = new URL(mediaPlaylistUrl);
      keyUrlToIndex.clear();
      currentResources.keys.forEach((key) =>
        keyUrlToIndex.set(key.url, key.index)
      );
      mapUrlToIndex.clear();
      currentResources.maps.forEach((map) =>
        mapUrlToIndex.set(map.url, map.index)
      );

      // 改写 KEY URI 为本地相对路径：episode_XX/key_000.key
      if (keyUrlToIndex.size > 0) {
        const mediaLines = updatedM3U8Content.split('\n');
        updatedM3U8Content = mediaLines
          .map((ln) => {
            const t = ln.trim();
            if (!t.startsWith('#EXT-X-KEY')) return ln;
            if (/METHOD=NONE/i.test(t)) return ln;
            const m = t.match(/URI="([^"]+)"/);
            if (!m) return ln;
            const rawKeyUri = m[1];
            let keyAbsUrl = rawKeyUri;
            try {
              keyAbsUrl =
                rawKeyUri.startsWith('http://') ||
                rawKeyUri.startsWith('https://')
                  ? rawKeyUri
                  : new URL(rawKeyUri, mediaBaseUrl).href;
            } catch {
              // ignore
            }
            const idx = keyUrlToIndex.get(keyAbsUrl);
            if (idx == null) return ln;
            const keyRel = `${episodePrefix}/keys/key_${String(idx).padStart(
              3,
              '0'
            )}.key`;
            return ln.replace(/URI="([^"]+)"/, `URI="${keyRel}"`);
          })
          .join('\n');
      }

      if (mapUrlToIndex.size > 0) {
        updatedM3U8Content = updatedM3U8Content
          .split('\n')
          .map((line) => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('#EXT-X-MAP')) return line;
            const match = trimmed.match(/URI="([^"]+)"/);
            if (!match) return line;
            const absolute = new URL(match[1], mediaBaseUrl).href;
            const index = mapUrlToIndex.get(absolute);
            if (index == null) return line;
            return line.replace(
              /URI="([^"]+)"/,
              `URI="${episodePrefix}/maps/map_${String(index).padStart(
                3,
                '0'
              )}.mp4"`
            );
          })
          .join('\n');
      }

      // 按播放列表顺序改写所有媒体片段，兼容查询参数和非 .ts 后缀。
      let segmentIndex = 0;
      updatedM3U8Content = updatedM3U8Content
        .split('\n')
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          const sourceIndex = localSegmentIndices[segmentIndex];
          if (sourceIndex === undefined) return line;
          const rewritten = `${episodePrefix}/segments/segment_${String(
            sourceIndex
          ).padStart(3, '0')}.ts`;
          segmentIndex++;
          return rewritten;
        })
        .join('\n');

      // generation 内先落盘并完整校验，正式入口最后原子切换。
      fs.writeFileSync(generation.playlistPath, updatedM3U8Content, 'utf-8');
      const validation = validateLocalPlaylist(
        generation.playlistPath,
        localPath
      );
      if (validation.references <= 0 || tsUrls.length <= 0) {
        throw new Error('播放列表不包含可提交的媒体片段');
      }
      episodeState.stage = 'committing';
      this.flushSnapshotForTask(auditContext.taskId, 'episode.updated');
      const audit: EpisodeDownloadAuditSummary = {
        generation_id: generationId,
        downloaded_at: Date.now(),
        source_url: redactDownloadUrl(auditContext.sourceUrl),
        media_playlist_url: redactDownloadUrl(mediaPlaylistUrl),
        address_method: auditContext.addressMethod,
        original_segments: originalSegmentCount,
        removed_segments: adResult.removedSegments,
        final_segments: localSegmentIndices.length,
        removed_duration_sec: adResult.removedDurationSec,
        filter_version: 'm3u8-ad-filter-v2',
        filter_reason: adResult.reason,
        filter_reasons: adResult.matchedReasons,
        validation_passed: validation.references > 0,
      };
      const privateReport = {
        ...audit,
        source_url: auditContext.sourceUrl,
        media_playlist_url: mediaPlaylistUrl,
        filter_options: {
          enableDomain: true,
          enableKeyword: true,
          enableDiscontinuity: true,
        },
        raw_sha256: sha256Hex(
          Buffer.from(fs.readFileSync(generation.rawPlaylistPath))
        ),
        cleaned_sha256: sha256Hex(
          Buffer.from(fs.readFileSync(generation.cleanedPlaylistPath))
        ),
        validation: { passed: true, references: validation.references },
      };
      fs.writeFileSync(
        generation.reportPath,
        JSON.stringify(privateReport, null, 2),
        'utf-8'
      );
      const backupPath = `${m3u8FilePath}.${generationId}.bak`;
      const hadActive = fs.existsSync(m3u8FilePath);
      if (hadActive) fs.copyFileSync(m3u8FilePath, backupPath);
      commitPlaylistAtomically(m3u8FilePath, updatedM3U8Content);
      episodeState.stage = 'completed';
      episodeState.oldEntryRetained = false;
      episodeState.recoverable = false;
      this.flushSnapshotForTask(auditContext.taskId, 'task.updated');

      return {
        localFilePath: m3u8FilePath,
        fileSize: totalSize,
        audit,
        rollback: () => {
          if (hadActive) fs.renameSync(backupPath, m3u8FilePath);
          else fs.rmSync(m3u8FilePath, { force: true });
          fs.rmSync(
            generationPathForRemoval(localPath, episodeIndex, generationId),
            { recursive: true, force: true }
          );
        },
        finalize: () => fs.rmSync(backupPath, { force: true }),
      };
    } catch (error) {
      episodeState.stage = 'partial_failed';
      episodeState.oldEntryRetained = fs.existsSync(
        path.join(localPath, `episode_${epNo}.m3u8`)
      );
      episodeState.recoverable = true;
      this.flushSnapshotForTask(auditContext.taskId, 'task.updated');
      const failuresDir = path.join(
        localPath,
        `episode_${epNo}_generations`,
        'failures'
      );
      fs.mkdirSync(failuresDir, { recursive: true });
      fs.writeFileSync(
        path.join(failuresDir, `${generationId}.json`),
        JSON.stringify(
          {
            generation_id: generationId,
            failed_at: Date.now(),
            source_url: auditContext.sourceUrl,
            media_playlist_url: mediaPlaylistUrl,
            address_method: auditContext.addressMethod,
            stage: 'download_or_validation',
            error: error instanceof Error ? error.message : String(error),
          },
          null,
          2
        ),
        'utf-8'
      );
      throw error;
    }
  }

  /**
   * 下载直接文件（MP4、MKV 等）
   */
  private async downloadDirectFile(
    url: string,
    localPath: string,
    episodeIndex: number,
    progressCallback?: (progress: number) => void
  ): Promise<{
    localFilePath: string;
    fileSize: number;
    rollback?: () => void;
    finalize?: () => void;
  }> {
    console.log(`[DownloadService] 下载直接文件: ${redactDownloadUrl(url)}`);

    // 获取文件扩展名
    const urlPath = new URL(url).pathname;
    const ext = path.extname(urlPath) || '.mp4';
    const fileName = `episode_${episodeIndex
      .toString()
      .padStart(2, '0')}${ext}`;
    const filePath = path.join(localPath, fileName);

    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tempPath = `${filePath}.${nonce}.download`;
    const backupPath = `${filePath}.${nonce}.bak`;
    const hadActive = fs.existsSync(filePath);
    try {
      const fileSize = await this.downloadFile(url, tempPath, progressCallback);
      if (fileSize <= 0 || fs.statSync(tempPath).size !== fileSize) {
        throw new Error('直接文件下载不完整');
      }
      if (hadActive) fs.renameSync(filePath, backupPath);
      fs.renameSync(tempPath, filePath);
      return {
        localFilePath: filePath,
        fileSize,
        rollback: () => {
          fs.rmSync(filePath, { force: true });
          if (hadActive) fs.renameSync(backupPath, filePath);
        },
        finalize: () => fs.rmSync(backupPath, { force: true }),
      };
    } catch (error) {
      fs.rmSync(tempPath, { force: true });
      if (hadActive && !fs.existsSync(filePath) && fs.existsSync(backupPath)) {
        fs.renameSync(backupPath, filePath);
      }
      throw error;
    }
  }

  /**
   * 下载文件（通用方法）
   */
  private async downloadFile(
    url: string,
    filePath: string,
    progressCallback?: (progress: number, writtenBytes: number) => void,
    streamIdleTimeoutMs = 60000
  ): Promise<number> {
    // 使用带重试的 fetch（TS 片段下载使用更长的超时时间）
    const response = await fetchWithRetry(url, {}, 1, 60000);
    if (!response.ok) {
      throw new Error(`下载失败: ${response.status}`);
    }

    const contentLength = parseInt(
      response.headers.get('content-length') || '0',
      10
    );

    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error('无法获取响应流');
    }

    const fileStream = fs.createWriteStream(filePath);
    const streamCompletion = finished(fileStream);
    // The stream can fail while the response reader is still pending. Attach a
    // rejection handler immediately so Node does not report it as unhandled;
    // the original promise is still awaited below and drives normal cleanup.
    void streamCompletion.catch(() => undefined);
    let downloaded = 0;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await readStreamChunk(
          reader,
          streamIdleTimeoutMs
        );
        if (done) break;
        const chunk = Buffer.from(value);
        await new Promise<void>((resolve, reject) => {
          fileStream.write(chunk, (error) =>
            error ? reject(error) : resolve()
          );
        });
        downloaded += value.length;
        progressCallback?.(
          contentLength > 0 ? (downloaded / contentLength) * 100 : 0,
          downloaded
        );
        if (contentLength > 0 && downloaded >= contentLength) break;
      }
      fileStream.end();
      await streamCompletion;
      if (downloaded <= 0) {
        throw new Error('下载文件为空');
      }
      if (contentLength > 0 && downloaded !== contentLength) {
        throw new Error(`下载长度不匹配: ${downloaded}/${contentLength}`);
      }
      return downloaded;
    } catch (error) {
      fileStream.destroy();
      fs.rmSync(filePath, { force: true });
      throw error;
    }
  }

  private ensureEpisodeState(
    taskId: string,
    episode: number,
    generationId: string
  ): EpisodeDownloadState {
    let snapshot = this.snapshots.get(taskId);
    if (!snapshot) {
      const now = Date.now();
      snapshot = {
        schemaVersion: 1,
        taskId,
        source: 'legacy',
        resourceId: taskId,
        title: taskId,
        year: '',
        episodeNumbers: [episode],
        status: 'downloading',
        priority: 'normal',
        currentEpisode: episode,
        progress: 0,
        progressEstimated: true,
        speedBytesPerSecond: 0,
        etaSeconds: null,
        completedBytes: 0,
        createdAt: now,
        updatedAt: now,
        episodes: {},
      };
      this.snapshots.set(taskId, snapshot);
    }
    snapshot.status = 'downloading';
    snapshot.currentEpisode = episode;
    const key = String(episode);
    snapshot.episodes[key] ??= {
      episode,
      generationId,
      stage: 'preparing',
      totalSegments: 0,
      completedSegmentIndices: [],
      failedSegmentIndices: [],
      activeItems: [],
      keyTotal: 0,
      keyCompleted: 0,
      mapTotal: 0,
      mapCompleted: 0,
      completedBytes: 0,
      estimatedBytes: null,
      progress: 5,
      progressEstimated: true,
      speedBytesPerSecond: 0,
      etaSeconds: null,
      failures: [],
      oldEntryRetained: true,
      recoverable: true,
      refreshCount: 0,
      updatedAt: Date.now(),
    };
    return snapshot.episodes[key];
  }

  private markUnitCompleted(
    episode: EpisodeDownloadState,
    item: DownloadWorkItem,
    bytes: number
  ): void {
    if (bytes <= 0) throw new Error('downloaded file is empty');
    if (item.kind === 'segment') {
      if (!episode.completedSegmentIndices.includes(item.index)) {
        episode.completedSegmentIndices.push(item.index);
        episode.completedSegmentIndices.sort((a, b) => a - b);
        episode.completedBytes += bytes;
      }
      episode.failedSegmentIndices = episode.failedSegmentIndices.filter(
        (index) => index !== item.index
      );
    } else if (item.kind === 'key') {
      episode.keyCompleted = Math.min(
        episode.keyTotal,
        episode.keyCompleted + 1
      );
    } else {
      episode.mapCompleted = Math.min(
        episode.mapTotal,
        episode.mapCompleted + 1
      );
    }
    episode.failures = episode.failures.filter(
      (failure) => failure.kind !== item.kind || failure.index !== item.index
    );
    const progress = calculateEpisodeProgress(episode);
    episode.progress = progress.progress;
    episode.progressEstimated = progress.estimated;
    episode.updatedAt = Date.now();
  }

  private queueSnapshotFlush(taskId: string): void {
    const pending = this.pendingFlushes.get(taskId) ?? {
      changes: 0,
      timer: null,
    };
    pending.changes += 1;
    this.pendingFlushes.set(taskId, pending);
    if (pending.changes >= 20) {
      this.flushSnapshotForTask(taskId, 'segment.batch');
      return;
    }
    pending.timer ??= setTimeout(
      () => this.flushSnapshotForTask(taskId, 'segment.batch'),
      250
    );
  }

  private flushSnapshotForTask(
    taskId: string,
    eventType: 'task.updated' | 'episode.updated' | 'segment.batch'
  ): void {
    const snapshot = this.snapshots.get(taskId);
    if (snapshot) this.flushSnapshot(snapshot, eventType);
  }

  private flushSnapshot(
    snapshot: DownloadTaskSnapshot,
    eventType: 'task.updated' | 'episode.updated' | 'segment.batch'
  ): void {
    const pending = this.pendingFlushes.get(snapshot.taskId);
    if (pending?.timer) clearTimeout(pending.timer);
    this.pendingFlushes.delete(snapshot.taskId);
    const episodes = Object.values(snapshot.episodes);
    for (const episode of episodes) {
      const progress = calculateEpisodeProgress(episode);
      episode.progress = progress.progress;
      episode.progressEstimated = progress.estimated;
      episode.speedBytesPerSecond = episode.activeItems.reduce(
        (total, item) => total + (item.speedBytesPerSecond ?? 0),
        0
      );
    }
    snapshot.completedBytes = episodes.reduce(
      (total, episode) => total + episode.completedBytes,
      0
    );
    snapshot.progress = episodes.length
      ? episodes.reduce((total, episode) => total + episode.progress, 0) /
        episodes.length
      : snapshot.progress;
    snapshot.progressEstimated = episodes.some(
      (episode) => episode.progressEstimated
    );
    snapshot.speedBytesPerSecond = episodes.reduce(
      (total, episode) => total + episode.speedBytesPerSecond,
      0
    );
    snapshot.updatedAt = Date.now();
    if (
      episodes.length &&
      episodes.every((episode) => episode.stage === 'completed')
    ) {
      snapshot.status = 'completed';
    } else if (episodes.some((episode) => episode.stage === 'partial_failed')) {
      snapshot.status = episodes.some(
        (episode) => episode.stage === 'completed'
      )
        ? 'partial_completed'
        : 'failed';
    }
    this.stateStore.saveTask(snapshot);
    this.publishProgress(eventType, {
      taskId: snapshot.taskId,
      status: snapshot.status,
      progress: snapshot.progress,
      completedBytes: snapshot.completedBytes,
    });
  }

  /**
   * 更新任务状态
   */
  private updateTask(task: DownloadTask): void {
    task.updatedAt = Date.now();
    this.tasks.set(task.id, task);
  }

  /**
   * 获取任务状态
   */
  public getTask(taskId: string): DownloadTask | null {
    return this.tasks.get(taskId) || null;
  }

  public getTaskSummary(taskId: string):
    | DownloadTaskSnapshot
    | {
        taskId: string;
        progress: number;
        progressEstimated: true;
        status: DownloadStatus;
      }
    | null {
    const snapshot = this.snapshots.get(taskId);
    if (snapshot) return snapshot;
    const task = this.tasks.get(taskId);
    if (!task) return null;
    return {
      taskId: task.id,
      progress: task.progress,
      progressEstimated: true,
      status: task.status,
    };
  }

  /**
   * 获取所有任务
   */
  public getAllTasks(): DownloadTask[] {
    this.cleanupHistoryOncePerDay();
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.status === 'pending') this.restorePendingTask(snapshot);
    }
    void this.processQueue();
    return Array.from(this.tasks.values());
  }

  private bumpTaskLifecycle(taskId: string): number {
    const version = (this.taskLifecycleVersions.get(taskId) ?? 0) + 1;
    this.taskLifecycleVersions.set(taskId, version);
    return version;
  }

  private async waitForTaskIdle(taskId: string): Promise<void> {
    while ((this.scheduler.getTaskStats(taskId)?.active ?? 0) > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }

  /**
   * 暂停任务（仅保证在“集边界”生效）
   */
  public pauseTask(taskId: string): CommandResult {
    const snapshot = this.snapshots.get(taskId);
    if (!snapshot) return { ok: false, status: 'not_found' };
    if (!['pending', 'downloading'].includes(snapshot.status)) {
      return { ok: false, status: 'conflict' };
    }
    const lifecycleVersion = this.bumpTaskLifecycle(taskId);
    this.scheduler.pauseTask(taskId);
    Object.values(snapshot.episodes).forEach((episode) => {
      if (!['completed', 'partial_failed'].includes(episode.stage)) {
        episode.stage = 'pausing';
      }
    });
    this.flushSnapshot(snapshot, 'task.updated');
    const settle = () => {
      if (
        this.taskLifecycleVersions.get(taskId) !== lifecycleVersion ||
        this.snapshots.get(taskId) !== snapshot
      ) {
        return;
      }
      const stats = this.scheduler.getTaskStats(taskId);
      if ((stats?.active ?? 0) > 0) {
        setTimeout(settle, 10);
        return;
      }
      snapshot.status = 'paused';
      Object.values(snapshot.episodes).forEach((episode) => {
        if (episode.stage === 'pausing') episode.stage = 'paused';
      });
      const task = this.tasks.get(taskId);
      if (task) {
        task.status = DownloadStatus.PAUSED;
        this.updateTask(task);
      }
      this.flushSnapshot(snapshot, 'task.updated');
    };
    settle();
    return { ok: true, status: snapshot.status };
  }

  /**
   * 恢复任务
   */
  private async downloadRecoveredBinary(
    url: string,
    filePath: string,
    headers: Record<string, string> = {}
  ): Promise<number> {
    const response = await fetchWithRetry(url, { headers }, 1, 30000);
    if (!response.ok) {
      throw new Error(`下载资源失败: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) throw new Error('下载资源为空');
    const expectedLength = Number.parseInt(
      response.headers.get('content-length') || '0',
      10
    );
    if (expectedLength > 0 && buffer.length !== expectedLength) {
      throw new Error(`下载资源长度不匹配: ${buffer.length}/${expectedLength}`);
    }
    fs.writeFileSync(filePath, buffer);
    return buffer.length;
  }

  private buildLocalPlaylist(
    content: string,
    playlistUrl: string,
    resources: ParsedMediaPlaylistResources,
    relativePrefix: string
  ): string {
    const baseUrl = new URL(playlistUrl);
    let segmentIndex = 0;
    return content
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('#EXT-X-KEY') && !/METHOD=NONE/i.test(trimmed)) {
          const match = trimmed.match(/URI="([^"]+)"/i);
          if (!match) return line;
          const absolute = new URL(match[1], baseUrl).href;
          const relationship = trimmed
            .replace(/URI="[^"]+"/i, 'URI="<redacted>"')
            .replace(/\s+/g, '');
          const key = resources.keys.find(
            (candidate) =>
              candidate.url === absolute &&
              candidate.relationship === relationship
          );
          if (!key) throw new Error('playlist structure mismatch');
          return line.replace(
            /URI="[^"]+"/i,
            `URI="${relativePrefix}/keys/key_${String(key.index).padStart(
              3,
              '0'
            )}.key"`
          );
        }
        if (trimmed.startsWith('#EXT-X-MAP')) {
          const match = trimmed.match(/URI="([^"]+)"/i);
          if (!match) return line;
          const absolute = new URL(match[1], baseUrl).href;
          const relationship = trimmed
            .replace(/URI="[^"]+"/i, 'URI="<redacted>"')
            .replace(/\s+/g, '');
          const map = resources.maps.find(
            (candidate) =>
              candidate.url === absolute &&
              candidate.relationship === relationship
          );
          if (!map) throw new Error('playlist structure mismatch');
          return line.replace(
            /URI="[^"]+"/i,
            `URI="${relativePrefix}/maps/map_${String(map.index).padStart(
              3,
              '0'
            )}.mp4"`
          );
        }
        if (!trimmed || trimmed.startsWith('#')) return line;
        const local = `${relativePrefix}/segments/segment_${String(
          segmentIndex
        ).padStart(3, '0')}.ts`;
        segmentIndex += 1;
        return local;
      })
      .join('\n');
  }

  private async executeRecoveredEpisode(
    snapshot: DownloadTaskSnapshot,
    episode: EpisodeDownloadState,
    resourcePath: string,
    refreshedContent: string,
    playlistUrl: string,
    refreshed: ParsedMediaPlaylistResources,
    remapped: RemappedMediaPlaylistResources
  ): Promise<void> {
    const episodeNumber = String(episode.episode).padStart(2, '0');
    const relativePrefix = `episode_${episodeNumber}_generations/${episode.generationId}`;
    const generationRoot = path.join(resourcePath, relativePrefix);
    const segmentsDir = path.join(generationRoot, 'segments');
    const keysDir = path.join(generationRoot, 'keys');
    const mapsDir = path.join(generationRoot, 'maps');
    fs.mkdirSync(segmentsDir, { recursive: true });
    fs.mkdirSync(keysDir, { recursive: true });
    fs.mkdirSync(mapsDir, { recursive: true });

    const validExisting = (filePath: string) =>
      fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
    episode.keyTotal = refreshed.keys.length;
    episode.mapTotal = refreshed.maps.length;
    episode.keyCompleted = refreshed.keys.filter((key) =>
      validExisting(
        path.join(keysDir, `key_${String(key.index).padStart(3, '0')}.key`)
      )
    ).length;
    episode.mapCompleted = refreshed.maps.filter((map) =>
      validExisting(
        path.join(mapsDir, `map_${String(map.index).padStart(3, '0')}.mp4`)
      )
    ).length;

    for (const key of refreshed.keys) {
      const keyPath = path.join(
        keysDir,
        `key_${String(key.index).padStart(3, '0')}.key`
      );
      if (validExisting(keyPath)) continue;
      await this.executeScheduled(
        episode,
        {
          taskId: snapshot.taskId,
          episode: episode.episode,
          generationId: episode.generationId,
          kind: 'key',
          index: key.index,
          attempt: 1,
        },
        keyPath,
        () =>
          this.downloadRecoveredBinary(key.url, keyPath, {
            Referer: playlistUrl,
          })
      );
    }
    for (const map of refreshed.maps) {
      const mapPath = path.join(
        mapsDir,
        `map_${String(map.index).padStart(3, '0')}.mp4`
      );
      if (validExisting(mapPath)) continue;
      await this.executeScheduled(
        episode,
        {
          taskId: snapshot.taskId,
          episode: episode.episode,
          generationId: episode.generationId,
          kind: 'map',
          index: map.index,
          attempt: 1,
        },
        mapPath,
        () => this.downloadRecoveredBinary(map.url, mapPath)
      );
    }
    const segmentResults = await Promise.allSettled(
      remapped.pendingSegments.map((segment) => {
        const segmentPath = path.join(
          segmentsDir,
          `segment_${String(segment.index).padStart(3, '0')}.ts`
        );
        return this.executeScheduled(
          episode,
          {
            taskId: snapshot.taskId,
            episode: episode.episode,
            generationId: episode.generationId,
            kind: 'segment',
            index: segment.index,
            attempt: 1,
          },
          segmentPath,
          async (reportWrittenBytes) => {
            const temporaryPath = `${segmentPath}.download`;
            fs.rmSync(temporaryPath, { force: true });
            try {
              const bytes = await this.downloadFile(
                segment.url,
                temporaryPath,
                (_progress, writtenBytes) => reportWrittenBytes?.(writtenBytes)
              );
              fs.renameSync(temporaryPath, segmentPath);
              return bytes;
            } finally {
              fs.rmSync(temporaryPath, { force: true });
            }
          },
          undefined,
          false
        );
      })
    );
    const failedSegment = segmentResults.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (failedSegment) throw failedSegment.reason;

    const localPlaylist = this.buildLocalPlaylist(
      refreshedContent,
      playlistUrl,
      refreshed,
      relativePrefix
    );
    const playlistPath = path.join(generationRoot, 'playlist.m3u8');
    fs.writeFileSync(playlistPath, localPlaylist, 'utf-8');
    validateLocalPlaylist(playlistPath, resourcePath);
    commitPlaylistAtomically(
      path.join(resourcePath, `episode_${episodeNumber}.m3u8`),
      localPlaylist
    );
    episode.failedSegmentIndices = [];
    episode.stage = 'completed';
    episode.oldEntryRetained = false;
    episode.recoverable = false;
  }

  private resolveSnapshotResourcePath(snapshot: DownloadTaskSnapshot): string {
    const resolver = (
      this.storageManager as StorageManager & {
        resolveExistingResourcePath?: StorageManager['getResourcePath'];
      }
    ).resolveExistingResourcePath;
    if (typeof resolver === 'function') {
      return resolver.call(
        this.storageManager,
        snapshot.title,
        snapshot.year,
        snapshot.source,
        snapshot.resourceId
      );
    }
    return this.storageManager.getResourcePath(
      snapshot.title,
      snapshot.year,
      snapshot.source,
      snapshot.resourceId
    );
  }

  public async resumeTask(
    taskId: string,
    currentResource?: SearchResult
  ): Promise<CommandResult> {
    const snapshot = this.snapshots.get(taskId);
    if (!snapshot) return { ok: false, status: 'not_found' };
    if (snapshot.status === 'pending') {
      if (!this.restorePendingTask(snapshot)) {
        return { ok: false, status: 'conflict' };
      }
      await this.processQueue();
      const task = this.tasks.get(taskId);
      return {
        ok: true,
        status:
          task?.status === DownloadStatus.DOWNLOADING
            ? 'downloading'
            : 'pending',
      };
    }
    if (
      ![
        'paused',
        'recovery_wait',
        'cancelled_resumable',
        'partial_completed',
        'failed',
      ].includes(snapshot.status) ||
      (['partial_completed', 'failed'].includes(snapshot.status) &&
        !Object.values(snapshot.episodes).some(
          (episode) => episode.recoverable
        ))
    ) {
      return { ok: false, status: 'conflict' };
    }
    this.bumpTaskLifecycle(taskId);
    const scheduled = this.scheduler.getTaskStats(taskId);
    if ((scheduled?.active ?? 0) > 0 || (scheduled?.queued ?? 0) > 0) {
      this.scheduler.resumeTask(taskId);
      snapshot.status = 'downloading';
      Object.values(snapshot.episodes).forEach((episode) => {
        if (episode.stage === 'paused' || episode.stage === 'pausing') {
          episode.stage = 'downloading';
        }
      });
      this.flushSnapshot(snapshot, 'task.updated');
      return { ok: true, status: snapshot.status };
    }
    const resourcePath = this.resolveSnapshotResourcePath(snapshot);
    this.scheduler.resumeTask(taskId);
    try {
      for (const episode of Object.values(snapshot.episodes)) {
        if (episode.stage === 'completed') continue;
        const generationRoot = containedGenerationPath(
          resourcePath,
          episode.episode,
          episode.generationId
        );
        const cleanedPlaylistPath = path.join(
          generationRoot,
          'source.cleaned.m3u8'
        );
        const originalContent = fs.readFileSync(cleanedPlaylistPath, 'utf-8');
        const original = parseMediaPlaylistResources(
          originalContent,
          'https://resume.invalid/playlist.m3u8'
        );
        const segmentsPath = path.join(generationRoot, 'segments');
        const completedBeforeRestart = new Set(episode.completedSegmentIndices);
        const interruptedIndices = new Set(
          episode.activeItems
            .filter(
              (item) =>
                item.kind === 'segment' &&
                !completedBeforeRestart.has(item.index)
            )
            .map((item) => item.index)
        );
        episode.activeItems = [];
        const discoveredIndices = fs.existsSync(segmentsPath)
          ? fs
              .readdirSync(segmentsPath)
              .map((name) => /^segment_(\d+)\.ts$/.exec(name))
              .filter((match): match is RegExpExecArray => match !== null)
              .map((match) => Number(match[1]))
              .filter(
                (index) =>
                  index < original.segments.length &&
                  !interruptedIndices.has(index)
              )
          : [];
        const files = Array.from(
          new Set([...episode.completedSegmentIndices, ...discoveredIndices])
        ).map((index) => ({
          index,
          path: path.join(
            segmentsPath,
            `segment_${String(index).padStart(3, '0')}.ts`
          ),
        }));
        const validation = validateResumeFiles(files);
        episode.completedSegmentIndices = validation.valid;
        episode.failedSegmentIndices = Array.from(
          new Set([...episode.failedSegmentIndices, ...validation.invalid])
        );
        episode.completedBytes = validation.bytes;
        const reacquired = await this.reacquireForResume(
          snapshot,
          episode.episode,
          currentResource,
          originalContent
        );
        const refreshedAdResult = filterM3U8Ads(reacquired.content, {
          enableDomain: true,
          enableKeyword: true,
          enableDiscontinuity: true,
        });
        episode.refreshCount = Math.max(1, episode.refreshCount);
        episode.addressSource = reacquired.addressSource ?? 'refreshed';
        const refreshed = parseMediaPlaylistResources(
          refreshedAdResult.content,
          reacquired.playlistUrl
        );
        const remapped = remapMediaPlaylistResources(
          original,
          refreshed,
          episode.completedSegmentIndices
        );
        this.recoveryPlans.set(`${taskId}:${episode.episode}`, remapped);
        episode.failedSegmentIndices = remapped.pendingSegments.map(
          (segment) => segment.index
        );
        episode.stage = 'downloading';
        await this.executeRecoveredEpisode(
          snapshot,
          episode,
          resourcePath,
          refreshedAdResult.content,
          reacquired.playlistUrl,
          refreshed,
          remapped
        );
      }
      const episodePaths = Array.from(
        { length: Math.max(0, ...snapshot.episodeNumbers) },
        () => ''
      );
      for (const episodeNumber of snapshot.episodeNumbers) {
        const episodePath = path.join(
          resourcePath,
          `episode_${String(episodeNumber).padStart(2, '0')}.m3u8`
        );
        if (fs.existsSync(episodePath))
          episodePaths[episodeNumber - 1] = episodePath;
      }
      await this.storageManager.generateMetadata(
        {
          id: snapshot.resourceId,
          title: snapshot.title,
          poster: snapshot.poster || '',
          episodes: snapshot.episodeNumbers.map(() => ''),
          source: snapshot.source,
          source_name: snapshot.source,
          year: snapshot.year,
        },
        resourcePath,
        episodePaths,
        Object.values(snapshot.episodes).reduce(
          (total, episode) => total + episode.completedBytes,
          0
        ),
        {}
      );
      this.storageManager.updateIndex(
        snapshot.source,
        snapshot.resourceId,
        snapshot.title,
        snapshot.year,
        resourcePath
      );
    } catch (error) {
      snapshot.status = 'failed';
      Object.values(snapshot.episodes).forEach((episode) => {
        if (episode.stage === 'completed') return;
        episode.stage = 'partial_failed';
        episode.oldEntryRetained = true;
        episode.recoverable = true;
        episode.failures.push({
          kind: 'segment',
          index: -1,
          category: 'other',
          attempts: 1,
          path: '',
          message: redactDownloadUrl(
            error instanceof Error ? error.message : String(error)
          ),
        });
      });
      this.flushSnapshot(snapshot, 'task.updated');
      return { ok: false, status: snapshot.status };
    }
    snapshot.status = Object.values(snapshot.episodes).every(
      (episode) => episode.stage === 'completed'
    )
      ? 'completed'
      : 'downloading';
    this.flushSnapshot(snapshot, 'task.updated');
    const task = this.tasks.get(taskId);
    if (task) {
      task.status =
        snapshot.status === 'completed'
          ? DownloadStatus.COMPLETED
          : this.activeDownloads.has(taskId)
          ? DownloadStatus.DOWNLOADING
          : DownloadStatus.PENDING;
      this.updateTask(task);
      this.processQueue();
    }
    return { ok: true, status: snapshot.status };
  }

  public startResumeTask(taskId: string): CommandResult {
    const running = this.resumeOperations.get(taskId);
    if (running) {
      return { ok: true, status: 'downloading' };
    }

    const snapshot = this.snapshots.get(taskId);
    if (!snapshot) return { ok: false, status: 'not_found' };
    const resumableStatuses = [
      'pending',
      'paused',
      'recovery_wait',
      'cancelled_resumable',
      'partial_completed',
      'failed',
    ];
    if (
      !resumableStatuses.includes(snapshot.status) ||
      (['partial_completed', 'failed'].includes(snapshot.status) &&
        !Object.values(snapshot.episodes).some(
          (episode) => episode.recoverable
        ))
    ) {
      return { ok: false, status: 'conflict' };
    }

    const operation = this.resumeTask(taskId);
    this.resumeOperations.set(taskId, operation);
    snapshot.status = 'downloading';
    Object.values(snapshot.episodes).forEach((episode) => {
      if (episode.stage !== 'completed') episode.stage = 'downloading';
    });
    this.flushSnapshot(snapshot, 'task.updated');
    void operation.then(
      () => {
        if (this.resumeOperations.get(taskId) === operation) {
          this.resumeOperations.delete(taskId);
        }
      },
      () => {
        if (this.resumeOperations.get(taskId) === operation) {
          this.resumeOperations.delete(taskId);
        }
      }
    );
    return { ok: true, status: 'downloading' };
  }

  private async reacquireForResume(
    snapshot: DownloadTaskSnapshot,
    episode: number,
    currentResource?: SearchResult,
    savedManifest?: string
  ): Promise<{
    playlistUrl: string;
    content: string;
    addressSource?: DownloadAddressSource;
  }> {
    if (currentResource) {
      return reacquireEpisodeFromCurrentResource(currentResource, episode);
    }

    const persistedEntry = snapshot.recovery?.episodeEntries[String(episode)];
    if (persistedEntry) {
      try {
        return await reacquireEpisodeFromEntry(persistedEntry);
      } catch {
        // Signed or parsed entries may expire. The stable source recipe is the
        // authoritative second chance and deliberately stores no credentials.
      }
    }

    try {
      return await this.reacquireEpisode(snapshot, episode);
    } catch {
      const savedSegments = savedManifest
        ?.split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
      if (
        savedManifest &&
        savedSegments?.length &&
        savedSegments.every((entry) => /^https?:\/\//i.test(entry))
      ) {
        return {
          playlistUrl: 'https://resume.invalid/playlist.m3u8',
          content: savedManifest,
          addressSource: 'historical_fallback',
        };
      }
      throw new Error(
        persistedEntry
          ? '自动刷新下载地址失败，请重新选择来源'
          : '旧任务缺少恢复入口，请重新选择来源'
      );
    }
  }

  /**
   * 取消任务
   */
  public async cancelTask(
    taskId: string,
    clean = false
  ): Promise<CommandResult> {
    const snapshot = this.snapshots.get(taskId);
    if (!snapshot) return { ok: false, status: 'not_found' };
    if (snapshot.status === 'completed')
      return { ok: false, status: 'conflict' };
    this.bumpTaskLifecycle(taskId);
    this.scheduler.pauseTask(taskId);
    this.scheduler.cancelQueued(taskId);
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = DownloadStatus.CANCELLED;
      this.updateTask(task);
    }
    if (clean) {
      await this.waitForTaskIdle(taskId);
      const resourcePath = this.resolveSnapshotResourcePath(snapshot);
      for (const episode of Object.values(snapshot.episodes)) {
        if (episode.stage === 'completed') continue;
        const generationRoot = generationPathForRemoval(
          resourcePath,
          episode.episode,
          episode.generationId
        );
        fs.rmSync(generationRoot, { recursive: true, force: true });
      }
      const pending = this.pendingFlushes.get(taskId);
      if (pending?.timer) clearTimeout(pending.timer);
      this.pendingFlushes.delete(taskId);
      this.stateStore.deleteTaskState(taskId);
      this.snapshots.delete(taskId);
      return { ok: true, status: 'cancelled_resumable' };
    }
    snapshot.status = 'cancelled_resumable';
    Object.values(snapshot.episodes).forEach((episode) => {
      if (episode.stage !== 'completed') episode.stage = 'cancelled_resumable';
    });
    this.flushSnapshot(snapshot, 'task.updated');
    return { ok: true, status: snapshot.status };
  }

  private commitRetriedEpisode(
    snapshot: DownloadTaskSnapshot,
    episode: EpisodeDownloadState
  ): void {
    const resourcePath = this.resolveSnapshotResourcePath(snapshot);
    const episodeNumber = String(episode.episode).padStart(2, '0');
    const relativePrefix = `episode_${episodeNumber}_generations/${episode.generationId}`;
    const generationRoot = path.join(resourcePath, relativePrefix);
    const cleanedPlaylistPath = path.join(
      generationRoot,
      'source.cleaned.m3u8'
    );
    const content = fs.readFileSync(cleanedPlaylistPath, 'utf-8');
    const retryBaseUrl = 'https://retry.invalid/playlist.m3u8';
    const resources = parseMediaPlaylistResources(content, retryBaseUrl);
    const localPlaylist = this.buildLocalPlaylist(
      content,
      retryBaseUrl,
      resources,
      relativePrefix
    );
    const playlistPath = path.join(generationRoot, 'playlist.m3u8');
    fs.writeFileSync(playlistPath, localPlaylist, 'utf-8');
    validateLocalPlaylist(playlistPath, resourcePath);
    episode.stage = 'committing';
    commitPlaylistAtomically(
      path.join(resourcePath, `episode_${episodeNumber}.m3u8`),
      localPlaylist
    );
    episode.stage = 'completed';
    episode.oldEntryRetained = false;
    episode.recoverable = false;
  }

  public async retryFailed(taskId: string): Promise<CommandResult> {
    const snapshot = this.snapshots.get(taskId);
    if (!snapshot) return { ok: false, status: 'not_found' };
    const failed = Array.from(this.failedWork.values()).filter(
      ({ item }) => item.taskId === taskId
    );
    if (failed.length === 0) return { ok: false, status: 'conflict' };
    snapshot.status = 'downloading';
    await Promise.allSettled(
      failed.map(({ item, operation, path: failedPath }) => {
        const episode = snapshot.episodes[String(item.episode)];
        if (!episode) return Promise.resolve();
        episode.stage = 'downloading';
        return this.executeScheduled(episode, item, failedPath, operation);
      })
    );
    let stillFailed = Array.from(this.failedWork.values()).some(
      ({ item }) => item.taskId === taskId
    );
    if (!stillFailed) {
      const affectedEpisodes = Array.from(
        new Set(failed.map(({ item }) => item.episode))
      );
      for (const episodeNumber of affectedEpisodes) {
        const episode = snapshot.episodes[String(episodeNumber)];
        if (!episode) continue;
        try {
          this.commitRetriedEpisode(snapshot, episode);
        } catch (error) {
          stillFailed = true;
          episode.stage = 'partial_failed';
          episode.oldEntryRetained = true;
          episode.recoverable = true;
          episode.failures.push({
            kind: 'segment',
            index: -1,
            category: this.classifyFailure(error),
            attempts: 1,
            path: '',
            message: redactDownloadUrl(
              error instanceof Error ? error.message : String(error)
            ),
          });
        }
      }
    }
    if (stillFailed) {
      snapshot.status = 'failed';
      Object.values(snapshot.episodes).forEach((episode) => {
        if (episode.failures.length) episode.stage = 'partial_failed';
      });
    } else if (
      Object.values(snapshot.episodes).every(
        (episode) => episode.stage === 'completed'
      )
    ) {
      snapshot.status = 'completed';
    }
    this.flushSnapshot(snapshot, 'task.updated');
    return { ok: !stillFailed, status: snapshot.status };
  }

  public prioritizeTask(taskId: string): CommandResult {
    const snapshot = this.snapshots.get(taskId);
    if (!snapshot) return { ok: false, status: 'not_found' };
    snapshot.priority = 'high';
    this.scheduler.setPriority(taskId, 'high');
    this.flushSnapshot(snapshot, 'task.updated');
    return { ok: true, status: snapshot.status };
  }
}

// 单例实例
let downloadServiceInstance: DownloadService | null = null;

/**
 * 获取下载服务实例
 */
export function getDownloadService(): DownloadService {
  if (!downloadServiceInstance) {
    downloadServiceInstance = new DownloadService();
  }
  return downloadServiceInstance;
}
