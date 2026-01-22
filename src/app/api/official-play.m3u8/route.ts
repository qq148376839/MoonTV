/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getDownloadService } from '@/lib/download-service';
import { getStorageManager } from '@/lib/local-storage';
import { parseToM3u8Url } from '@/lib/parse-helper';
import { PathUtils } from '@/lib/path-utils';
import { searchOfficialResources } from '@/lib/search-independent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RECENT_TRIGGER_TTL_MS = 60_000;
const recentTriggers = new Map<string, number>();

function getOrigin(request: NextRequest): string {
  const originHeader = request.headers.get('origin');
  if (originHeader) return originHeader.includes('0.0.0.0') ? originHeader.replace('0.0.0.0', 'localhost') : originHeader;
  const host = request.headers.get('host') || 'localhost:51000';
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  return `${proto}://${host.includes('0.0.0.0') ? host.replace('0.0.0.0', 'localhost') : host}`;
}

function getDownloadNextCount(): number {
  const raw = process.env.LOCAL_STORAGE_AUTO_DOWNLOAD_NEXT;
  const n = raw == null ? 3 : parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 3;
  return Math.min(n, 50);
}

function getLocalEpisodeM3u8Path(source: string, id: string, episodeNo: number): string | null {
  const storageManager = getStorageManager();
  if (!storageManager.isEnabled()) return null;
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

  const list = await searchOfficialResources(q, undefined);
  const resource = list.find((r) => r && String(r.id) === String(id) && r.source === source);
  if (!resource || !Array.isArray(resource.episodes) || resource.episodes.length === 0) return;

  const epNumbers: number[] = [];
  for (let n = start; n <= end; n++) epNumbers.push(n);
  const episodesToDownload = epNumbers.map((n) => resource.episodes[n - 1]).filter(Boolean);
  if (episodesToDownload.length === 0) return;

  downloadService.createTask(resource, episodesToDownload, epNumbers);
}

/**
 * OrionTV 兼容：官方资源播放接口
 * - 输入：url=<第三方网页HTML地址>
 * - 输出：解析成功 302 跳转到真实 m3u8；解析失败返回 5xx（让 OrionTV 弹错）
 *
 * 备注：此路由路径以 .m3u8 结尾，避免 OrionTV 在某些逻辑中因 URL 非 m3u8 而跳过/过滤。
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const url = sp.get('url');
  const source = sp.get('source') || '';
  const id = sp.get('id') || '';
  const q = sp.get('q') || '';
  const ep = parseInt(sp.get('ep') || '', 10);
  const total = parseInt(sp.get('total') || '', 10);

  // 向后兼容：允许仅提供 url（旧版 episodes: /api/official-play.m3u8?url=...）
  // 这种情况下：只做解析并 302，不触发下载/不走本地优先。
  const hasFullParams =
    !!source && !!id && !!q && Number.isFinite(ep) && ep >= 1;
  if (!url || !url.trim()) {
    return new NextResponse('Missing url', { status: 400 });
  }

  // 基础安全约束：只允许 http/https
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return new NextResponse('Invalid url protocol', { status: 400 });
    }
  } catch {
    return new NextResponse('Invalid url', { status: 400 });
  }

  const origin = getOrigin(request);

  if (hasFullParams) {
    // 已完整下载：直接返回本地 m3u8（不完整则继续走在线）
    const storageManager = getStorageManager();
    if (
      storageManager.isEnabled() &&
      storageManager.isEpisodeDownloaded(source, id, ep)
    ) {
      const localM3u8 = getLocalEpisodeM3u8Path(source, id, ep);
      if (localM3u8) {
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
    }).catch((err) => console.warn('[official-play] triggerDownload failed', err));
  }

  const m3u8Url = await parseToM3u8Url(url, origin);

  if (!m3u8Url) {
    return new NextResponse('Failed to parse m3u8', { status: 502 });
  }

  return NextResponse.redirect(m3u8Url, 302);
}

