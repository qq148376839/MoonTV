/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-require-imports */

import fs from 'fs';
// @ts-expect-error - p-limit is ESM but works in Next.js Node.js runtime
import pLimit from 'p-limit';
import path from 'path';

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

// 下载任务状态
export enum DownloadStatus {
  PENDING = 'pending',
  DOWNLOADING = 'downloading',
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
    episodes: string[]
  ): DownloadTask | null {
    // 将剧集数组转换为字符串用于比较
    const episodesKey = [...episodes].sort().join(',');

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
      const taskEpisodesKey = [...task.episodes].sort().join(',');
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
    episodes: string[]
  ): boolean {
    console.log(
      `[DownloadService] 检查所有剧集是否已下载: ${source}_${resourceId}, 剧集数: ${episodes.length}`
    );

    for (let i = 0; i < episodes.length; i++) {
      const episodeIndex = i + 1;
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
    episodeIndex?: number
  ): DownloadTask {
    const episodesToDownload = episodeIndex
      ? [episodes[episodeIndex - 1]].filter(Boolean)
      : episodes;

    // 检查是否所有剧集都已完全下载
    const allDownloaded = this.areAllEpisodesDownloaded(
      resource.source,
      resource.id,
      episodesToDownload
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
      episodesToDownload
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

      for (let i = 0; i < task.episodes.length; i++) {
        const episodeUrl = task.episodes[i];
        const episodeIndex = i + 1;

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
          console.log(`[DownloadService] ✓ 剧集 ${episodeIndex} 下载完成`);
        } catch (error) {
          console.error(
            `[DownloadService] ✗ 下载剧集 ${episodeIndex} 失败: ${episodeUrl}`,
            error
          );
          // 继续下载其他剧集
        }
      }

      if (skippedCount === task.episodes.length) {
        console.log(
          `[DownloadService] 所有剧集已存在，跳过下载: ${task.source}_${task.resourceId}`
        );
        task.status = DownloadStatus.COMPLETED;
        task.progress = 100;
        this.updateTask(task);
        return;
      }

      // 生成元数据
      await this.storageManager.generateMetadata(
        task.resource,
        localPath,
        downloadedEpisodes,
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
    progressCallback?: (progress: number) => void
  ): Promise<{ localFilePath: string; fileSize: number }> {
    // 检测文件格式
    const isM3U8 = url.includes('.m3u8') || url.endsWith('.m3u8');

    if (isM3U8) {
      return this.downloadM3U8(url, localPath, episodeIndex, progressCallback);
    } else {
      return this.downloadDirectFile(
        url,
        localPath,
        episodeIndex,
        progressCallback
      );
    }
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

    // 解析媒体播放列表内容，提取 TS 片段 URL
    const tsUrls: string[] = [];
    const lines = mediaPlaylistContent.split('\n');
    const mediaBaseUrl = new URL(mediaPlaylistUrl);

    for (const line of lines) {
      const trimmedLine = line.trim();
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

    // 更新 M3U8 文件中的路径为相对路径
    // 始终保存媒体播放列表的内容（因为实际下载的是媒体播放列表的 TS 片段）
    let updatedM3U8Content = mediaPlaylistContent;

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
          return `episode_${episodeIndex
            .toString()
            .padStart(2, '0')}/segment_${segmentIndex
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
   * 取消任务
   */
  public cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    if (
      task.status === DownloadStatus.PENDING ||
      task.status === DownloadStatus.DOWNLOADING
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
