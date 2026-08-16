/* eslint-disable no-console */

import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

import { getAvailableApiSites } from '@/lib/config';
import { DownloadStatus, getDownloadService } from '@/lib/download-service';
import { redactDownloadUrl } from '@/lib/download-transaction';
import { getDetailFromApi } from '@/lib/downstream';
import { getStorageManager } from '@/lib/local-storage';
import { PathUtils } from '@/lib/path-utils';
import { SearchResult } from '@/lib/types';

import { summarizeDownloadTask } from './public-view';

export const runtime = 'nodejs'; // 需要文件系统访问，使用 Node.js runtime

/**
 * POST /api/download - 创建下载任务
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[Download API] 收到下载请求');
    const downloadService = getDownloadService();

    // 检查是否启用
    if (!downloadService.isEnabled()) {
      console.log('[Download API] 本地存储功能未启用');
      return NextResponse.json(
        { error: '本地存储功能未启用' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const {
      source,
      id,
      episodes,
      auto_download,
      episode_range,
      episode_numbers,
      auto_download_next,
      current_episode,
      force_redownload,
      // 可选：由前端直接传入完整详情（用于不依赖 config.json / 非标准源导致的详情拉取失败）
      resource: resourceFromClient,
    } = body;

    console.log('[Download API] 请求参数:', {
      source,
      id,
      hasEpisodes: !!episodes,
      auto_download,
      episode_range,
      hasEpisodeNumbers:
        Array.isArray(episode_numbers) && episode_numbers.length > 0,
      auto_download_next,
      current_episode,
      force_redownload: force_redownload === true,
    });

    if (!source || !id) {
      console.log('[Download API] 缺少必要参数');
      return NextResponse.json(
        { error: '缺少必要参数: source 和 id' },
        { status: 400 }
      );
    }

    let resource: SearchResult;
    let addressMethod:
      | 'direct'
      | 'refreshed'
      | 'client_fallback'
      | 'historical_fallback' = 'direct';
    const clientResourceIsValid =
      resourceFromClient &&
      typeof resourceFromClient === 'object' &&
      (resourceFromClient as SearchResult).source === source &&
      (resourceFromClient as SearchResult).id === id &&
      Array.isArray((resourceFromClient as SearchResult).episodes) &&
      (resourceFromClient as SearchResult).episodes.length > 0;
    const normalizeClientResource = (): SearchResult => {
      const raw = resourceFromClient as SearchResult;
      return {
        ...raw,
        episodes: raw.episodes.filter(
          (url) =>
            typeof url === 'string' &&
            (url.startsWith('http://') || url.startsWith('https://'))
        ),
      };
    };
    const loadHistoricalResource = (): SearchResult | null => {
      try {
        const storage = getStorageManager();
        const entry = storage.readIndex()[`${source}_${id}`];
        if (!entry) return null;
        const localPath = PathUtils.resolveResourcePath(
          entry.local_path,
          storage.getStoragePath()
        );
        const metadata = storage.readMetadata(localPath);
        if (!metadata?.episode_audits) return null;
        const historicalEpisodes = Array(metadata.episode_count).fill('');
        for (const [episode, audit] of Object.entries(
          metadata.episode_audits
        )) {
          const reportPath = path.join(
            localPath,
            `episode_${String(Number(episode)).padStart(2, '0')}_generations`,
            audit.generation_id,
            'report.json'
          );
          if (!fs.existsSync(reportPath)) continue;
          const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as {
            source_url?: unknown;
          };
          if (typeof report.source_url === 'string') {
            historicalEpisodes[Number(episode) - 1] = report.source_url;
          }
        }
        if (!historicalEpisodes.some(Boolean)) return null;
        return {
          id,
          source,
          title: metadata.title,
          poster: metadata.poster,
          episodes: historicalEpisodes,
          source_name: metadata.source_name,
          year: metadata.year,
          desc: metadata.desc,
          type_name: metadata.type_name,
        };
      } catch (error) {
        console.warn('[Download API] 读取历史下载地址失败:', error);
        return null;
      }
    };
    // 1) 优先使用前端传入的详情（避免依赖 config.json）
    if (clientResourceIsValid && force_redownload !== true) {
      resource = normalizeClientResource();
    } else {
      // 强制重下优先重新查询源详情；查询失败才回退本次客户端详情。
      const apiSites = await getAvailableApiSites();
      const apiSite = apiSites.find((s) => s.key === source);

      if (!apiSite) {
        if (clientResourceIsValid) {
          resource = normalizeClientResource();
          addressMethod = 'client_fallback';
        } else {
          const historicalResource = loadHistoricalResource();
          if (historicalResource) {
            resource = historicalResource;
            addressMethod = 'historical_fallback';
          } else {
            return NextResponse.json(
              {
                error: '未找到对应的源配置，且没有可用的客户端或历史下载地址',
              },
              { status: 400 }
            );
          }
        }
      } else {
        try {
          resource = await getDetailFromApi(apiSite, id, request.url);
          addressMethod = 'refreshed';
        } catch (error) {
          console.error('[Download API] 获取最新地址失败:', error);
          if (clientResourceIsValid) {
            resource = normalizeClientResource();
            addressMethod = 'client_fallback';
          } else {
            const historicalResource = loadHistoricalResource();
            if (historicalResource) {
              resource = historicalResource;
              addressMethod = 'historical_fallback';
            } else {
              return NextResponse.json(
                {
                  error: '获取资源详情失败，且没有可用的历史下载地址',
                  details:
                    error instanceof Error ? error.message : String(error),
                },
                { status: 500 }
              );
            }
          }
        }
      }
    }

    // 确定要下载的剧集 + 对应“真实集号”（1-based）
    let episodesToDownload: string[] = [];
    let episodeNumbers: number[] = [];
    if (Array.isArray(episode_numbers) && episode_numbers.length > 0) {
      // 使用原始集号（1-based）
      const nums = episode_numbers
        .map((n: unknown) => Number(n))
        .filter((n) => Number.isFinite(n) && n >= 1)
        .map((n) => Math.floor(n))
        .filter((n) => n <= resource.episodes.length);

      const uniqueSorted = Array.from(new Set(nums)).sort((a, b) => a - b);
      episodesToDownload = uniqueSorted
        .map((n) => resource.episodes[n - 1])
        .filter(Boolean);
      episodeNumbers = uniqueSorted;
    } else if (episodes && Array.isArray(episodes) && episodes.length > 0) {
      // 使用提供的剧集列表
      episodesToDownload = episodes;
      // 尝试映射到 resource.episodes 中的真实集号
      const urlToNo = new Map<string, number>();
      resource.episodes.forEach((u, idx) => {
        if (!urlToNo.has(u)) urlToNo.set(u, idx + 1);
      });
      episodeNumbers = episodesToDownload.map(
        (u, i) => urlToNo.get(u) ?? i + 1
      );
    } else if (episode_range && typeof episode_range === 'object') {
      // 使用剧集范围（用于自动下载）
      const { start, end } = episode_range;
      const startIndex = Math.max(0, (start || 1) - 1); // 转换为0-based索引
      // end 是包含的，所以需要 +1（因为 slice 的 endIndex 是不包含的）
      const endIndex = Math.min(
        resource.episodes.length,
        end || resource.episodes.length
      );
      episodesToDownload = resource.episodes.slice(startIndex, endIndex);
      episodeNumbers = episodesToDownload.map((_, i) => startIndex + i + 1);
      console.log(
        `[Download API] episode_range 处理: start=${start}, end=${end}, startIndex=${startIndex}, endIndex=${endIndex}, 总剧集数=${resource.episodes.length}, 将下载=${episodesToDownload.length}集`
      );
    } else if (auto_download_next) {
      const n = Math.max(
        0,
        Math.min(
          50,
          Number(process.env.LOCAL_STORAGE_AUTO_DOWNLOAD_NEXT || '2') || 2
        )
      );
      const cur = Math.max(1, Number(current_episode || 1));
      const startNo = cur + 1;
      const endNo = Math.min(resource.episodes.length, cur + n);

      if (n <= 0) {
        return NextResponse.json(
          {
            error:
              '自动下载后续集数配置无效（LOCAL_STORAGE_AUTO_DOWNLOAD_NEXT）',
          },
          { status: 400 }
        );
      }
      if (startNo > resource.episodes.length) {
        return NextResponse.json(
          { error: '当前已是最后一集，没有可下载的后续剧集' },
          { status: 400 }
        );
      }

      episodesToDownload = resource.episodes.slice(startNo - 1, endNo);
      episodeNumbers = episodesToDownload.map((_, i) => startNo + i);
    } else if (auto_download) {
      // 自动下载所有剧集
      episodesToDownload = resource.episodes;
      episodeNumbers = episodesToDownload.map((_, i) => i + 1);
    } else {
      // 默认下载第一集
      episodesToDownload = resource.episodes.slice(0, 1);
      episodeNumbers = [1];
    }

    if (
      episodesToDownload.length !== episodeNumbers.length ||
      episodesToDownload.some(
        (url) =>
          typeof url !== 'string' ||
          (!url.startsWith('http://') && !url.startsWith('https://'))
      )
    ) {
      return NextResponse.json(
        { error: '所选剧集缺少可用的历史下载地址，无法安全重下' },
        { status: 409 }
      );
    }

    if (episodesToDownload.length === 0) {
      return NextResponse.json({ error: '没有可下载的剧集' }, { status: 400 });
    }

    console.log(
      `[Download API] 准备创建下载任务: ${source}_${id}, 剧集数: ${episodesToDownload.length}`
    );

    // 创建下载任务（内部会检查是否有重复任务或已完全下载）
    const task = downloadService.createTask(
      resource,
      episodesToDownload,
      episodeNumbers,
      {
        forceRedownload: force_redownload === true,
        addressMethod,
      }
    );

    // 检查任务状态
    let message = '下载任务已创建';
    let isExistingTask = false;
    let isAlreadyDownloaded = false;

    if (
      !force_redownload &&
      task.status === DownloadStatus.COMPLETED &&
      task.progress === 100
    ) {
      // 资源已完全下载
      isAlreadyDownloaded = true;
      message = '资源已完全下载，无需重复下载';
      console.log(
        `[Download API] ✓ 资源已完全下载: ${source}_${id}, 剧集数: ${episodesToDownload.length}`
      );
    } else if (!force_redownload && task.id.startsWith('completed_')) {
      // 这是新创建的已完成任务（资源已下载）
      isAlreadyDownloaded = true;
      message = '资源已完全下载，无需重复下载';
      console.log(
        `[Download API] ✓ 资源已完全下载: ${source}_${id}, 剧集数: ${episodesToDownload.length}`
      );
    } else if (Date.now() - task.createdAt > 1000) {
      // 现有任务
      isExistingTask = true;
      message = '下载任务进行中，可在「离线」查看进度';
      console.log(
        `[Download API] ⚠️ 返回现有下载任务: ${task.id}, 状态: ${task.status}`
      );
    } else {
      // 新创建的任务
      console.log(
        `[Download API] ✓ 下载任务已创建: ${task.id}, 状态: ${task.status}`
      );
    }

    return NextResponse.json(
      {
        success: true,
        task_id: task.id,
        status: task.status,
        progress: task.progress,
        episode_numbers: episodeNumbers,
        message,
        is_existing: isExistingTask,
        is_already_downloaded: isAlreadyDownloaded,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[Download API] 创建下载任务失败:', error);
    return NextResponse.json(
      {
        error: '创建下载任务失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/download - 获取下载任务状态
 */
