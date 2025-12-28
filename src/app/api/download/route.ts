/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAvailableApiSites } from '@/lib/config';
import { DownloadStatus, getDownloadService } from '@/lib/download-service';
import { getDetailFromApi } from '@/lib/downstream';
import { SearchResult } from '@/lib/types';

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
    const { source, id, episodes, auto_download, episode_range } = body;

    console.log('[Download API] 请求参数:', {
      source,
      id,
      hasEpisodes: !!episodes,
      auto_download,
      episode_range,
    });

    if (!source || !id) {
      console.log('[Download API] 缺少必要参数');
      return NextResponse.json(
        { error: '缺少必要参数: source 和 id' },
        { status: 400 }
      );
    }

    // 获取资源详情
    const apiSites = await getAvailableApiSites();
    const apiSite = apiSites.find((s) => s.key === source);

    if (!apiSite) {
      return NextResponse.json(
        { error: '未找到对应的源配置' },
        { status: 404 }
      );
    }

    let resource: SearchResult;
    try {
      resource = await getDetailFromApi(apiSite, id);
    } catch (error) {
      console.error('[Download API] 获取资源详情失败:', error);
      return NextResponse.json({ error: '获取资源详情失败' }, { status: 500 });
    }

    // 确定要下载的剧集
    let episodesToDownload: string[] = [];
    if (episodes && Array.isArray(episodes) && episodes.length > 0) {
      // 使用提供的剧集列表
      episodesToDownload = episodes;
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
      console.log(
        `[Download API] episode_range 处理: start=${start}, end=${end}, startIndex=${startIndex}, endIndex=${endIndex}, 总剧集数=${resource.episodes.length}, 将下载=${episodesToDownload.length}集`
      );
    } else if (auto_download) {
      // 自动下载所有剧集
      episodesToDownload = resource.episodes;
    } else {
      // 默认下载第一集
      episodesToDownload = resource.episodes.slice(0, 1);
    }

    if (episodesToDownload.length === 0) {
      return NextResponse.json({ error: '没有可下载的剧集' }, { status: 400 });
    }

    console.log(
      `[Download API] 准备创建下载任务: ${source}_${id}, 剧集数: ${episodesToDownload.length}`
    );

    // 创建下载任务（内部会检查是否有重复任务或已完全下载）
    const task = downloadService.createTask(resource, episodesToDownload);

    // 检查任务状态
    let message = '下载任务已创建';
    let isExistingTask = false;
    let isAlreadyDownloaded = false;

    if (task.status === DownloadStatus.COMPLETED && task.progress === 100) {
      // 资源已完全下载
      isAlreadyDownloaded = true;
      message = '资源已完全下载，无需重复下载';
      console.log(
        `[Download API] ✓ 资源已完全下载: ${source}_${id}, 剧集数: ${episodesToDownload.length}`
      );
    } else if (task.id.startsWith('completed_')) {
      // 这是新创建的已完成任务（资源已下载）
      isAlreadyDownloaded = true;
      message = '资源已完全下载，无需重复下载';
      console.log(
        `[Download API] ✓ 资源已完全下载: ${source}_${id}, 剧集数: ${episodesToDownload.length}`
      );
    } else if (Date.now() - task.createdAt > 1000) {
      // 现有任务
      isExistingTask = true;
      message = '已存在相同下载任务，返回现有任务';
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
      return NextResponse.json(
        {
          tasks: tasks.map((task) => ({
            task_id: task.id,
            source: task.source,
            id: task.resourceId,
            status: task.status,
            progress: task.progress,
            error: task.error,
            created_at: task.createdAt,
            updated_at: task.updatedAt,
          })),
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

    const success = downloadService.cancelTask(taskId);
    if (!success) {
      return NextResponse.json(
        { error: '任务不存在或无法取消' },
        { status: 404 }
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
