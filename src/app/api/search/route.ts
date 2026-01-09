import { NextResponse } from 'next/server';

import { getCacheTime, getConfig } from '@/lib/config';
import {
  searchOfficialResources,
  searchUnofficialResources,
} from '@/lib/search-independent';
import { SearchResult } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'edge';

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

  try {
    // 并发搜索官方和非官方资源
    const [officialResults, unofficialResults] = await Promise.allSettled([
      searchOfficialResources(query, undefined),
      searchUnofficialResources(query, undefined),
    ]);

    // 合并结果
    const allResults: SearchResult[] = [];
    const seenResults = new Set<string>(); // 用于去重

    // 处理官方资源搜索结果
    if (officialResults.status === 'fulfilled') {
      officialResults.value.forEach((result) => {
        const key = `${result.source_type || 'official'}-${result.id}`;
        if (!seenResults.has(key)) {
          seenResults.add(key);
          allResults.push(result);
        }
      });
    }

    // 处理非官方资源搜索结果
    if (unofficialResults.status === 'fulfilled') {
      unofficialResults.value.forEach((result) => {
        const key = `${result.source_type || 'unofficial'}-${result.id}`;
        if (!seenResults.has(key)) {
          seenResults.add(key);
          allResults.push(result);
        }
      });
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
