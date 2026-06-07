import { NextRequest, NextResponse } from 'next/server';

import { getStorageManager } from '@/lib/local-storage';
import { PathUtils } from '@/lib/path-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ResourceItem {
  source: string;
  id: string;
  title: string;
  year: string;
  poster: string;
  type_name: string;
  desc: string;
  downloaded_episodes: number;
  total_episodes: number;
  updated_at: number;
  local_path: string;
}

function getResourceItems(): ResourceItem[] {
  const storageManager = getStorageManager();
  const index = storageManager.readIndex();
  const storagePath = storageManager.getStoragePath();
  const items: ResourceItem[] = [];

  for (const [key, entry] of Object.entries(index)) {
    const underscoreIdx = key.indexOf('_');
    if (underscoreIdx === -1) continue;

    const source = key.substring(0, underscoreIdx);
    const id = key.substring(underscoreIdx + 1);
    const resourcePath = PathUtils.resolveResourcePath(
      entry.local_path,
      storagePath
    );
    const metadata = storageManager.readMetadata(resourcePath);

    items.push({
      source,
      id,
      title: metadata?.title || entry.title || '未知',
      year: metadata?.year || entry.year || '',
      poster: metadata?.poster || '',
      type_name: metadata?.type_name || '',
      desc: metadata?.desc || '',
      downloaded_episodes:
        metadata?.episodes?.filter(
          (p: string) => typeof p === 'string' && p.trim().length > 0
        ).length || 0,
      total_episodes: metadata?.episodes?.length || 0,
      updated_at: entry.updated_at,
      local_path: entry.local_path,
    });
  }

  items.sort((a, b) => b.updated_at - a.updated_at);
  return items;
}

function handleClass(): NextResponse {
  const items = getResourceItems();
  const typeSet = new Set<string>();

  for (const item of items) {
    typeSet.add(item.type_name || '其他');
  }

  const classes = Array.from(typeSet).map((name) => ({
    type_id: name || '其他',
    type_name: name || '其他',
  }));

  return NextResponse.json({ class: classes });
}

function handleList(t: string, pg: number): NextResponse {
  const items = getResourceItems();
  const PAGE_SIZE = 20;

  const filtered = t
    ? items.filter((item) => (item.type_name || '其他') === t)
    : items;
  const total = filtered.length;
  const pagecount = Math.ceil(total / PAGE_SIZE) || 1;
  const start = (pg - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  const list = pageItems.map((item) => ({
    vod_id: `${item.source}_${item.id}`,
    vod_name: item.title,
    vod_pic: item.poster,
    vod_remarks: `已下载 ${item.downloaded_episodes} 集`,
    type_name: item.type_name || '其他',
  }));

  return NextResponse.json({ page: pg, pagecount, limit: PAGE_SIZE, total, list });
}

function handleDetail(request: NextRequest, ids: string): NextResponse {
  const underscoreIdx = ids.indexOf('_');
  if (underscoreIdx === -1) {
    return NextResponse.json({ list: [] });
  }

  const source = ids.substring(0, underscoreIdx);
  const id = ids.substring(underscoreIdx + 1);

  const storageManager = getStorageManager();
  const index = storageManager.readIndex();
  const key = `${source}_${id}`;
  const entry = index[key];
  if (!entry) {
    return NextResponse.json({ list: [] });
  }

  const storagePath = storageManager.getStoragePath();
  const resourcePath = PathUtils.resolveResourcePath(
    entry.local_path,
    storagePath
  );
  const metadata = storageManager.readMetadata(resourcePath);
  if (!metadata) {
    return NextResponse.json({ list: [] });
  }

  // 动态获取 base URL
  const host = request.headers.get('host') || 'localhost:1234';
  const protocol = request.headers.get('x-forwarded-proto') || 'http';
  const baseUrl = `${protocol}://${host}`;

  // 构建每集播放地址
  const episodes = metadata.episodes || [];
  const playUrls: string[] = [];

  episodes.forEach((ep: string, idx: number) => {
    if (typeof ep === 'string' && ep.trim().length > 0) {
      const epNum = idx + 1;
      const url = `${baseUrl}/api/tvbox/m3u8?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}&episode=${epNum}`;
      playUrls.push(`第${epNum}集$${url}`);
    }
  });

  return NextResponse.json({
    list: [
      {
        vod_id: ids,
        vod_name: metadata.title || entry.title,
        vod_pic: metadata.poster || '',
        vod_year: metadata.year || entry.year || '',
        vod_content: metadata.desc || '',
        type_name: metadata.type_name || '其他',
        vod_play_from: 'NAS本地',
        vod_play_url: playUrls.join('#'),
      },
    ],
  });
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
  const ac = searchParams.get('ac');

  if (ac === 'class') {
    return handleClass();
  } else if (ac === 'list') {
    const t = searchParams.get('t') || '';
    const pg = parseInt(searchParams.get('pg') || '1', 10);
    return handleList(t, pg);
  } else if (ac === 'detail') {
    const ids = searchParams.get('ids') || '';
    return handleDetail(request, ids);
  }

  // 默认返回分类
  return handleClass();
}
