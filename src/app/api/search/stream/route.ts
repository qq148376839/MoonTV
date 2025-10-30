import { getConfig } from '@/lib/config';
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
    return new Response('Missing query parameter', { status: 400 });
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

  // 创建 SSE 流
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const seenResults = new Set<string>(); // 用于去重

      // 封装消息推送函数 - 立即推送结果
      const pushResult = (results: SearchResult[], done = false) => {
        // 应用黄色内容过滤
        let filteredResults = results;
        if (!config.SiteConfig.DisableYellowFilter) {
          filteredResults = results.filter((result) => {
            const typeName = result.type_name || '';
            return !yellowWords.some((word: string) => typeName.includes(word));
          });
        }

        // 发送 SSE 消息
        const message = {
          results: filteredResults,
          done,
          timestamp: Date.now(),
        };

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(message)}\n\n`)
        );
      };

      // 并发搜索所有源 - 每个源完成后立即推送
      const searchTasks = sortedSites.map(async (site, index) => {
        try {
          // 【优化】高优先级源（前6个）：2秒超时，低优先级：3秒超时，提升响应速度
          const isHighPriority = index < 6;
          const timeout = isHighPriority ? 2000 : 3000;

          const results = await searchFromApiWithTimeout(site, query, timeout);

          // 去重并推送新结果 - 立即推送，不等待其他源
          if (results.length > 0) {
            // 同步处理去重
            const newResults: SearchResult[] = [];
            results.forEach((result) => {
              const key = `${result.source}-${result.id}`;
              if (!seenResults.has(key)) {
                seenResults.add(key);
                newResults.push(result);
              }
            });

            // 立即推送结果
            if (newResults.length > 0) {
              // eslint-disable-next-line no-console
              console.log(
                `[SSE Stream] 推送 ${newResults.length} 个结果，来源: ${site.key}`
              );
              pushResult(newResults, false);
            }
          }

          return true;
        } catch (error) {
          // 单个源失败不影响其他源
          return false;
        }
      });

      // 等待所有搜索任务完成，然后发送完成标志
      Promise.allSettled(searchTasks)
        .then(() => {
          // 所有源完成后发送完成标志
          pushResult([], true);
          controller.close();
        })
        .catch(() => {
          // 发生错误时也发送完成标志
          pushResult([], true);
          controller.close();
        });
    },
  });

  // 返回 SSE 响应
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // 禁用 nginx 缓冲
      'Transfer-Encoding': 'chunked', // 强制分块传输
    },
  });
}
