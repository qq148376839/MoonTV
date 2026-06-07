/* eslint-disable no-console */

import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';

import { getStorageManager } from '@/lib/local-storage';
import { PathUtils } from '@/lib/path-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/local-library/detail?source=...&id=...
 */
export async function GET(request: NextRequest) {
  try {
    const storageManager = getStorageManager();
    if (!storageManager.isEnabled()) {
      return NextResponse.json(
        { error: '本地存储功能未启用' },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const id = searchParams.get('id');
    if (!source || !id) {
      return NextResponse.json(
        { error: '缺少必要参数: source 和 id' },
        { status: 400 }
      );
    }

    const index = storageManager.readIndex();
    const key = `${source}_${id}`;
    const entry = index[key];
    if (!entry) {
      return NextResponse.json({ error: '资源不存在' }, { status: 404 });
    }

    const storagePath = storageManager.getStoragePath();
    const localPath = PathUtils.resolveResourcePath(
      entry.local_path,
      storagePath
    );
    if (!fs.existsSync(localPath)) {
      return NextResponse.json({ error: '资源目录不存在' }, { status: 404 });
    }

    const metadata = storageManager.readMetadata(localPath);
    if (!metadata) {
      return NextResponse.json(
        { error: 'metadata.json 不存在' },
        { status: 404 }
      );
    }

    const episodeStatus = (metadata.episodes || []).map((p, idx) => ({
      episode: idx + 1,
      downloaded: typeof p === 'string' && p.trim().length > 0,
      file_path: p,
    }));

    const downloadedEpisodes = episodeStatus.filter((e) => e.downloaded).length;

    return NextResponse.json(
      {
        source,
        id,
        local_path: entry.local_path,
        metadata,
        stats: {
          downloaded_episodes: downloadedEpisodes,
          total_episodes: metadata.episodes?.length || 0,
        },
        episode_status: episodeStatus,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[Local Library Detail API] 获取详情失败:', error);
    return NextResponse.json(
      { error: '获取本地资源详情失败' },
      { status: 500 }
    );
  }
}