export async function GET(request: NextRequest) {
  try {
    const downloadService = getDownloadService();

    if (!downloadService.isEnabled()) {
      return NextResponse.json(
        { error: '本地存储功能未启用' },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('task_id');

    if (taskId) {
      // 获取单个任务状态
      const task = downloadService.getTask(taskId);
      const snapshot = downloadService.getSnapshot(taskId);
      if (!task && !snapshot) {
        return NextResponse.json({ error: '任务不存在' }, { status: 404 });
      }

      if (snapshot) return NextResponse.json(summarizeDownloadTask(snapshot));
      if (!task) {
        return NextResponse.json({ error: '任务不存在' }, { status: 404 });
      }

      return NextResponse.json(
        {
          task_id: task.id,
          status: task.status,
          progress: task.progress,
          error: task.error,
          created_at: task.createdAt,
          updated_at: task.updatedAt,
        },
        { status: 200 }
      );
    } else {
      // 获取所有任务
      const tasks = downloadService.getAllTasks();
      const taskIds = new Set(tasks.map((task) => task.id));
      const summaries = tasks.map((task) => {
        const snapshot = downloadService.getSnapshot(task.id);
        if (snapshot) return summarizeDownloadTask(snapshot);
        return {
          task_id: task.id,
          source: task.source,
          id: task.resourceId,
          title: task.resource?.title,
          year: task.resource?.year,
          poster: task.resource?.poster
            ? redactDownloadUrl(task.resource.poster)
            : undefined,
          episode_numbers: Array.isArray(task.episodeNumbers)
            ? task.episodeNumbers
            : undefined,
          status: task.status,
          progress: task.progress,
          error: task.error,
          created_at: task.createdAt,
          updated_at: task.updatedAt,
        };
      });
      // Recovered snapshots are intentionally not inserted into the legacy
      // in-memory task queue until the user resumes them.
      for (const candidateId of downloadService.getRecoverableTaskIds()) {
        if (taskIds.has(candidateId)) continue;
        const snapshot = downloadService.getSnapshot(candidateId);
        if (snapshot) summaries.push(summarizeDownloadTask(snapshot));
      }
      return NextResponse.json(
        {
          tasks: summaries,
        },
        { status: 200 }
      );
    }
  } catch (error) {
    console.error('[Download API] 获取任务状态失败:', error);
    return NextResponse.json({ error: '获取任务状态失败' }, { status: 500 });
  }
}

/**
 * DELETE /api/download - 取消下载任务
 */
export async function DELETE(request: NextRequest) {
  try {
    const downloadService = getDownloadService();

    if (!downloadService.isEnabled()) {
      return NextResponse.json(
        { error: '本地存储功能未启用' },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('task_id');

    if (!taskId) {
      return NextResponse.json(
        { error: '缺少必要参数: task_id' },
        { status: 400 }
      );
    }

    const result = await downloadService.cancelTask(taskId);
    if (!result.ok) {
      return NextResponse.json(
        { error: '任务不存在或无法取消' },
        { status: result.status === 'not_found' ? 404 : 409 }
      );
    }

    return NextResponse.json(
      { success: true, message: '任务已取消' },
      { status: 200 }
    );
  } catch (error) {
    console.error('[Download API] 取消任务失败:', error);
    return NextResponse.json({ error: '取消任务失败' }, { status: 500 });
  }
}

/**
 * PATCH /api/download - 任务暂停/恢复
 * body: { task_id: string, action: "pause" | "resume" }
 */
export async function PATCH(request: NextRequest) {
  try {
    const downloadService = getDownloadService();

    if (!downloadService.isEnabled()) {
      return NextResponse.json(
        { error: '本地存储功能未启用' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const taskId = body?.task_id;
    const action = body?.action;

    if (!taskId || (action !== 'pause' && action !== 'resume')) {
      return NextResponse.json(
        { error: '缺少必要参数: task_id / action(pause|resume)' },
        { status: 400 }
      );
    }

    const result =
      action === 'pause'
        ? downloadService.pauseTask(taskId)
        : await downloadService.resumeTask(taskId);

    if (!result.ok) {
      return NextResponse.json(
        { error: '任务不存在或当前状态不允许该操作' },
        { status: result.status === 'not_found' ? 404 : 409 }
      );
    }

    const task = downloadService.getTask(taskId);
    return NextResponse.json(
      {
        success: true,
        task_id: taskId,
        status: task?.status,
        progress: task?.progress,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[Download API] PATCH 任务操作失败:', error);
    return NextResponse.json(
      {
        error: '任务操作失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
