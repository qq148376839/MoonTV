/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-require-imports */

import { createHash } from 'crypto';
import fs from 'fs';
// @ts-expect-error - p-limit is ESM but works in Next.js Node.js runtime
import pLimit from 'p-limit';
import path from 'path';

import { filterM3U8Ads } from './ad-filter';
import { getStorageManager, StorageManager } from './local-storage';
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
        `[DownloadService] 请求失败，${waitTime}ms 后重试 (${attempt}/${maxRetries}): ${url}`
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  throw lastError || new Error('请求失败');
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

// 下载服务类
export class DownloadService {
  private storageManager: StorageManager;
  private tasks: Map<string, DownloadTask> = new Map();
  private maxConcurrent: number;
  private activeDownloads: Set<string> = new Set();
  private tsConcurrent: number;
  private tsLimit: ReturnType<typeof pLimit>;

  constructor() {
    this.storageManager = getStorageManager();
    this.maxConcurrent =
      parseInt(process.env.LOCAL_STORAGE_MAX_CONCURRENT || '3', 10) || 3;

    // TS 片段并发数配置
    this.tsConcurrent =
      parseInt(process.env.LOCAL_STORAGE_TS_CONCURRENT || '5', 10) || 5;

    // 创建 p-limit 实例用于控制 TS 片段并发下载
    this.tsLimit = pLimit(this.tsConcurrent);

    console.log(
      `[DownloadService] 初始化完成 - 任务并发: ${this.maxConcurrent}, TS片段并发: ${this.tsConcurrent}`
    );
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
    const episodesKey = [...episodeNumbers].sort((a, b) => a - b).join(',');

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
      const taskEpisodesKey = [...task.episodeNumbers]
        .sort((a, b) => a - b)
        .join(',');
      if (taskEpisodesKey === episodesKey) {
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
    episodeNumbers?: number[]
  ): DownloadTask {
    const episodesToDownload = Array.isArray(episodes)
      ? episodes.filter(Boolean)
      : [];
    const numbersToDownload =
      Array.isArray(episodeNumbers) &&
      episodeNumbers.length === episodesToDownload.length
        ? episodeNumbers
        : episodesToDownload.map((_, i) => i + 1);

    // 检查是否所有剧集都已完全下载
    const allDownloaded = this.areAllEpisodesDownloaded(
      resource.source,
      resource.id,
      numbersToDownload
    );

    if (allDownloaded) {
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
        status: DownloadStatus.COMPLETED,
        progress: 100,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      // 不添加到任务列表，直接返回
      return completedTask;
    }

    // 检查是否有相同资源+剧集的正在进行的任务
    const existingTask = this.findExistingTask(
      resource.source,
      resource.id,
      numbersToDownload
    );

    if (existingTask) {
      console.log(
        `[DownloadService] 发现已有相同下载任务: ${existingTask.id} (${resource.source}_${resource.id}, 剧集数: ${episodesToDownload.length})`
      );
      return existingTask;
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
      status: DownloadStatus.PENDING,
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.tasks.set(taskId, task);
    this.processQueue();

    return task;
  }

  /**
   * 处理下载队列
   */
  private async processQueue(): Promise<void> {
    // 如果已达到最大并发数，等待
    if (this.activeDownloads.size >= this.maxConcurrent) {
      return;
    }

    // 查找待处理的任务
    const pendingTask = Array.from(this.tasks.values()).find(
      (task) => task.status === DownloadStatus.PENDING
    );

    if (!pendingTask) {
      return;
    }

    // 开始下载
    this.activeDownloads.add(pendingTask.id);
    pendingTask.status = DownloadStatus.DOWNLOADING;
    this.updateTask(pendingTask);

    // 异步执行下载
    this.downloadTask(pendingTask)
      .then(() => {
        this.activeDownloads.delete(pendingTask.id);
        this.processQueue(); // 处理下一个任务
      })
      .catch((error) => {
        console.error(
          `[DownloadService] 下载任务失败: ${pendingTask.id}`,
          error
        );
        pendingTask.status = DownloadStatus.FAILED;
        pendingTask.error =
          error instanceof Error ? error.message : String(error);
        this.updateTask(pendingTask);
        this.activeDownloads.delete(pendingTask.id);
        this.processQueue(); // 处理下一个任务
      });
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
      let totalSize = 0;
      let skippedCount = 0;

      // 读取已有 metadata（支持多次增量下载/断点续下）
      const totalEpisodes = Array.isArray(task.resource.episodes)
        ? task.resource.episodes.length
        : 0;
      const existingMetadata = this.storageManager.readMetadata(localPath);
      const existingEpisodes = existingMetadata?.episodes;
      let alignedEpisodes: string[];
      if (Array.isArray(existingEpisodes) && existingEpisodes.length === totalEpisodes) {
        alignedEpisodes = [...existingEpisodes];
      } else if (Array.isArray(existingEpisodes) && existingEpisodes.length > 0) {
        // 集数变化时保留已有数据，扩展或截断数组
        alignedEpisodes = new Array(totalEpisodes).fill('');
        for (let j = 0; j < Math.min(existingEpisodes.length, totalEpisodes); j++) {
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

        // 检查剧集是否已下载
        if (
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

        try {
          console.log(
            `[DownloadService] 开始下载剧集 ${episodeIndex}/${task.episodes.length}`
          );
          const { localFilePath, fileSize } = await this.downloadEpisode(
            episodeUrl,
            localPath,
            episodeIndex,
            {
              preferParse:
                task.resource?.source_type === 'official' ||
                task.resource?.source === 'official',
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
          if (alignedEpisodes.length >= episodeIndex) {
            alignedEpisodes[episodeIndex - 1] = localFilePath;
          }
          console.log(`[DownloadService] ✓ 剧集 ${episodeIndex} 下载完成`);

          // 增量更新 metadata/index，使已完成集数立即在 TVBox 可见
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
            console.warn(`[DownloadService] 增量更新 metadata 失败（不影响下载）:`, e);
          }
        } catch (error) {
          console.error(
            `[DownloadService] ✗ 下载剧集 ${episodeIndex} 失败: ${episodeUrl}`,
            error
          );
          // 继续下载其他剧集
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
        totalSize
      );

      // 更新资源索引
      this.storageManager.updateIndex(
        task.source,
        task.resourceId,
        task.resource.title,
        task.resource.year,
        localPath
      );

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
    opts?: { preferParse?: boolean },
    progressCallback?: (progress: number) => void
  ): Promise<{ localFilePath: string; fileSize: number }> {
    // 检测文件格式
    const isM3U8 =
      url.includes('.m3u8') ||
      url.toLowerCase().includes('m3u8') ||
      url.startsWith('/api/proxy/m3u8');

    if (isM3U8) {
      return this.downloadM3U8(url, localPath, episodeIndex, progressCallback);
    }

    const preferParse = opts?.preferParse === true;

    // 需要解析的场景：
    // - official 资源（SearchResult.source_type === 'official'）的剧集通常是站外播放页 URL
    // - 或者 URL 本身看起来就是站外播放页（*.html / youku 等）
    if (preferParse || isLikelyWebPageUrl(url)) {
      console.log(
        `[DownloadService] 检测到站外播放页，先解析: ${url.substring(0, 120)}`
      );
      const m3u8Url = await parseToM3u8Url(url);
      if (m3u8Url) {
        console.log(
          `[DownloadService] ✓ 解析成功，开始下载 M3U8: ${m3u8Url.substring(
            0,
            120
          )}`
        );
        return this.downloadM3U8(
          m3u8Url,
          localPath,
          episodeIndex,
          progressCallback
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
    progressCallback?: (progress: number) => void
  ): Promise<{ localFilePath: string; fileSize: number }> {
    console.log(`[DownloadService] 下载 M3U8: ${m3u8Url}`);

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
        `[DownloadService] 选择最高质量流: ${mediaPlaylistUrl} (带宽: ${maxBandwidth})`
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

    const m3u8FileName = `episode_${episodeIndex
      .toString()
      .padStart(2, '0')}.m3u8`;
    const m3u8FilePath = path.join(localPath, m3u8FileName);

    // 创建剧集目录
    const episodeDir = path.join(
      localPath,
      `episode_${episodeIndex.toString().padStart(2, '0')}`
    );
    if (!fs.existsSync(episodeDir)) {
      fs.mkdirSync(episodeDir, { recursive: true });
    }

    // 落盘前去广告：源 m3u8 含原始 URL，可用全部策略（关键词+域名+DISCONTINUITY）
    {
      const adResult = filterM3U8Ads(mediaPlaylistContent, {
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
    }

    // 解析媒体播放列表内容，提取 TS 片段 URL
    const tsUrls: string[] = [];
    const lines = mediaPlaylistContent.split('\n');
    const mediaBaseUrl = new URL(mediaPlaylistUrl);

    // 先处理 KEY：下载并改写 URI 为本地相对路径（episode_XX/key_000.key）
    const keyUrlToIndex = new Map<string, number>();
    let nextKeyIndex = 0;
    const epNo = episodeIndex.toString().padStart(2, '0');
    const episodePrefix = `episode_${epNo}`;

    const downloadKeyByUrl = async (keyAbsUrl: string, keyIndex: number) => {
      const keyNo = String(keyIndex).padStart(3, '0');
      const keyFileName = `key_${keyNo}.key`;
      const keyFilePath = path.join(episodeDir, keyFileName);

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
        3,
        30000
      );
      if (!resp.ok) {
        throw new Error(`下载 KEY 失败: ${resp.status}`);
      }

      const ab = await resp.arrayBuffer();
      const buf = Buffer.from(ab);
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
            // 下载 key（只在首次见到该 key URL 时）
            await downloadKeyByUrl(keyAbsUrl, keyIndex);
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

    console.log(
      `[DownloadService] M3U8 包含 ${tsUrls.length} 个 TS 片段，将使用并发数: ${this.tsConcurrent}`
    );

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

    const downloadPromises = tsUrls.map((tsUrl, i) =>
      this.tsLimit(async () => {
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
          const segmentSize = await this.downloadFile(tsUrl, segmentFilePath);
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
              `[DownloadService] TS 片段进度: ${completed}/${tsUrls.length} (${(
                (completed / tsUrls.length) *
                100
              ).toFixed(1)}%) - 已跳过: ${skipped}, 速度: ${speed} 片段/秒`
            );
          }
        } catch (error) {
          console.error(
            `[DownloadService] 下载 TS 片段失败 [${i + 1}/${
              tsUrls.length
            }]: ${tsUrl}`,
            error
          );
          // p-limit 会自动处理错误，不会影响其他任务
          // 继续下载其他片段，但需要更新完成计数以保持进度准确
          completed++;
          if (progressCallback) {
            const progress = (completed / tsUrls.length) * 100;
            progressCallback(progress);
          }
        }
      })
    );

    // 等待所有下载完成（无论成功或失败）
    await Promise.allSettled(downloadPromises);

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

    // 更新 M3U8 文件中的路径为相对路径（TS + KEY）
    // 始终保存媒体播放列表的内容（因为实际下载的是媒体播放列表的 TS 片段）
    let updatedM3U8Content = mediaPlaylistContent;

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
          const keyRel = `${episodePrefix}/key_${String(idx).padStart(
            3,
            '0'
          )}.key`;
          return ln.replace(/URI="([^"]+)"/, `URI="${keyRel}"`);
        })
        .join('\n');
    }

    // 更新媒体播放列表中的 TS 路径为相对路径
    updatedM3U8Content = updatedM3U8Content.replace(
      /^[^#\n]+\.ts$/gm,
      (match) => {
        const trimmedMatch = match.trim();
        const segmentIndex = tsUrls.findIndex((url) => {
          const urlPath = new URL(url).pathname;
          return urlPath.endsWith(trimmedMatch) || url.includes(trimmedMatch);
        });
        if (segmentIndex >= 0) {
          return `${episodePrefix}/segment_${segmentIndex
            .toString()
            .padStart(3, '0')}.ts`;
        }
        return match;
      }
    );

    // 保存 M3U8 文件
    fs.writeFileSync(m3u8FilePath, updatedM3U8Content, 'utf-8');

    return { localFilePath: m3u8FilePath, fileSize: totalSize };
  }

  /**
   * 下载直接文件（MP4、MKV 等）
   */
  private async downloadDirectFile(
    url: string,
    localPath: string,
    episodeIndex: number,
    progressCallback?: (progress: number) => void
  ): Promise<{ localFilePath: string; fileSize: number }> {
    console.log(`[DownloadService] 下载直接文件: ${url}`);

    // 获取文件扩展名
    const urlPath = new URL(url).pathname;
    const ext = path.extname(urlPath) || '.mp4';
    const fileName = `episode_${episodeIndex
      .toString()
      .padStart(2, '0')}${ext}`;
    const filePath = path.join(localPath, fileName);

    const fileSize = await this.downloadFile(url, filePath, progressCallback);

    return { localFilePath: filePath, fileSize };
  }

  /**
   * 下载文件（通用方法）
   */
  private async downloadFile(
    url: string,
    filePath: string,
    progressCallback?: (progress: number) => void
  ): Promise<number> {
    // 使用带重试的 fetch（TS 片段下载使用更长的超时时间）
    const response = await fetchWithRetry(url, {}, 3, 60000);
    if (!response.ok) {
      throw new Error(`下载失败: ${response.status}`);
    }

    const contentLength = parseInt(
      response.headers.get('content-length') || '0',
      10
    );

    // 使用流式下载
    const fileStream = fs.createWriteStream(filePath);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error('无法获取响应流');
    }

    let downloaded = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      fileStream.write(Buffer.from(value));
      downloaded += value.length;

      // 更新进度
      if (progressCallback && contentLength > 0) {
        const progress = (downloaded / contentLength) * 100;
        progressCallback(progress);
      }
    }

    fileStream.end();

    return downloaded;
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

  /**
   * 获取所有任务
   */
  public getAllTasks(): DownloadTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 暂停任务（仅保证在“集边界”生效）
   */
  public pauseTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (
      task.status === DownloadStatus.PENDING ||
      task.status === DownloadStatus.DOWNLOADING
    ) {
      task.status = DownloadStatus.PAUSED;
      this.updateTask(task);
      return true;
    }
    return false;
  }

  /**
   * 恢复任务
   */
  public resumeTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status !== DownloadStatus.PAUSED) return false;

    // 如果任务下载线程仍在 activeDownloads 中（暂停等待中），直接切回 downloading 继续
    if (this.activeDownloads.has(taskId)) {
      task.status = DownloadStatus.DOWNLOADING;
      this.updateTask(task);
      return true;
    }

    // 否则重新进入队列
    task.status = DownloadStatus.PENDING;
    this.updateTask(task);
    this.processQueue();
    return true;
  }

  /**
   * 取消任务
   */
  public cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    if (
      task.status === DownloadStatus.PENDING ||
      task.status === DownloadStatus.DOWNLOADING ||
      task.status === DownloadStatus.PAUSED
    ) {
      task.status = DownloadStatus.CANCELLED;
      this.updateTask(task);
      this.activeDownloads.delete(taskId);
      this.processQueue(); // 处理下一个任务
      return true;
    }

    return false;
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
