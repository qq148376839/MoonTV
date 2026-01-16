import { NextRequest, NextResponse } from 'next/server';

import { httpRequest } from '@/lib/http-client';
import { M3U8Cleaner } from '@/lib/m3u8-cleaner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function isHttpUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function rewriteTagUri(
  line: string,
  baseUrl: string,
  source: string,
  id: string,
  episode: number,
  kind: 'key' | 'map',
  keyIndex?: number
): string {
  const m = line.match(/URI="([^"]+)"/);
  if (!m) return line;
  const raw = m[1];
  let absolute: string;
  try {
    absolute = raw.startsWith('http://') || raw.startsWith('https://')
      ? raw
      : new URL(raw, baseUrl).href;
  } catch {
    return line;
  }

  const keyPart =
    kind === 'key' && typeof keyIndex === 'number' && Number.isFinite(keyIndex)
      ? `&k=${encodeURIComponent(String(keyIndex))}`
      : '';

  const hybrid = `/api/local-hybrid/segment?kind=${encodeURIComponent(
    kind
  )}&source=${encodeURIComponent(source)}&id=${encodeURIComponent(
    id
  )}&episode=${encodeURIComponent(String(episode))}${keyPart}&referer=${encodeURIComponent(
    baseUrl
  )}&url=${encodeURIComponent(
    absolute
  )}`;
  return line.replace(/URI="([^"]+)"/, `URI="${hybrid}"`);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS_HEADERS } });
}

/**
 * GET /api/local-hybrid/m3u8?source=...&id=...&episode=...&url=...
 *
 * 输出：
 * - 将媒体播放列表中的 segment URI 重写为 /api/local-hybrid/segment?...
 * - segment 请求会“本地优先，缺失回源”，从而实现“无缝越来越本地”
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const source = sp.get('source') || '';
  const id = sp.get('id') || '';
  const episodeStr = sp.get('episode') || '';
  const url = sp.get('url') || '';
  const episode = parseInt(episodeStr, 10);

  if (!source || !id || !episodeStr || !Number.isFinite(episode) || episode < 1) {
    return new NextResponse('Missing/invalid source/id/episode', {
      status: 400,
      headers: { ...CORS_HEADERS },
    });
  }

  if (!url || !isHttpUrl(url)) {
    return new NextResponse('Missing/invalid url', {
      status: 400,
      headers: { ...CORS_HEADERS },
    });
  }

  try {
    const res = await httpRequest(url, {
      method: 'GET',
      timeout: 30000,
      retries: 2,
      headers: {
        // conservative headers; upstream may require referer-like behavior
        Referer: url,
        Accept: '*/*',
      },
    });

    if (!res.ok) {
      return new NextResponse(`Upstream error: ${res.status} ${res.statusText}`, {
        status: res.status,
        headers: { ...CORS_HEADERS },
      });
    }

    const content = res.body.toString('utf-8');

    // Align with downloader: apply the same cleaner by default (can be disabled)
    const filterSegments = process.env.LOCAL_STORAGE_M3U8_FILTER !== 'false';
    const cleaned = filterSegments ? M3U8Cleaner.clean(content, url) : content;

    const lines = cleaned.split('\n');
    const out: string[] = [];

    let segmentIndex = 0;
    // Align with downloader's key naming: key_000.key, key_001.key...
    // Use "first-seen key URL" ordering to assign keyIndex.
    const keyUrlToIndex = new Map<string, number>();
    let nextKeyIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        out.push(line);
        continue;
      }

      // Rewrite URI="..." in tags like EXT-X-KEY / EXT-X-MAP
      if (trimmed.startsWith('#EXT-X-KEY')) {
        // METHOD=NONE means no encryption; keep as-is
        if (/METHOD=NONE/i.test(trimmed)) {
          out.push(line);
          continue;
        }
        // Assign a stable keyIndex by key URL (first-seen order), matching downloader's map
        const km = trimmed.match(/URI="([^"]+)"/);
        if (!km) {
          out.push(line);
          continue;
        }
        const rawKeyUri = km[1];
        let keyAbs = rawKeyUri;
        try {
          keyAbs = rawKeyUri.startsWith('http://') || rawKeyUri.startsWith('https://')
            ? rawKeyUri
            : new URL(rawKeyUri, url).href;
        } catch {
          // ignore, keep raw
        }
        let keyIndex = keyUrlToIndex.get(keyAbs);
        if (keyIndex == null) {
          keyIndex = nextKeyIndex++;
          keyUrlToIndex.set(keyAbs, keyIndex);
        }
        out.push(rewriteTagUri(line, url, source, id, episode, 'key', keyIndex));
        continue;
      }

      if (trimmed.startsWith('#EXT-X-MAP')) {
        out.push(rewriteTagUri(line, url, source, id, episode, 'map'));
        continue;
      }

      // Variant playlists (master) - rewrite next m3u8 URI as another hybrid m3u8
      if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
        out.push(line);
        const next = lines[i + 1] || '';
        const nextTrim = next.trim();
        if (nextTrim && !nextTrim.startsWith('#')) {
          let absolute: string;
          try {
            absolute = nextTrim.startsWith('http://') || nextTrim.startsWith('https://')
              ? nextTrim
              : new URL(nextTrim, url).href;
          } catch {
            absolute = nextTrim;
          }
          const hybrid = `/api/local-hybrid/m3u8?source=${encodeURIComponent(
            source
          )}&id=${encodeURIComponent(id)}&episode=${encodeURIComponent(
            String(episode)
          )}&url=${encodeURIComponent(absolute)}`;
          out.push(hybrid);
          i++; // consume next line
        }
        continue;
      }

      // Segment / child m3u8 line (non-comment)
      if (!trimmed.startsWith('#')) {
        let absolute: string;
        try {
          absolute = trimmed.startsWith('http://') || trimmed.startsWith('https://')
            ? trimmed
            : new URL(trimmed, url).href;
        } catch {
          absolute = trimmed;
        }

        // If it's a nested m3u8, treat it as another m3u8
        if (trimmed.includes('.m3u8')) {
          const hybrid = `/api/local-hybrid/m3u8?source=${encodeURIComponent(
            source
          )}&id=${encodeURIComponent(id)}&episode=${encodeURIComponent(
            String(episode)
          )}&url=${encodeURIComponent(absolute)}`;
          out.push(hybrid);
          continue;
        }

        const seg = `/api/local-hybrid/segment?kind=ts&source=${encodeURIComponent(
          source
        )}&id=${encodeURIComponent(id)}&episode=${encodeURIComponent(
          String(episode)
        )}&index=${encodeURIComponent(String(segmentIndex))}&referer=${encodeURIComponent(
          url
        )}&url=${encodeURIComponent(
          absolute
        )}`;
        out.push(seg);
        segmentIndex++;
        continue;
      }

      out.push(line);
    }

    return new NextResponse(out.join('\n'), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return new NextResponse(`Hybrid m3u8 error: ${e instanceof Error ? e.message : String(e)}`, {
      status: 500,
      headers: { ...CORS_HEADERS },
    });
  }
}

