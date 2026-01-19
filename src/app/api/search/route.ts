import { NextResponse } from 'next/server';

import { getCacheTime, getConfig } from '@/lib/config';
import {
  convertOfficialEpisodes,
  convertUnofficialEpisodes,
} from '@/lib/parse-helper';
import {
  searchOfficialResources,
  searchUnofficialResources,
} from '@/lib/search-independent';
import { SearchResult } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'edge';

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

    console.log(
      `[search] 检测到本地资源，使用本地播放 URL: ${playUrl.substring(0, 100)}...`
    );
    return playUrl;
  } catch (error) {
    console.warn(`[search] 检测本地资源失败:`, error);
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
  } catch (e) {
    console.warn('[search] 无法获取 origin:', e);
  }

  try {
    // 并发搜索官方和非官方资源
    const [officialResults, unofficialResults] = await Promise.allSettled([
      searchOfficialResources(query, undefined),
      searchUnofficialResources(query, undefined),
    ]);

    // 合并结果
    const allResults: SearchResult[] = [];
    const seenResults = new Set<string>(); // 用于去重

    // 获取基础 URL（用于调用本地资源检测 API）
    let baseUrl: string | undefined;
    try {
      const urlObj = new URL(request.url);
      baseUrl = `${urlObj.protocol}//${urlObj.host}`;
    } catch (e) {
      console.warn('[search] 无法获取 baseUrl:', e);
    }

    // 处理官方资源搜索结果
    if (officialResults.status === 'fulfilled') {
      // 对官方资源的 episodes 进行预处理：将 HTML URL 转换为 m3u8 URL
      for (const result of officialResults.value) {
        const key = `${result.source_type || 'official'}-${result.id}`;
        if (!seenResults.has(key)) {
          seenResults.add(key);
          // 转换官方资源的 episodes（OrionTV 兼容性）
          if (result.episodes && result.episodes.length > 0) {
            result.episodes = await convertOfficialEpisodes(
              result.episodes,
              origin
            );
            // 检测本地资源（优先使用本地资源播放）
            const localPlayUrl = await getLocalResourcePlayUrl(
              result.source,
              result.id,
              0, // 只检测第一个 episode（OrionTV 通常只播放第一个）
              baseUrl
            );
            if (localPlayUrl) {
              // 替换第一个 episode 为本地播放 URL
              result.episodes[0] = localPlayUrl;
            }
          }
          allResults.push(result);
        }
      }
    }

    // 处理非官方资源搜索结果
    if (unofficialResults.status === 'fulfilled') {
      for (const result of unofficialResults.value) {
        const key = `${result.source_type || 'unofficial'}-${result.id}`;
        if (!seenResults.has(key)) {
          seenResults.add(key);
          // 转换非官方资源的 episodes 为代理 URL（解决 CORS 问题）
          if (result.episodes && result.episodes.length > 0) {
            result.episodes = convertUnofficialEpisodes(
              result.episodes,
              origin
            );
            // 检测本地资源（优先使用本地资源播放）
            const localPlayUrl = await getLocalResourcePlayUrl(
              result.source,
              result.id,
              0, // 只检测第一个 episode（OrionTV 通常只播放第一个）
              baseUrl
            );
            if (localPlayUrl) {
              // 替换第一个 episode 为本地播放 URL
              result.episodes[0] = localPlayUrl;
            }
          }
          allResults.push(result);
        }
      }
    }

    let flattenedResults = allResults;
    if (!config.SiteConfig.DisableYellowFilter) {
      flattenedResults = flattenedResults.filter((result) => {
        const typeName = result.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }
    const cacheTime = await getCacheTime();

    return NextResponse.json(
      { results: flattenedResults },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        },
      }
    );
  } catch (error) {
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}
