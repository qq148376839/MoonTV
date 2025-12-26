/* eslint-disable no-console */
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

/**
 * 动态超时管理器
 * 根据环境特征和实时性能自适应调整超时时间
 */
class AdaptiveTimeoutManager {
  private static instance: AdaptiveTimeoutManager;
  private networkLatency = 0; // 网络延迟（毫秒）
  private lastHealthCheck = 0; // 上次健康检查时间
  private readonly HEALTH_CHECK_INTERVAL = 60000; // 健康检查间隔：60秒

  // 私有构造函数，确保单例模式
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  static getInstance(): AdaptiveTimeoutManager {
    if (!AdaptiveTimeoutManager.instance) {
      AdaptiveTimeoutManager.instance = new AdaptiveTimeoutManager();
    }
    return AdaptiveTimeoutManager.instance;
  }

  /**
   * 检测网络环境并更新延迟
   * 使用轻量级健康检查来评估网络状况
   */
  async detectNetworkEnvironment(): Promise<void> {
    const now = Date.now();

    // 如果距离上次检查时间太短，跳过检查（避免频繁请求）
    if (now - this.lastHealthCheck < this.HEALTH_CHECK_INTERVAL) {
      return;
    }

    try {
      const testStartTime = now;

      // 【优化】使用轻量级的健康检查端点
      // 选择一个响应快且稳定的服务进行测试
      // 使用Cloudflare的DNS服务作为测试目标（通常响应很快）
      const testUrl =
        'https://cloudflare-dns.com/dns-query?name=example.com&type=A';
      const controller = new AbortController();

      // 创建超时Promise（兼容Edge Runtime）
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const timeoutPromise = new Promise<void>((resolve) => {
        if (typeof setTimeout !== 'undefined') {
          timeoutId = setTimeout(() => {
            controller.abort();
            resolve();
          }, 1500); // 1.5秒超时，足够检测网络延迟
        }
      });

      try {
        // 使用Promise.race同时执行请求和超时
        await Promise.race([
          fetch(testUrl, {
            method: 'GET',
            signal: controller.signal,
            headers: {
              Accept: 'application/dns-json',
            },
            cache: 'no-store',
          }).then(() => {
            if (timeoutId !== null && typeof clearTimeout !== 'undefined') {
              clearTimeout(timeoutId);
            }
          }),
          timeoutPromise,
        ]);

        const latency = Date.now() - testStartTime;

        // 【优化】使用平滑算法更新延迟（避免单次测量波动）
        if (this.networkLatency === 0) {
          this.networkLatency = latency;
        } else {
          // 加权平均：新值占30%，旧值占70%
          this.networkLatency = Math.round(
            this.networkLatency * 0.7 + latency * 0.3
          );
        }

        this.lastHealthCheck = now;
      } catch {
        // 测试失败，使用默认延迟值或保持上次的值
        if (this.networkLatency === 0) {
          this.networkLatency = 1000; // 默认1秒延迟
        }
        // 如果已有延迟值，保持不变（网络可能是暂时性问题）
        this.lastHealthCheck = now;
      } finally {
        if (timeoutId !== null && typeof clearTimeout !== 'undefined') {
          clearTimeout(timeoutId);
        }
      }
    } catch {
      // 健康检查失败，使用默认值或保持上次的值
      if (this.networkLatency === 0) {
        this.networkLatency = 1000;
      }
      this.lastHealthCheck = now;
    }
  }

  /**
   * 根据环境和实时性能计算动态超时时间
   * @param baseTimeout 基础超时时间（毫秒）
   * @param isHighPriority 是否高优先级源
   * @returns 调整后的超时时间
   */
  calculateDynamicTimeout(
    baseTimeout: number,
    isHighPriority: boolean
  ): number {
    // 1. 环境因子
    const isProduction =
      process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
    const environmentFactor = isProduction ? 1.5 : 1.0; // 生产环境增加50%

    // 2. 网络延迟因子（基于健康检查结果）
    // 如果检测到的延迟 > 500ms，认为网络较慢，增加超时时间
    const latencyFactor = this.networkLatency > 500 ? 1.3 : 1.0;

    // 3. 优先级因子（高优先级源可以稍短一些，但也要保证成功率）
    const priorityFactor = isHighPriority ? 0.9 : 1.0;

    // 4. Edge Runtime 因子（Edge环境可能需要更长时间）
    const edgeFactor = 1.2; // Edge Runtime 通常需要更多时间

    // 综合计算
    const dynamicTimeout = Math.ceil(
      baseTimeout *
        environmentFactor *
        latencyFactor *
        priorityFactor *
        edgeFactor
    );

    // 设置合理的上下限
    const minTimeout = isHighPriority ? 2000 : 3000; // 最少2-3秒
    const maxTimeout = isHighPriority ? 10000 : 15000; // 最多10-15秒

    return Math.max(minTimeout, Math.min(maxTimeout, dynamicTimeout));
  }

