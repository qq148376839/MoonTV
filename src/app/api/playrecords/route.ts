/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { PlayRecord } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * 触发自动下载（异步，不阻塞）
 * @param source 资源源标识
 * @param id 资源ID
 * @param currentIndex 当前集数（从1开始，PlayRecord格式）
 * @param totalEpisodes 总集数（用于判断是电影还是连续剧）
 */
async function triggerAutoDownload(
  source: string,
  id: string,
  currentIndex: number,
  totalEpisodes: number
): Promise<void> {
  try {
    console.log(
      `[PlayRecords] 开始触发自动下载: ${source}_${id}, 当前集数: ${currentIndex}, 总集数: ${totalEpisodes}`
    );

    // 获取基础 URL（用于构建下载 API 路径）
    // 服务器内部调用，优先使用容器内部地址
    // NEXT_PUBLIC_BASE_URL 是客户端访问地址，服务器内部应该使用 localhost:3000
    const baseUrl =
      process.env.DOCKER_ENV === 'true'
        ? 'http://localhost:3000' // Docker 环境使用容器内部地址
        : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:51000';

    console.log(`[PlayRecords] 下载 API 基础 URL: ${baseUrl}`, {
      NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
      VERCEL_URL: process.env.VERCEL_URL,
      DOCKER_ENV: process.env.DOCKER_ENV,
    });

    // 判断是电影还是连续剧
    // 电影：total_episodes === 1，只下载当前集
    // 连续剧：total_episodes > 1，下载当前集 + 下2集
    const isMovie = totalEpisodes === 1;

    // PlayRecord.index 是从1开始的，需要转换为0-based（episodes数组索引）
    const episodeIndex = currentIndex - 1;

    let episodeRange: { start: number; end: number };
    if (isMovie) {
      // 电影：只下载当前集
      episodeRange = {
        start: episodeIndex,
        end: episodeIndex,
      };
      console.log(`[PlayRecords] 检测到电影，只下载当前集: ${episodeIndex}`);
    } else {
      // 连续剧：下载当前集 + 下2集
      const downloadNextEpisodes = parseInt(
        process.env.LOCAL_STORAGE_AUTO_DOWNLOAD_NEXT || '2',
        10
      );
      episodeRange = {
        start: episodeIndex,
        end: episodeIndex + downloadNextEpisodes,
      };
      console.log(
        `[PlayRecords] 检测到连续剧，下载范围: ${episodeRange.start} - ${episodeRange.end}`
      );
    }

    const downloadUrl = `${baseUrl}/api/download`;
    const requestBody = {
      source,
      id,
      auto_download: false, // 不自动下载所有，只下载指定范围
      episode_range: episodeRange,
    };

    console.log(`[PlayRecords] 调用下载 API: ${downloadUrl}`, requestBody);

    // 调用下载 API
    const response = await fetch(downloadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    console.log(
      `[PlayRecords] 下载 API 响应状态: ${response.status} ${response.statusText}`
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`下载 API 请求失败: ${response.status} ${errorText}`);
    }

    const result = await response.json();

    // 检查是否已完全下载
    if (result.is_already_downloaded) {
      console.log(
        `[PlayRecords] ⚠️ 资源已完全下载，跳过自动下载: ${source}_${id}`
      );
      return;
    }

    console.log(
      `[PlayRecords] ✓ 自动下载任务已创建: ${result.task_id} (${source}_${id})`,
      result
    );
  } catch (error) {
    // 记录详细错误信息
    console.error(
      `[PlayRecords] ✗ 触发自动下载失败: ${source}_${id}`,
      error instanceof Error
        ? {
            message: error.message,
            stack: error.stack,
          }
        : error
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const records = await db.getAllPlayRecords(authInfo.username);
    return NextResponse.json(records, { status: 200 });
  } catch (err) {
    console.error('获取播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { key, record }: { key: string; record: PlayRecord } = body;

    if (!key || !record) {
      return NextResponse.json(
        { error: 'Missing key or record' },
        { status: 400 }
      );
    }

    // 验证播放记录数据
    if (!record.title || !record.source_name || record.index < 1) {
      return NextResponse.json(
        { error: 'Invalid record data' },
        { status: 400 }
      );
    }

    // 从key中解析source和id
    const [source, id] = key.split('+');
    if (!source || !id) {
      return NextResponse.json(
        { error: 'Invalid key format' },
        { status: 400 }
      );
    }

    const finalRecord = {
      ...record,
      save_time: record.save_time ?? Date.now(),
      // 如果请求中提供了 source 和 id，保存到播放记录中
      source: record.source || source,
      id: record.id || id,
    } as PlayRecord;

    await db.savePlayRecord(authInfo.username, source, id, finalRecord);

    // 异步触发自动下载（不阻塞响应）
    // 如果播放记录中包含 source 和 id，且启用了自动下载功能
    const autoDownloadEnabled = process.env.LOCAL_STORAGE_ENABLED !== 'false';
    const finalSource = finalRecord.source || source;
    const finalId = finalRecord.id || id;
    const shouldAutoDownload = autoDownloadEnabled && finalSource && finalId;

    console.log('[PlayRecords] 检查自动下载触发条件:', {
      autoDownloadEnabled,
      LOCAL_STORAGE_ENABLED: process.env.LOCAL_STORAGE_ENABLED,
      finalSource,
      finalId,
      shouldAutoDownload,
      index: finalRecord.index,
    });

    if (shouldAutoDownload) {
      console.log(
        `[PlayRecords] 触发自动下载: ${finalSource}_${finalId}, 集数: ${finalRecord.index}, 总集数: ${finalRecord.total_episodes}`
      );
      // 异步触发下载，不等待结果
      // 传入 total_episodes 用于判断是电影还是连续剧
      triggerAutoDownload(
        finalSource,
        finalId,
        finalRecord.index,
        finalRecord.total_episodes
      ).catch((error) => {
        console.error('[PlayRecords] 自动下载触发失败:', error);
      });
    } else {
      console.log('[PlayRecords] 跳过自动下载:', {
        reason: !autoDownloadEnabled
          ? '自动下载功能未启用'
          : !finalSource || !finalId
          ? '缺少 source 或 id'
          : '未知原因',
      });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('保存播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const username = authInfo.username;
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      // 如果提供了 key，删除单条播放记录
      const [source, id] = key.split('+');
      if (!source || !id) {
        return NextResponse.json(
          { error: 'Invalid key format' },
          { status: 400 }
        );
      }

      await db.deletePlayRecord(username, source, id);
    } else {
      // 未提供 key，则清空全部播放记录
      // 目前 DbManager 没有对应方法，这里直接遍历删除
      const all = await db.getAllPlayRecords(username);
      await Promise.all(
        Object.keys(all).map(async (k) => {
          const [s, i] = k.split('+');
          if (s && i) await db.deletePlayRecord(username, s, i);
        })
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('删除播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
