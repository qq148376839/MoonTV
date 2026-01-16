import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

import { httpRequest } from '@/lib/http-client';
import { getStorageManager } from '@/lib/local-storage';
import { PathUtils } from '@/lib/path-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

// In-memory cache for resolving `${source}_${id}` -> absolute resource directory.
// This is important because index.json/metadata.json may be missing (legacy or partially-written),
// but downloaded episode folders/files can still exist.
const resourcePathCache = new Map<string, { path: string; at: number }>();
const RESOURCE_CACHE_TTL_MS = 5 * 60 * 1000;

function contentTypeFor(kind: string): string {
  if (kind === 'key') return 'application/octet-stream';
  if (kind === 'ts') return 'video/mp2t';
  if (kind === 'map') return 'video/mp4';
  return 'application/octet-stream';
}

function withHybridDebugHeaders(
  headers: Record<string, string>,
  info: {
    source: 'local' | 'upstream';
    kind: string;
    episode: number;
    index?: number;
    k?: number;
    localPath?: string;
    upstreamUrl?: string;
    note?: string;
  }
): Record<string, string> {
  const out: Record<string, string> = { ...headers };
  out['X-MoonTV-Hybrid-Source'] = info.source;
  out['X-MoonTV-Hybrid-Kind'] = info.kind;
  out['X-MoonTV-Hybrid-Episode'] = String(info.episode);
  if (typeof info.index === 'number') out['X-MoonTV-Hybrid-Index'] = String(info.index);
  if (typeof info.k === 'number') out['X-MoonTV-Hybrid-KeyIndex'] = String(info.k);
  if (info.localPath) out['X-MoonTV-Hybrid-Local-Path'] = info.localPath;
  if (info.upstreamUrl) out['X-MoonTV-Hybrid-Upstream'] = info.upstreamUrl.substring(0, 200);
  if (info.note) out['X-MoonTV-Hybrid-Note'] = info.note.substring(0, 200);
  return out;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS_HEADERS } });
}

