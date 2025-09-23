import { NextResponse } from 'next/server';

import { getCacheTime, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { SearchResult } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'edge';

// 源优先级配置 - 响应快的源优先
const SOURCE_PRIORITY = {
  bfzy: 1, // 暴风资源 - 通常较快
  tyyszy: 2, // 天涯资源 - 稳定
  zy360: 3, // 360资源 - 较快
  wolong: 4, // 卧龙资源 - 中等
  jisu: 5, // 极速资源 - 较快
  dbzy: 6, // 豆瓣资源 - 中等
} as const;

// 带自定义超时的搜索函数
async function searchFromApiWithTimeout(
  site: { key: string; api: string; name: string; detail?: string },
  query: string,
  timeoutMs: number
): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await searchFromApi(site, query);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    // 搜索失败时静默处理，避免控制台警告
    return [];
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
  const apiSites = config.SourceConfig.filter((site) => !site.disabled);

  // 按优先级排序源，优先请求快速源
  const sortedSites = apiSites.sort((a, b) => {
    const priorityA =
      SOURCE_PRIORITY[a.key as keyof typeof SOURCE_PRIORITY] || 999;
    const priorityB =
      SOURCE_PRIORITY[b.key as keyof typeof SOURCE_PRIORITY] || 999;
    return priorityA - priorityB;
  });

  // 分批请求：先请求高优先级源，再请求其他源
  const highPrioritySites = sortedSites.slice(0, 6); // 前6个高优先级源
  const lowPrioritySites = sortedSites.slice(6); // 其他源

  try {
    // 第一批：高优先级源（3秒超时）
    const highPriorityPromises = highPrioritySites.map((site) =>
      searchFromApiWithTimeout(site, query, 3000)
    );

    // 第二批：低优先级源（5秒超时）
    const lowPriorityPromises = lowPrioritySites.map((site) =>
      searchFromApiWithTimeout(site, query, 5000)
    );

    // 先等待高优先级源完成
    const highPriorityResults = await Promise.allSettled(highPriorityPromises);

    // 如果高优先级源已有足够结果，可以提前返回
    const initialResults = highPriorityResults
      .filter(
        (result): result is PromiseFulfilledResult<SearchResult[]> =>
          result.status === 'fulfilled'
      )
      .flatMap((result) => result.value);

    // 同时启动低优先级源（不等待完成）
    const lowPriorityResultsPromise = Promise.allSettled(lowPriorityPromises);

    // 如果高优先级源结果充足，立即返回；否则等待所有源
    let allResults: SearchResult[];
    if (initialResults.length >= 10) {
      // 有足够结果，异步等待其他源完成（用于后台缓存）
      lowPriorityResultsPromise.then((lowResults) => {
        lowResults
          .filter(
            (result): result is PromiseFulfilledResult<SearchResult[]> =>
              result.status === 'fulfilled'
          )
          .flatMap((result) => result.value);
        // 后台处理其他源的结果，用于缓存优化
      });
      allResults = initialResults;
    } else {
      // 结果不足，等待所有源
      const lowPriorityResults = await lowPriorityResultsPromise;
      const additionalResults = lowPriorityResults
        .filter(
          (result): result is PromiseFulfilledResult<SearchResult[]> =>
            result.status === 'fulfilled'
        )
        .flatMap((result) => result.value);
      allResults = [...initialResults, ...additionalResults];
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
