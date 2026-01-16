/* eslint-disable no-console */

import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

import { getStorageManager } from '@/lib/local-storage';
import { PathUtils } from '@/lib/path-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/local-library - 本地资源列表
 */
export async function GET() {
  try {
    const storageManager = getStorageManager();
    if (!storageManager.isEnabled()) {
      return NextResponse.json(
        { error: '本地存储功能未启用' },
        { status: 503 }
      );
    }

    const index = storageManager.readIndex();
    const storagePath = storageManager.getStoragePath();

    const items = Object.entries(index)
      .map(([key, entry]) => {
        const splitAt = key.indexOf('_');
        const source = splitAt >= 0 ? key.slice(0, splitAt) : key;
        const id = splitAt >= 0 ? key.slice(splitAt + 1) : '';
        const localPath = PathUtils.resolveResourcePath(entry.local_path, storagePath);
        const metadata = fs.existsSync(localPath)
          ? storageManager.readMetadata(localPath)
          : null;

        const downloadedEpisodes = metadata?.episodes
          ? metadata.episodes.filter((p) => typeof p === 'string' && p.trim().length > 0).length
          : undefined;

        return {
          source,
          id,
          title: metadata?.title ?? entry.title,
          year: metadata?.year ?? entry.year,
          poster: metadata?.poster,
          local_path: entry.local_path,
          downloaded_episodes: downloadedEpisodes,
          updated_at: entry.updated_at,
        };
      })
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));

    return NextResponse.json({ items }, { status: 200 });
  } catch (error) {
    console.error('[Local Library API] 获取列表失败:', error);
    return NextResponse.json({ error: '获取本地资源列表失败' }, { status: 500 });
  }
}

/**
 * DELETE /api/local-library?source=...&id=... - 删除整部资源
 */
export async function DELETE(request: NextRequest) {
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
    const localPath = PathUtils.resolveResourcePath(entry.local_path, storagePath);

    // 删除目录
    if (fs.existsSync(localPath)) {
      fs.rmSync(localPath, { recursive: true, force: true });
      // 尝试清理父目录（title_year）如果为空
      const parentDir = path.dirname(localPath);
      try {
        if (
          fs.existsSync(parentDir) &&
          fs.readdirSync(parentDir, { withFileTypes: true }).filter((d) => d.name !== 'index.json')
            .length === 0
        ) {
          fs.rmSync(parentDir, { recursive: true, force: true });
        }
      } catch {
        // ignore
      }
    }

    delete index[key];
    storageManager.writeIndex(index);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('[Local Library API] 删除资源失败:', error);
    return NextResponse.json({ error: '删除资源失败' }, { status: 500 });
  }
}

