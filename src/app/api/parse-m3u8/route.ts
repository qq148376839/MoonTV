import { NextRequest, NextResponse } from 'next/server';

import { parseToM3u8Url } from '@/lib/parse-helper';

export const runtime = 'nodejs';

// 简单内存缓存：避免同一个 URL 在短时间内重复解析
const cache = new Map<string, { url: string; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5分钟

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const videoUrl = searchParams.get('url');

  if (!videoUrl) {
    return new NextResponse('Missing url parameter', { status: 400 });
  }

  const now = Date.now();
  const cached = cache.get(videoUrl);
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return NextResponse.redirect(cached.url, 302);
  }

  const m3u8Url = await parseToM3u8Url(videoUrl, request.nextUrl.origin);
  if (!m3u8Url) {
    return new NextResponse('Failed to parse m3u8 url', { status: 404 });
  }

  cache.set(videoUrl, { url: m3u8Url, ts: now });
  return NextResponse.redirect(m3u8Url, 302);
}
