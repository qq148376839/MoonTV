import { NextResponse } from 'next/server';

import { getCacheTime, getConfig } from '@/lib/config';
import { SearchResult } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'edge';

// 用于线上快速确认是否已经部署了最新代码（curl -i 查看响应头）
const SEARCH_ROUTE_REV = '2026-01-22.2';

type IdleTimeoutResult = { timeout: true };
type ReadWithIdleTimeoutResult =
  | ReadableStreamReadResult<Uint8Array>
  | IdleTimeoutResult;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function buildOfficialPlayUrl(params: {
  origin: string | undefined;
  q: string;
  source: string;
  id: string;
  epNo: number;
  total: number;
  episodeUrl: string;
}): string {
  const { origin, q, source, id, epNo, total, episodeUrl } = params;
  const prefix = origin ? `${origin}` : '';
  return `${prefix}/api/official-play.m3u8?q=${encodeURIComponent(
    q
  )}&source=${encodeURIComponent(source)}&id=${encodeURIComponent(
    id
  )}&ep=${encodeURIComponent(String(epNo))}&total=${encodeURIComponent(
    String(total)
  )}&url=${encodeURIComponent(episodeUrl)}`;
}

function buildUnofficialPlayUrl(params: {
  origin: string | undefined;
  q: string;
  source: string;
  id: string;
  epNo: number;
  total: number;
  episodeUrl: string;
}): string {
  const { origin, q, source, id, epNo, total, episodeUrl } = params;
  const prefix = origin ? `${origin}` : '';
  return `${prefix}/api/unofficial-play.m3u8?q=${encodeURIComponent(
    q
  )}&source=${encodeURIComponent(source)}&id=${encodeURIComponent(
    id
  )}&ep=${encodeURIComponent(String(epNo))}&total=${encodeURIComponent(
    String(total)
  )}&url=${encodeURIComponent(episodeUrl)}`;
}

function normalizeOfficialSource(result: SearchResult): SearchResult {
  if (result.source_type === 'official') {
    return {
      ...result,
      source: '789caiji',
      source_name: '789采集',
    };
  }
  return result;
}

