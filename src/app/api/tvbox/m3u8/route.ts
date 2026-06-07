import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

import { filterM3U8Ads } from '@/lib/ad-filter';
import { getStorageManager } from '@/lib/local-storage';
import { PathUtils } from '@/lib/path-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function rewriteKeyOrMapLine(
  line: string,
  resourceDir: string,
  baseUrl: string
): string {
  return line.replace(/URI="([^"]+)"/, (_match, uri: string) => {
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      return `URI="${uri}"`;
    }
    const absPath = path.resolve(resourceDir, uri);
    return `URI="${baseUrl}/api/local-video?path=${encodeURIComponent(absPath)}"`;
  });
}

function rewriteM3U8(
  content: string,
  resourceDir: string,
  baseUrl: string
): string {
  const lines = content.split('\n');
  const rewritten: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('#EXT-X-KEY:')) {
      rewritten.push(rewriteKeyOrMapLine(trimmed, resourceDir, baseUrl));
    } else if (trimmed.startsWith('#EXT-X-MAP:')) {
      rewritten.push(rewriteKeyOrMapLine(trimmed, resourceDir, baseUrl));
    } else if (trimmed && !trimmed.startsWith('#')) {
      // segment 行：相对路径转绝对 URL
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        rewritten.push(trimmed);
      } else {
        const absPath = path.resolve(resourceDir, trimmed);
        rewritten.push(
          `${baseUrl}/api/local-video?path=${encodeURIComponent(absPath)}`
        );
      }
    } else {
      rewritten.push(line);
    }
  }

  return rewritten.join('\n');
}

export async function GET(request: NextRequest) {
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
  const episode = parseInt(searchParams.get('episode') || '0', 10);

  if (!source || !id || !episode) {
    return NextResponse.json({ error: '缺少参数: source, id, episode' }, { status: 400 });
  }

  const index = storageManager.readIndex();
  const key = `${source}_${id}`;
  const entry = index[key];
  if (!entry) {
    return NextResponse.json({ error: '资源不存在' }, { status: 404 });
  }

  const storagePath = storageManager.getStoragePath();
  const resourceDir = PathUtils.resolveResourcePath(
    entry.local_path,
    storagePath
  );

  const epStr = episode.toString().padStart(2, '0');
  const m3u8Path = path.join(resourceDir, `episode_${epStr}.m3u8`);

  if (!fs.existsSync(m3u8Path)) {
    return NextResponse.json(
      { error: `M3U8 不存在: episode_${epStr}.m3u8` },
      { status: 404 }
    );
  }

  const m3u8Content = fs.readFileSync(m3u8Path, 'utf-8');

  // 动态获取 base URL
  const host = request.headers.get('host') || 'localhost:1234';
  const protocol = request.headers.get('x-forwarded-proto') || 'http';
  const baseUrl = `${protocol}://${host}`;

  // serve 层兜底去广告：本地 m3u8 为相对路径，仅 DISCONTINUITY 策略生效
  const adResult = filterM3U8Ads(m3u8Content, { enableDiscontinuity: true });
  const cleanContent = adResult.applied ? adResult.content : m3u8Content;
  const rewritten = rewriteM3U8(cleanContent, resourceDir, baseUrl);

  return new NextResponse(rewritten, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}
