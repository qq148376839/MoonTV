import { NextRequest, NextResponse } from 'next/server';

import { getDownloadService } from '@/lib/download-service';
import { getStorageManager } from '@/lib/local-storage';
import { SearchResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

/**
 * POST /api/tvbox/download — TVBox 触发下载
 *
 * Request body:
 * {
 *   title: string,
 *   year?: string,
 *   poster?: string,
 *   type_name?: string,
 *   desc?: string,
 *   episodes: [{ name: string, url: string, headers?: Record<string, string> }]
 * }
 */
export async function POST(request: NextRequest) {
  const storageManager = getStorageManager();
  if (!storageManager.isEnabled()) {
    return NextResponse.json(
      { error: '本地存储功能未启用' },
      { status: 503, headers: CORS_HEADERS }
    );
  }

  let body: {
    title: string;
    year?: string;
    poster?: string;
    type_name?: string;
    desc?: string;
    episodes: {
      name: string;
      url: string;
      headers?: Record<string, string>;
    }[];
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: '无效的 JSON' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const { title, year, poster, type_name, desc, episodes } = body;

  if (!title || !Array.isArray(episodes) || episodes.length === 0) {
    return NextResponse.json(
      { error: '缺少参数: title, episodes' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // 用 title + year 生成稳定 ID
  const safeTitle = title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
  const resourceId = `${safeTitle}_${year || 'unknown'}`;

  const resource: SearchResult = {
    id: resourceId,
    title,
    poster: poster || '',
    episodes: episodes.map((ep) => ep.url),
    source: 'tvbox',
    source_name: 'TVBox',
    year: year || '',
    desc: desc || '',
    type_name: type_name || '',
  };

  const episodeUrls = episodes.map((ep) => ep.url);
  const episodeNumbers = episodes.map((_, i) => i + 1);

  const downloadService = getDownloadService();
  const task = downloadService.createTask(
    resource,
    episodeUrls,
    episodeNumbers,
    {
      episodeHeaders: episodes.map((episode) => episode.headers ?? {}),
    }
  );

  return NextResponse.json(
    {
      success: true,
      task_id: task.id,
      status: task.status,
      progress: task.progress,
      message: `已加入下载队列：${title} (${episodes.length} 集)`,
    },
    { headers: CORS_HEADERS }
  );
}

/**
 * GET /api/tvbox/download?task_id=X — 查询下载状态
 * GET /api/tvbox/download — 查询所有任务
 */
export async function GET(request: NextRequest) {
  const downloadService = getDownloadService();
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('task_id');

  if (taskId) {
    const task = downloadService.getTask(taskId);
    if (!task) {
      return NextResponse.json(
        { error: '任务不存在' },
        { status: 404, headers: CORS_HEADERS }
      );
    }
    return NextResponse.json(
      {
        task_id: task.id,
        status: task.status,
        progress: task.progress,
        title: task.resource?.title || '',
        episode_numbers: task.episodeNumbers || [],
      },
      { headers: CORS_HEADERS }
    );
  }

  // 返回所有任务
  const tasks = downloadService.getAllTasks();
  return NextResponse.json(
    {
      tasks: tasks.map((t) => ({
        task_id: t.id,
        source: t.source,
        title: t.resource?.title || '',
        status: t.status,
        progress: t.progress,
        episode_numbers: t.episodeNumbers || [],
      })),
    },
    { headers: CORS_HEADERS }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
