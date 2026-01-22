import { NextResponse } from 'next/server';

import { getCacheTime, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import {
  searchOfficialResources,
  searchUnofficialResources,
} from '@/lib/search-independent';
import type { SearchResult } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'edge';

function buildOfficialPlayUrl(params: {
  origin: string | undefined;
  q: string;
  source: string;
  id: string;
  epNo: number; // 1-based
  total: number;
  episodeUrl: string; // html
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
  epNo: number; // 1-based
  total: number;
  episodeUrl: string; // m3u8
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

/**
 * 检测本地资源（用于 OrionTV 兼容性）
 * 在 Edge Runtime 中通过 HTTP 调用本地资源检测 API
 */
async function getLocalResourceInfo(
  source: string,
  id: string,
  baseUrl?: string
): Promise<{
  exists: boolean;
  downloadedEpisodes: boolean[];
  episodeM3u8Paths: string[];
} | null> {
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
    if (!data.exists) {
      return null;
    }
    const downloadedEpisodes = Array.isArray(data.downloaded_episodes)
      ? (data.downloaded_episodes as boolean[])
      : [];
    const episodeM3u8Paths = Array.isArray(data.episode_m3u8_paths)
      ? (data.episode_m3u8_paths as string[])
      : [];
    return {
      exists: true,
      downloadedEpisodes,
      episodeM3u8Paths,
    };
  } catch (error) {
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
    // 获取基础 URL（用于调用本地资源检测 API）
    let baseUrl: string | undefined;
    try {
      const urlObj = new URL(request.url);
      baseUrl = `${urlObj.protocol}//${urlObj.host}`;
    } catch {
      baseUrl = undefined;
    }

    // OrionTV 单源搜索：resourceId 应该是“具体资源站 key”（例如 789caiji / jisu），而不是 official/unofficial 分类
    // 做法：并发取官方/非官方独立搜索结果，然后按 source==resourceId 精确过滤。
    const [officialRes, unofficialRes] = await Promise.allSettled([
      searchOfficialResources(query, undefined),
      searchUnofficialResources(query, undefined, {
        exactTitle: query,
        limit: 1,
        source: resourceId,
      }),
    ]);

    const merged: SearchResult[] = [];
    if (officialRes.status === 'fulfilled') merged.push(...officialRes.value);
    if (unofficialRes.status === 'fulfilled') merged.push(...unofficialRes.value);

    let result = merged
      .filter((r) => r && r.title === query && r.source === resourceId)
      .slice(0, 1);

    // 兜底：如果没有命中（比如 source 字段缺失/不一致），再尝试 CMS 站点搜索（若配置存在）
    if (result.length === 0) {
      const apiSites = (config.SourceConfig || []).filter((site) => !site.disabled);
      const targetSiteConfig = apiSites.find((site) => site.key === resourceId);
      if (targetSiteConfig) {
        const targetSite = {
          key: targetSiteConfig.key,
          name: targetSiteConfig.name,
          api: targetSiteConfig.api,
          detail: targetSiteConfig.detail,
          official_parser: targetSiteConfig.official_parser ?? false,
        };
        const cmsResults = await searchFromApi(targetSite, query, request.url);
        result = cmsResults.filter((r) => r.title === query).slice(0, 1);
      }
    }
    
    // 对资源的 episodes 进行预处理（OrionTV 兼容性）
    for (const item of result) {
      if (item.episodes && item.episodes.length > 0) {
        const totalEpisodes = item.episodes.length;

        // 先检测本地资源（只在 search 阶段做“已完整下载才切本地”；不完整则在线）
        const localInfo = await getLocalResourceInfo(item.source, item.id, baseUrl);

        // 判断是官方资源还是非官方资源
        const isOfficial =
          item.source_type === 'official' || resourceId === 'official';
        
        if (isOfficial) {
          // 官方资源：episodes 全量改写为 official-play.m3u8（播放时按需解析 + 触发下载）
          item.episodes = item.episodes.map((ep: string, idx: number) =>
            buildOfficialPlayUrl({
              origin,
              q: query,
              source: item.source,
              id: item.id,
              epNo: idx + 1,
              total: totalEpisodes,
              episodeUrl: ep,
            })
          );
        } else {
          // 非官方资源：episodes 全量改写为 unofficial-play.m3u8（播放时走代理 + 触发下载）
          item.episodes = item.episodes.map((ep: string, idx: number) =>
            buildUnofficialPlayUrl({
              origin,
              q: query,
              source: item.source,
              id: item.id,
              epNo: idx + 1,
              total: totalEpisodes,
              episodeUrl: ep,
            })
          );
        }

        // 已完整下载：将对应集替换为本地 m3u8（不完整则保持在线）
        if (localInfo?.exists) {
          const downloaded = localInfo.downloadedEpisodes || [];
          const paths = localInfo.episodeM3u8Paths || [];
          for (let i = 0; i < item.episodes.length; i++) {
            const ok = downloaded[i] === true;
            const p = typeof paths[i] === 'string' ? paths[i].trim() : '';
            if (!ok || !p) continue;
            const prefix = origin ? `${origin}` : '';
            item.episodes[i] = `${prefix}/api/local-video?path=${encodeURIComponent(p)}`;
          }
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

    // OrionTV 兼容：即使没结果也返回 200 + 空数组，避免客户端把 404 当作“源不可用”
    return NextResponse.json(
      { results: result },
      {
        status: 200,
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        },
      }
    );
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