async function collectSearchResultsFromStream(params: {
  request: Request;
  query: string;
  maxTotalMs: number;
  idleMs: number;
  firstByteMs: number;
}): Promise<SearchResult[]> {
  const { request, query, maxTotalMs, idleMs, firstByteMs } = params;
  const urlObj = new URL(request.url);
  const externalBaseUrl = `${urlObj.protocol}//${urlObj.host}`;
  const internalPort = process.env.PORT || '3000';
  const internalBaseUrl = `http://127.0.0.1:${internalPort}`;

  const internalStreamUrl = `${internalBaseUrl}/api/search/stream?q=${encodeURIComponent(query)}`;
  const externalStreamUrl = `${externalBaseUrl}/api/search/stream?q=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), maxTotalMs);

  let res: Response;
  try {
    // Docker/反代场景下，容器内直接请求公网域名回环经常失败；
    // 优先快速探测 internal loopback，失败则回退 external host。
    const shouldTryInternalFirst =
      urlObj.hostname !== 'localhost' && urlObj.hostname !== '127.0.0.1';

    if (shouldTryInternalFirst) {
      const probe = new AbortController();
      const probeId = setTimeout(() => probe.abort(), 800);
      try {
        res = await fetch(internalStreamUrl, {
          headers: { Accept: 'text/event-stream' },
          signal: probe.signal,
          cache: 'no-store',
        });
        clearTimeout(probeId);
      } catch {
        clearTimeout(probeId);
        res = await fetch(externalStreamUrl, {
          headers: { Accept: 'text/event-stream' },
          signal: controller.signal,
          cache: 'no-store',
        });
      }
    } else {
      res = await fetch(externalStreamUrl, {
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
        cache: 'no-store',
      });
    }
  } catch {
    clearTimeout(timeoutId);
    return [];
  }

  if (!res.ok || !res.body) {
    clearTimeout(timeoutId);
    return [];
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const startedAt = Date.now();
  let hasAnyChunk = false;

  const seen = new Set<string>();
  const out: SearchResult[] = [];

  const readWithIdleTimeout =
    async (): Promise<ReadWithIdleTimeoutResult> => {
      const waitMs = hasAnyChunk ? idleMs : firstByteMs;
      return await Promise.race([
        reader.read(),
        new Promise<IdleTimeoutResult>((resolve) =>
          setTimeout(() => resolve({ timeout: true }), waitMs)
        ),
      ]);
    };

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const r = await readWithIdleTimeout();
      if ('timeout' in r) {
        // 空闲超时：流还在，但一段时间没有新数据，收敛返回
        try {
          reader.cancel();
        } catch {
          // ignore
        }
        break;
      }

      const { value, done } = r as ReadableStreamReadResult<Uint8Array>;
      if (done) break;
      if (value) {
        hasAnyChunk = true;
        buffer += decoder.decode(value, { stream: true });
      }

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const jsonStr = trimmed.substring(5).trim();
        if (!jsonStr) continue;

        let msg: unknown;
        try {
          msg = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        const msgObj = isRecord(msg) ? msg : null;
        const results = msgObj && Array.isArray(msgObj.results) ? msgObj.results : [];
        for (const item of results) {
          if (!item || typeof item !== 'object') continue;
          const sr: SearchResult = normalizeOfficialSource(item as SearchResult);
          const key = `${sr.source_type || 'unknown'}-${sr.source}-${sr.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(sr);
        }

        if (msgObj?.done === true) {
          try {
            reader.cancel();
          } catch {
            // ignore
          }
          clearTimeout(timeoutId);
          return out;
        }
      }

      const now = Date.now();
      if (now - startedAt > maxTotalMs) break;
    }
  } catch {
    // ignore; return partial
  } finally {
    clearTimeout(timeoutId);
  }

  return out;
}

/**
 * 检测本地资源并获取播放 URL（用于 OrionTV 兼容性）
 * 在 Edge Runtime 中通过 HTTP 调用本地资源检测 API
 */
