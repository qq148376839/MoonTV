import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

import { getStorageManager } from '@/lib/local-storage';
import { PathUtils } from '@/lib/path-utils';

/* eslint-disable no-console */
// 需要文件系统访问，使用 Node.js runtime
export const dynamic = 'force-dynamic';

/**
 * GET /api/local-segment - 检查本地 TS 片段是否存在
 *
 * 参数：
 * - source: 资源源标识
 * - id: 资源ID
 * - episode: 剧集索引（从0开始或从1开始，需要处理）
 * - segmentUrl: 在线 TS 片段的 URL（用于提取片段文件名）
 *
 * 返回：
 * - exists: boolean - 本地片段是否存在
 * - localUrl?: string - 本地片段的访问 URL（如果存在）
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const id = searchParams.get('id');
    const episode = searchParams.get('episode');
    const segmentUrl = searchParams.get('segmentUrl');

    if (!source || !id || !episode || !segmentUrl) {
      return NextResponse.json(
        { error: '缺少必要参数: source, id, episode, segmentUrl' },
        { status: 400 }
      );
    }

    const storageManager = getStorageManager();
    if (!storageManager.isEnabled()) {
      return NextResponse.json({ exists: false }, { status: 200 });
    }

    // 从 segmentUrl 中提取片段文件名
    // 例如：https://example.com/segment_000.ts -> segment_000.ts
    const segmentFileName = segmentUrl.split('/').pop() || '';

    // 验证片段文件名格式
    const segmentPattern = /^segment_\d+\.ts$/;
    if (!segmentPattern.test(segmentFileName)) {
      console.warn(
        `[Local Segment API] 无效的片段文件名格式: ${segmentFileName}`
      );
      return NextResponse.json({ exists: false }, { status: 200 });
    }

    // 获取资源路径
    const index = storageManager.readIndex();
    const key = `${source}_${id}`;

    if (!(key in index)) {
      return NextResponse.json({ exists: false }, { status: 200 });
    }

    const indexEntry = index[key];
    const storagePath = storageManager.getStoragePath();
    const resourcePath = PathUtils.resolveResourcePath(
      indexEntry.local_path,
      storagePath
    );

    // 解析剧集索引（可能是字符串 "0" 或 "1"）
    // 假设 episode 参数是从 0 开始的索引
    const episodeIndex = parseInt(episode, 10);
    if (isNaN(episodeIndex) || episodeIndex < 0) {
      console.warn(
        `[Local Segment API] 无效的剧集索引: ${episode}, source: ${source}, id: ${id}`
      );
      return NextResponse.json({ exists: false }, { status: 200 });
    }

    // 构建 TS 片段路径
    // 剧集目录格式：episode_01, episode_02, ...
    const episodeDir = path.join(
      resourcePath,
      `episode_${(episodeIndex + 1).toString().padStart(2, '0')}`
    );
    const segmentPath = path.join(episodeDir, segmentFileName);

    // 检查文件是否存在
    if (fs.existsSync(segmentPath)) {
      const stats = fs.statSync(segmentPath);
      if (stats.size > 0) {
        // 返回本地 TS 片段的访问 URL
        const localUrl = `/api/local-video?path=${encodeURIComponent(
          segmentPath
        )}`;
        console.log(
          `[Local Segment API] ✓ 找到本地 TS 片段: ${segmentFileName}, 路径: ${segmentPath}`
        );
        return NextResponse.json({ exists: true, localUrl }, { status: 200 });
      }
    }

    return NextResponse.json({ exists: false }, { status: 200 });
  } catch (error) {
    console.error('[Local Segment API] 检查失败:', error);
    return NextResponse.json({ exists: false }, { status: 200 });
  }
}
