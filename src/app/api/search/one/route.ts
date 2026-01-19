import { NextResponse } from 'next/server';

import { getCacheTime, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import {
  convertOfficialEpisodes,
  convertUnofficialEpisodes,
} from '@/lib/parse-helper';
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
      `[search/one] 检测到本地资源，使用本地播放 URL: ${playUrl.substring(0, 100)}...`
    );
    return playUrl;
  } catch (error) {
    console.warn(`[search/one] 检测本地资源失败:`, error);
    return null;
  }
}

// OrionTV 兼容接口
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const resourceId = searchParams.get('resourceId');

  if (!query || !resourceId) {
    const cacheTime = await getCacheTime();
    return NextResponse.json(
      { result: null, error: '缺少必要参数: q 或 resourceId' },
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
  const apiSites = config.SourceConfig.filter((site) => !site.disabled);

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
    console.warn('[search/one] 无法获取 origin:', e);
  }

  try {
    // 根据 resourceId 查找对应的 API 站点
    const targetSiteConfig = apiSites.find((site) => site.key === resourceId);
    if (!targetSiteConfig) {
      return NextResponse.json(
        {
          error: `未找到指定的视频源: ${resourceId}`,
          result: null,
        },
        { status: 404 }
      );
    }

    // 转换为 ApiSite 格式，包含 official_parser 字段
    const targetSite = {
      key: targetSiteConfig.key,
      name: targetSiteConfig.name,
      api: targetSiteConfig.api,
      detail: targetSiteConfig.detail,
      official_parser: targetSiteConfig.official_parser ?? false,
    };

    // 获取基础 URL（用于调用本地资源检测 API）
    let baseUrl: string | undefined;
    try {
      const urlObj = new URL(request.url);
      baseUrl = `${urlObj.protocol}//${urlObj.host}`;
    } catch (e) {
      console.warn('[search/one] 无法获取 baseUrl:', e);
    }

    const results = await searchFromApi(targetSite, query, request.url);
    let result = results.filter((r) => r.title === query);
    
    // 对资源的 episodes 进行预处理（OrionTV 兼容性）
    for (const item of result) {
      if (item.episodes && item.episodes.length > 0) {
        // 判断是官方资源还是非官方资源
        const isOfficial =
          item.source_type === 'official' || targetSite.official_parser;
        
        if (isOfficial) {
          // 官方资源：将 HTML URL 转换为 m3u8 URL
          item.episodes = await convertOfficialEpisodes(
            item.episodes,
            origin
          );
        } else {
          // 非官方资源：将 m3u8 URL 转换为代理 URL（解决 CORS 问题）
          item.episodes = convertUnofficialEpisodes(
            item.episodes,
            origin
          );
        }
        
        // 检测本地资源（优先使用本地资源播放）
        const localPlayUrl = await getLocalResourcePlayUrl(
          item.source,
          item.id,
          0, // 只检测第一个 episode（OrionTV 通常只播放第一个）
          baseUrl
        );
        if (localPlayUrl) {
          // 替换第一个 episode 为本地播放 URL
          item.episodes[0] = localPlayUrl;
        }
      }
    }
    
    if (!config.SiteConfig.DisableYellowFilter) {
      result = result.filter((result) => {
        const typeName = result.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }
    const cacheTime = await getCacheTime();

    if (result.length === 0) {
      return NextResponse.json(
        {
          error: '未找到结果',
          result: null,
        },
        { status: 404 }
      );
    } else {
      return NextResponse.json(
        { results: result },
        {
          headers: {
            'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
            'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
            'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          },
        }
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: '搜索失败',
        result: null,
      },
      { status: 500 }
    );
  }
}