async function getLocalResourcePlayUrl(
  source: string,
  id: string,
  episodeIndex = 0,
  baseUrl?: string
): Promise<string | null> {
  try {
    // 构建 API 路径
    const apiPath = baseUrl
      ? `${baseUrl}/api/local-resource?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}`
      : `/api/local-resource?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}`;

    // 调用本地资源检测 API
    const response = await fetch(apiPath, {
      cache: 'no-store',
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (!data.exists || !data.metadata) {
      return null;
    }

    // 检查指定剧集是否已下载
    const episodes = data.metadata.episodes || [];
    if (episodeIndex < 0 || episodeIndex >= episodes.length) {
      return null;
    }

    const episodePath = episodes[episodeIndex];
    if (
      !episodePath ||
      typeof episodePath !== 'string' ||
      !episodePath.trim()
    ) {
      return null;
    }

    // 构建本地资源播放 URL
    const encodedPath = encodeURIComponent(episodePath);
    const playUrl = baseUrl
      ? `${baseUrl}/api/local-video?path=${encodedPath}`
      : `/api/local-video?path=${encodedPath}`;

    return playUrl;
  } catch (error) {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    const cacheTime = await getCacheTime();
    return NextResponse.json(
      { results: [] },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        },
      }
    );
  }

  const config = await getConfig();

  // 获取当前请求的 origin（用于构建代理 URL）
  let origin: string | undefined;
  try {
    origin = request.headers.get('origin') || undefined;
    if (!origin) {
      const host = request.headers.get('host');
      if (host) {
        const urlObj = new URL(request.url);
        origin = `${urlObj.protocol}//${host}`;
      }
    }
    // 如果 origin 包含 0.0.0.0，替换为 localhost
    if (origin && origin.includes('0.0.0.0')) {
      origin = origin.replace('0.0.0.0', 'localhost');
    }
  } catch {
    origin = undefined;
  }

  try {
    const ua = request.headers.get('user-agent') || '';
    const isOrionTV = ua.toLowerCase().includes('oriontv');

    // 获取基础 URL（用于调用本地资源检测 API）
    let baseUrl: string | undefined;
    try {
      const urlObj = new URL(request.url);
      baseUrl = `${urlObj.protocol}//${urlObj.host}`;
      if (baseUrl.includes('0.0.0.0')) {
        baseUrl = baseUrl.replace('0.0.0.0', 'localhost');
      }
    } catch {
      baseUrl = undefined;
    }

    // OrionTV 优化：只返回同标题的少量结果（避免对大量结果逐个 parse 导致超时）
    if (isOrionTV) {
      const streamed = await collectSearchResultsFromStream({
        request,
        query,
        maxTotalMs: 16000,
        firstByteMs: 6000,
        idleMs: 1200,
      });

      const results: SearchResult[] = [];
      const exact = streamed.filter((r) => r.title === query);
      const official = exact.find((r) => r.source_type === 'official');
      const unofficial = exact.find((r) => r.source_type === 'unofficial');

      for (const r of [official, unofficial]) {
        if (!r) continue;
        if (r.episodes && r.episodes.length > 0) {
          const totalEpisodes = r.episodes.length;
          if (r.source_type === 'official') {
            r.episodes = r.episodes.map((ep, idx) =>
              buildOfficialPlayUrl({
                origin,
                q: query,
                source: r.source,
                id: r.id,
                epNo: idx + 1,
                total: totalEpisodes,
                episodeUrl: ep,
              })
            );
          } else {
            r.episodes = r.episodes.map((ep, idx) =>
              buildUnofficialPlayUrl({
                origin,
                q: query,
                source: r.source,
                id: r.id,
                epNo: idx + 1,
                total: totalEpisodes,
                episodeUrl: ep,
              })
            );
          }

          const localPlayUrl = await getLocalResourcePlayUrl(
            r.source,
            r.id,
            0,
            baseUrl
          );
          if (localPlayUrl) r.episodes[0] = localPlayUrl;
        }
        results.push(r);
      }

      return NextResponse.json(
        { results },
        {
          headers: {
            'X-MoonTV-Search-Rev': SEARCH_ROUTE_REV,
            // /api/search 结果来自 stream 聚合：避免浏览器缓存旧的空结果造成“看起来搜不到”
            'Cache-Control': 'no-store',
            'CDN-Cache-Control': 'no-store',
            'Vercel-CDN-Cache-Control': 'no-store',
          },
        }
      );
    }

    // Web 端：聚合 /api/search/stream 结果，确保与 MoonTV Web 搜索展示一致
    const allResults = await collectSearchResultsFromStream({
      request,
      query,
      maxTotalMs: 20000,
      firstByteMs: 8000,
      idleMs: 1500,
    });

    let flattenedResults = allResults;
    if (!config.SiteConfig.DisableYellowFilter) {
      flattenedResults = flattenedResults.filter((result) => {
        const typeName = result.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }
    return NextResponse.json(
      { results: flattenedResults },
      {
        headers: {
          'X-MoonTV-Search-Rev': SEARCH_ROUTE_REV,
          // /api/search 结果来自 stream 聚合：避免浏览器缓存旧的空结果造成“看起来搜不到”
          'Cache-Control': 'no-store',
          'CDN-Cache-Control': 'no-store',
          'Vercel-CDN-Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    const debug = searchParams.get('debug') === '1';
    const msg =
      error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    // eslint-disable-next-line no-console
    console.error('[api/search] failed:', msg || error);
    return NextResponse.json(
      debug ? { error: '搜索失败', message: msg || 'unknown' } : { error: '搜索失败' },
      { status: 500, headers: { 'X-MoonTV-Search-Rev': SEARCH_ROUTE_REV } }
    );
  }
}
