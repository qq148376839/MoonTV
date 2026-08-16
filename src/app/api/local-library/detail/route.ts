/* eslint-disable no-console */

import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

import {
  redactDownloadUrl,
  redactUrlsInText,
} from '@/lib/download-transaction';
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

    const episodeStatus = (metadata.episodes || []).map((p, idx) => {
      const audit = metadata.episode_audits?.[String(idx + 1)];
      const epNo = String(idx + 1).padStart(2, '0');
      const failuresDir = path.join(
        localPath,
        `episode_${epNo}_generations`,
        'failures'
      );
      let latestFailure: Record<string, unknown> | null = null;
      if (fs.existsSync(failuresDir)) {
        const failureFiles = fs
          .readdirSync(failuresDir)
          .filter((name) => name.endsWith('.json'))
          .sort()
          .reverse();
        if (failureFiles[0]) {
          try {
            latestFailure = JSON.parse(
              fs.readFileSync(path.join(failuresDir, failureFiles[0]), 'utf-8')
            ) as Record<string, unknown>;
            for (const key of ['source_url', 'media_playlist_url']) {
              if (typeof latestFailure[key] === 'string') {
                latestFailure[key] = redactDownloadUrl(
                  latestFailure[key] as string
                );
              }
            }
            if (typeof latestFailure.error === 'string') {
              latestFailure.error = redactUrlsInText(latestFailure.error);
            }
          } catch {
            latestFailure = null;
          }
        }
      }
      return {
        episode: idx + 1,
        downloaded: typeof p === 'string' && p.trim().length > 0,
        file_path: p,
        audit: audit
          ? {
              ...audit,
              source_url: redactDownloadUrl(audit.source_url),
              media_playlist_url: redactDownloadUrl(audit.media_playlist_url),
            }
          : null,
        latest_failure: latestFailure,
      };
    });

    const downloadedEpisodes = episodeStatus.filter((e) => e.downloaded).length;
    const safeMetadata = {
      ...metadata,
      episode_audits: metadata.episode_audits
        ? Object.fromEntries(
            Object.entries(metadata.episode_audits).map(([episode, audit]) => [
              episode,
              {
                ...audit,
                source_url: redactDownloadUrl(audit.source_url),
                media_playlist_url: redactDownloadUrl(audit.media_playlist_url),
              },
            ])
          )
        : undefined,
    };

    return NextResponse.json(
      {
        source,
        id,
        local_path: entry.local_path,
        metadata: safeMetadata,
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
