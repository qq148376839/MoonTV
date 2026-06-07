/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getDownloadService } from '@/lib/download-service';
import { getStorageManager } from '@/lib/local-storage';
import { PathUtils } from '@/lib/path-utils';
import { searchUnofficialResources } from '@/lib/search-independent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RECENT_TRIGGER_TTL_MS = 60_000;
const recentTriggers = new Map<string, number>();

function getOrigin(request: NextRequest): string {
  const originHeader = request.headers.get('origin');
  if (originHeader)
    return originHeader.includes('0.0.0.0')
      ? originHeader.replace('0.0.0.0', 'localhost')
      : originHeader;
  const host = request.headers.get('host') || 'localhost:51000';
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  return `${proto}://${
    host.includes('0.0.0.0') ? host.replace('0.0.0.0', 'localhost') : host
  }`;
}

function isHttpUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function getDownloadNextCount(): number {
  const raw = process.env.LOCAL_STORAGE_AUTO_DOWNLOAD_NEXT;
  const n = raw == null ? 3 : parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 3;
  return Math.min(n, 50);
}

function getLocalEpisodeM3u8Path(
  source: string,
  id: string,
  episodeNo: number
): string | null {
  const storageManager = getStorageManager();
  if (!storageManager.isEnabled()) return null;

  // 与 StorageManager.isEpisodeDownloaded 的约定一致：resourcePath/episode_XX.m3u8
  const index = storageManager.readIndex();
  const key = `${source}_${id}`;
  const entry = index[key];
  if (!entry) return null;
  const resourcePath = PathUtils.resolveResourcePath(
    entry.local_path,
    storageManager.getStoragePath()
  );
  const epNo = String(episodeNo).padStart(2, '0');
  return `${resourcePath}/episode_${epNo}.m3u8`;
}

async function triggerDownloadIfNeeded(params: {
  q: string;
  source: string;
  id: string;
  episodeNo: number;
  total: number;
}) {
  const { q, source, id, episodeNo, total } = params;
  const downloadService = getDownloadService();
  if (!downloadService.isEnabled()) return;

  const isMovie = total === 1;
  const nextN = isMovie ? 0 : getDownloadNextCount();
  const start = episodeNo;
  const end = Math.min(total || episodeNo, episodeNo + nextN);
  const key = `${source}_${id}_${start}_${end}`;

  const last = recentTriggers.get(key);
  if (last && Date.now() - last < RECENT_TRIGGER_TTL_MS) return;
  recentTriggers.set(key, Date.now());

  // 获取该资源的完整 episodes（不依赖 config.json）
  const list = await searchUnofficialResources(q, undefined, {
    exactTitle: q,
    limit: 1,
    source,
  });
  const resource = list.find(
    (r) => r && String(r.id) === String(id) && r.source === source
  );
  if (
    !resource ||
    !Array.isArray(resource.episodes) ||
    resource.episodes.length === 0
  )
    return;

  const epNumbers: number[] = [];
  for (let n = start; n <= end; n++) epNumbers.push(n);
  const episodesToDownload = epNumbers
    .map((n) => resource.episodes[n - 1])
    .filter(Boolean);
  if (episodesToDownload.length === 0) return;

  downloadService.createTask(resource, episodesToDownload, epNumbers);
}

/**
 * OrionTV 兼容：非官方资源播放接口
 * - episodes 全量改写为该接口（携带 source/id/ep/total/q/url）
 * - 行为：若本地该集已完整下载 => 302 到本地 m3u8；否则异步触发下载（当前+后N），并 302 到代理 m3u8
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const source = sp.get('source') || '';
  const id = sp.get('id') || '';
  const q = sp.get('q') || '';
  const url = sp.get('url') || '';
  const ep = parseInt(sp.get('ep') || '', 10);
  const total = parseInt(sp.get('total') || '', 10);

  if (!source || !id || !q || !url || !Number.isFinite(ep) || ep < 1) {
    return new NextResponse('Missing/invalid params', { status: 400 });
  }
  if (!isHttpUrl(url)) {
    return new NextResponse('Invalid url', { status: 400 });
  }

  const storageManager = getStorageManager();
  if (
    storageManager.isEnabled() &&
    storageManager.isEpisodeDownloaded(source, id, ep)
  ) {
    const localM3u8 = getLocalEpisodeM3u8Path(source, id, ep);
    if (localM3u8) {
      const origin = getOrigin(request);
      const local = `${origin}/api/local-video?path=${encodeURIComponent(
        localM3u8
      )}`;
      return NextResponse.redirect(local, 302);
    }
  }

  // 异步触发下载（不阻塞播放）
  triggerDownloadIfNeeded({
    q,
    source,
    id,
    episodeNo: ep,
    total: Number.isFinite(total) && total > 0 ? total : ep,
  }).catch((err) =>
    console.warn('[unofficial-play] triggerDownload failed', err)
  );

  const origin = getOrigin(request);
  const proxied = `${origin}/api/proxy/m3u8?url=${encodeURIComponent(url)}`;
  return NextResponse.redirect(proxied, 302);
}