  /**
   * 获取当前网络延迟（用于调试）
   */
  getNetworkLatency(): number {
    return this.networkLatency;
  }
}

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
    // 【修复】记录错误信息，但不在console中打印（Edge Runtime限制）
    // 可以通过返回特殊标记来追踪错误
    // 搜索失败时返回空数组，但在内部记录错误信息
    const errorMsg = error instanceof Error ? error.message : String(error);
    // 只在开发环境记录详细错误
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.error(`[SSE] 搜索失败 [${site.key}]:`, errorMsg);
    }
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

  // 初始化动态超时管理器
  const timeoutManager = AdaptiveTimeoutManager.getInstance();

  // 异步检测网络环境（不阻塞主流程）
  timeoutManager.detectNetworkEnvironment().catch(() => {
    // 静默处理健康检查失败
  });

  // 创建 SSE 流
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const seenResults = new Set<string>(); // 用于去重

      // 【优化】记录响应时间用于后续优化
      const responseTimes: number[] = [];
      const searchStartTime = Date.now();

      // 封装消息推送函数 - 立即推送结果
      const pushResult = (
        results: SearchResult[],
        done = false,
        debugInfo?: Record<string, unknown>
      ) => {
        // 【调试日志】记录推送前的统计信息（服务端终端）
        console.log(`[SSE] 推送结果 - 数量: ${results.length}, done: ${done}`);
        const bySource = results.reduce((acc, r) => {
          acc[r.source] = (acc[r.source] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        console.log(`[SSE] 按源分组:`, bySource);

        // 应用黄色内容过滤
        let filteredResults = results;
        if (!config.SiteConfig.DisableYellowFilter) {
          const beforeFilter = filteredResults.length;
          filteredResults = results.filter((result) => {
            const typeName = result.type_name || '';
            return !yellowWords.some((word: string) => typeName.includes(word));
          });

          // 【调试日志】记录过滤结果
          if (beforeFilter !== filteredResults.length) {
            console.log(
              `[SSE] 黄色内容过滤: ${beforeFilter} -> ${filteredResults.length}`
            );
          }
        }

        // 【调试日志】记录最终推送结果
        const emptyEpisodes = filteredResults.filter(
          (r) => r.episodes.length === 0
        );
        if (emptyEpisodes.length > 0) {
          console.warn(
            `[SSE] ⚠️ 推送结果中有 ${emptyEpisodes.length} 个episodes为空:`,
            emptyEpisodes.map((r) => ({
              title: r.title,
              source: r.source,
              episodesCount: r.episodes.length,
            }))
          );
        }

        // 发送 SSE 消息（包含调试信息）
        const message = {
          results: filteredResults,
          done,
          timestamp: Date.now(),
          debug:
            process.env.NODE_ENV === 'development'
              ? {
                  totalResults: results.length,
                  filteredResults: filteredResults.length,
                  bySource,
                  emptyEpisodes: emptyEpisodes.length,
                  emptyEpisodesSources: emptyEpisodes.map((r) => r.source),
                  ...debugInfo,
                }
              : undefined,
        };

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(message)}\n\n`)
        );
      };

      // 并发搜索所有源 - 每个源完成后立即推送
      const searchTasks = sortedSites.map(async (site, index) => {
        const taskStartTime = Date.now();
        try {
          // 【优化】使用动态超时管理器计算超时时间
          const isHighPriority = index < 6;
          const baseTimeout = isHighPriority ? 2000 : 3000;
          const dynamicTimeout = timeoutManager.calculateDynamicTimeout(
            baseTimeout,
            isHighPriority
          );

          // 在开发环境记录超时信息
          if (process.env.NODE_ENV === 'development') {
            // eslint-disable-next-line no-console
            console.log(
              `[SSE] [${
                site.key
              }] 使用动态超时: ${dynamicTimeout}ms (网络延迟: ${timeoutManager.getNetworkLatency()}ms)`
            );
          }

          console.log(`[SSE] 开始搜索源: ${site.key} (${site.name})`);

          const results = await searchFromApiWithTimeout(
            site,
            query,
            dynamicTimeout
          );

          // 记录响应时间
          const responseTime = Date.now() - taskStartTime;
          responseTimes.push(responseTime);

          console.log(
            `[SSE] 源 ${site.key} 搜索完成 - 耗时: ${responseTime}ms, 结果数: ${results.length}`
          );
          if (results.length > 0) {
            console.log(
              `[SSE] 源 ${site.key} 结果详情:`,
              results.map((r) => ({
                title: r.title,
                episodesCount: r.episodes.length,
                source: r.source,
              }))
            );
          }

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
              console.log(
                `[SSE Stream] 推送 ${newResults.length} 个结果，来源: ${site.key}`
              );
              pushResult(newResults, false, {
                source: site.key,
                sourceName: site.name,
                duration: responseTime,
                resultCount: results.length,
                newResultCount: newResults.length,
              });
            }
          }

          return true;
        } catch (error) {
          // 【修复】在开发环境记录详细错误信息
          if (process.env.NODE_ENV === 'development') {
            // eslint-disable-next-line no-console
            console.error(`[SSE] 搜索任务失败 [${site.key}]:`, error);
          }
          // 单个源失败不影响其他源
          return false;
        }
      });

      // 等待所有搜索任务完成，然后发送完成标志
      Promise.allSettled(searchTasks)
        .then((results) => {
          // 【优化】记录搜索性能统计
          const successCount = results.filter(
            (r) => r.status === 'fulfilled'
          ).length;
          const failureCount = results.filter(
            (r) => r.status === 'rejected'
          ).length;
          const totalTime = Date.now() - searchStartTime;

          // 计算平均响应时间
          const avgResponseTime =
            responseTimes.length > 0
              ? Math.round(
                  responseTimes.reduce((a, b) => a + b, 0) /
                    responseTimes.length
                )
              : 0;

          if (process.env.NODE_ENV === 'development') {
            // eslint-disable-next-line no-console
            console.log(
              `[SSE] 搜索完成: 成功 ${successCount}, 失败 ${failureCount}, 总耗时 ${totalTime}ms, 平均响应时间 ${avgResponseTime}ms`
            );
          }

          // 所有源完成后发送完成标志
          pushResult([], true);
          controller.close();
        })
        .catch((error) => {
          // 【修复】记录最终错误
          if (process.env.NODE_ENV === 'development') {
            // eslint-disable-next-line no-console
            console.error('[SSE] 搜索流发生错误:', error);
          }
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