/**
 * GET /api/local-hybrid/segment?kind=ts|key&source=...&id=...&episode=...&index=...&url=...
 *
 * - kind=ts: 优先读取本地 `episode_XX/segment_YYY.ts`（YYY 由 index padStart(3)）
 * - 缺失则回源代理 `url`
 * - kind=key: 优先读取本地 `episode_XX/key_KKK.key`（KKK 由 k padStart(3)；若缺失则回源）
 * - kind=map: init segment，直接回源代理
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const kind = (sp.get('kind') || 'ts').toLowerCase();
  const source = sp.get('source') || '';
  const id = sp.get('id') || '';
  const episodeStr = sp.get('episode') || '';
  const indexStr = sp.get('index') || '';
  const kStr = sp.get('k') || '';
  const refererParam = sp.get('referer') || '';
  const url = sp.get('url') || '';

  const episode = parseInt(episodeStr, 10);
  const index = parseInt(indexStr, 10);
  const k = parseInt(kStr, 10);

  if (!source || !id || !episodeStr || !Number.isFinite(episode) || episode < 1) {
    return new NextResponse('Missing/invalid source/id/episode', {
      status: 400,
      headers: { ...CORS_HEADERS },
    });
  }

  if (!url) {
    return new NextResponse('Missing url', {
      status: 400,
      headers: { ...CORS_HEADERS },
    });
  }

  const storageManager = getStorageManager();
  const indexJson = storageManager.readIndex();
  const key = `${source}_${id}`;
  const entry = indexJson[key];

  // Resolve local resource directory if possible
  let resourcePath: string | null = null;
  const now = Date.now();
  const cached = resourcePathCache.get(key);
  if (cached && now - cached.at <= RESOURCE_CACHE_TTL_MS && fs.existsSync(cached.path)) {
    resourcePath = cached.path;
  } else if (entry) {
    resourcePath = PathUtils.resolveResourcePath(
      entry.local_path,
      storageManager.getStoragePath()
    );
    if (resourcePath) {
      resourcePathCache.set(key, { path: resourcePath, at: now });
    }
  } else {
    // Fallback scan:
    // storagePath layout is usually: <storagePath>/<title_year>/<source_id>
    // e.g. data/videos/长安二十四计_2025/789caiji_91526
    try {
      const storagePath = storageManager.getStoragePath();
      const absStoragePath = path.resolve(process.cwd(), storagePath);
      if (fs.existsSync(absStoragePath)) {
        const roots = fs.readdirSync(absStoragePath, { withFileTypes: true });
        for (const dir of roots) {
          if (!dir.isDirectory()) continue;
          const candidate = path.join(absStoragePath, dir.name, key);
          if (fs.existsSync(candidate)) {
            const st = fs.statSync(candidate);
            if (st.isDirectory()) {
              resourcePath = candidate;
              resourcePathCache.set(key, { path: candidate, at: now });
              break;
            }
          }
        }
      }
    } catch {
      // ignore, fallback to upstream
    }
  }

  // 1) Local-first for TS segments
  if (kind === 'ts' && Number.isFinite(index) && index >= 0 && resourcePath) {
    try {
      const epNo = String(episode).padStart(2, '0');
      const segNo = String(index).padStart(3, '0');
      const localSegPath = path.join(
        resourcePath,
        `episode_${epNo}`,
        `segment_${segNo}.ts`
      );

      if (fs.existsSync(localSegPath)) {
        const stat = fs.statSync(localSegPath);
        if (stat.isFile() && stat.size > 0) {
          const buf = fs.readFileSync(localSegPath);
          return new NextResponse(buf, {
            status: 200,
            headers: {
              ...withHybridDebugHeaders(
                {
                  ...CORS_HEADERS,
                  'Content-Type': contentTypeFor('ts'),
                  'Content-Length': String(buf.length),
                  'Cache-Control': 'no-store',
                },
                {
                  source: 'local',
                  kind: 'ts',
                  episode,
                  index,
                  localPath: localSegPath,
                }
              ),
            },
          });
        }
      }
    } catch {
      // ignore and fallback to upstream
    }
  }

  // 1.5) Local-first for KEY
  if (kind === 'key' && resourcePath) {
    try {
      const epNo = String(episode).padStart(2, '0');
      const episodeDir = path.join(resourcePath, `episode_${epNo}`);

      // Prefer deterministic k-index naming: key_000.key, key_001.key, ...
      if (Number.isFinite(k) && k >= 0) {
        const keyNo = String(k).padStart(3, '0');
        const localKeyPath = path.join(episodeDir, `key_${keyNo}.key`);
        if (fs.existsSync(localKeyPath)) {
          const st = fs.statSync(localKeyPath);
          if (st.isFile() && st.size > 0) {
            const buf = fs.readFileSync(localKeyPath);
            return new NextResponse(buf, {
              status: 200,
              headers: {
                ...withHybridDebugHeaders(
                  {
                    ...CORS_HEADERS,
                    'Content-Type': contentTypeFor('key'),
                    'Content-Length': String(buf.length),
                    'Cache-Control': 'no-store',
                  },
                  {
                    source: 'local',
                    kind: 'key',
                    episode,
                    k,
                    localPath: localKeyPath,
                  }
                ),
              },
            });
          }
        }
      } else {
        // Best-effort fallback: if exactly one key file exists, serve it
        if (fs.existsSync(episodeDir)) {
          const files = fs.readdirSync(episodeDir);
          const keys = files
            .filter((f) => /^key_\d{3}\.key$/i.test(f))
            .sort();
          if (keys.length === 1) {
            const localKeyPath = path.join(episodeDir, keys[0]);
            const st = fs.statSync(localKeyPath);
            if (st.isFile() && st.size > 0) {
              const buf = fs.readFileSync(localKeyPath);
              return new NextResponse(buf, {
                status: 200,
                headers: {
                  ...withHybridDebugHeaders(
                    {
                      ...CORS_HEADERS,
                      'Content-Type': contentTypeFor('key'),
                      'Content-Length': String(buf.length),
                      'Cache-Control': 'no-store',
                    },
                    {
                      source: 'local',
                      kind: 'key',
                      episode,
                      localPath: localKeyPath,
                      note: 'fallback-single-key',
                    }
                  ),
                },
              });
            }
          }
        }
      }
    } catch {
      // ignore and fallback to upstream
    }
  }

  // 2) Fallback: proxy upstream (ts/key/others)
  try {
    const range = request.headers.get('range') || undefined;
    const upstreamReferer = refererParam || url;
    const resp = await httpRequest(url, {
      method: 'GET',
      timeout: 30000,
      retries: 2,
      headers: {
        ...(range ? { Range: range } : {}),
        Referer: upstreamReferer,
        Accept: '*/*',
        ...(kind === 'key'
          ? { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
          : {}),
      },
    });

    const headers: Record<string, string> = {
      ...withHybridDebugHeaders(
        {
          ...CORS_HEADERS,
          'Content-Type': resp.headers['content-type'] || contentTypeFor(kind),
          'Cache-Control': 'no-store',
        },
        {
          source: 'upstream',
          kind,
          episode,
          index: Number.isFinite(index) ? index : undefined,
          k: Number.isFinite(k) ? k : undefined,
          upstreamUrl: url,
          note: !entry
            ? resourcePath
              ? 'index-miss-scan-hit'
              : 'index-miss-scan-miss'
            : !resourcePath
              ? 'resourcePath-miss'
              : 'local-miss',
        }
      ),
    };
    const len = resp.headers['content-length'];
    if (len) headers['Content-Length'] = len;
    const cr = resp.headers['content-range'];
    if (cr) headers['Content-Range'] = cr;
    const ar = resp.headers['accept-ranges'];
    if (ar) headers['Accept-Ranges'] = ar;

    // NextResponse body typing is stricter than Buffer; convert to Uint8Array (BodyInit-compatible)
    return new NextResponse(new Uint8Array(resp.body), {
      status: resp.status,
      headers,
    });
  } catch (e) {
    return new NextResponse(
      `Hybrid segment error: ${e instanceof Error ? e.message : String(e)}`,
      { status: 502, headers: { ...CORS_HEADERS } }
    );
  }
}

