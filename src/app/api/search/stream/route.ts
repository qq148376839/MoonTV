/* eslint-disable no-console */
import { getConfig } from '@/lib/config';
import {
  searchOfficialResources,
  searchUnofficialResources,
} from '@/lib/search-independent';
import { SearchResult } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs'; // 需要使用 config.ts，改为 Node.js runtime

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return new Response('Missing query parameter', { status: 400 });
  }

  // 【优化】如果配置了 Cloudflare Worker URL，直接转发流式数据
  const cfWorkerUrl = process.env.NEXT_PUBLIC_CF_SEARCH_WORKER_URL;
  if (cfWorkerUrl && cfWorkerUrl.trim()) {
    const workerUrl = `${cfWorkerUrl.replace(/\/$/, '')}?q=${encodeURIComponent(
      query
    )}`;
    console.log('[SSE] 使用 Cloudflare Worker，转发流式数据:', workerUrl);

    try {
      const workerResponse = await fetch(workerUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'text/event-stream',
        },
      });

      if (!workerResponse.ok) {
        throw new Error(`Worker returned ${workerResponse.status}`);
      }

      // 直接转发 Worker 的流式响应
      return new Response(workerResponse.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
          'Transfer-Encoding': 'chunked',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error) {
      console.error('[SSE] Worker 转发失败，回退到本地搜索:', error);
      // 如果 Worker 失败，继续使用本地搜索逻辑
    }
  }

  const config = await getConfig();

  // 创建 SSE 流
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const seenResults = new Set<string>(); // 用于去重
      let isClosed = false; // 跟踪流是否已关闭

      const searchStartTime = Date.now();

      // 封装消息推送函数 - 立即推送结果
      const pushResult = (
        results: SearchResult[],
        done = false,
        debugInfo?: Record<string, unknown>
      ) => {
        // 如果流已关闭，直接返回
        if (isClosed) {
          return;
        }
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
          // 【修复】将 source 和 source_name 放在顶层，方便前端解析
          source: debugInfo?.source,
          source_name: debugInfo?.sourceName,
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

        // 使用 try-catch 捕获 Controller 已关闭的错误
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(message)}\n\n`)
          );
        } catch (error) {
          // Controller 已关闭（客户端断开连接等）
          if (
            error instanceof Error &&
            (error.message.includes('closed') ||
              error.message.includes('Invalid state'))
          ) {
            isClosed = true;
            if (process.env.NODE_ENV === 'development') {
              console.warn('[SSE] Controller 已关闭，停止推送数据');
            }
          } else {
            // 其他错误，重新抛出
            throw error;
          }
        }
      };

      // 并发搜索官方和非官方资源 - 每个搜索完成后立即推送
      // 注意：不再使用 config.json 中的搜索源，仅使用环境变量配置的官方和非官方资源搜索接口
      console.log('[SSE] 开始创建官方资源搜索任务');
      const officialSearchTask = (async () => {
        try {
          console.log('[SSE] 官方资源搜索任务开始执行');

          // 【优化】如果配置了官方资源搜索URL，直接流式处理SSE响应
          const officialSearchUrl =
            process.env.NEXT_PUBLIC_OFFICIAL_SEARCH_URL ||
            'https://789jx.riowang.win';

          const apiUrl = `${officialSearchUrl}/?q=${encodeURIComponent(query)}`;
          console.log(`[SSE] 官方资源搜索URL: ${apiUrl}`);

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒超时

          try {
            const response = await fetch(apiUrl, {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                Accept: 'application/json, text/event-stream',
              },
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              throw new Error(`官方资源搜索返回错误状态: ${response.status}`);
            }

            const contentType = response.headers.get('content-type') || '';

            // 如果是SSE格式，流式处理
            if (contentType.includes('text/event-stream') || response.body) {
              console.log('[SSE] 检测到SSE格式，开始流式处理');

              const reader = response.body?.getReader();
              const decoder = new TextDecoder();
              let buffer = '';

              if (!reader) {
                throw new Error('无法获取响应流');
              }

              // eslint-disable-next-line no-constant-condition
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // 保留最后不完整的行

                for (const line of lines) {
                  const trimmedLine = line.trim();
                  if (trimmedLine.startsWith('data:')) {
                    try {
                      const jsonStr = trimmedLine.substring(5).trim();
                      const sseData = JSON.parse(jsonStr);

                      // 处理结果
                      if (
                        sseData.results &&
                        Array.isArray(sseData.results) &&
                        sseData.results.length > 0
                      ) {
                        const newResults: SearchResult[] = [];
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        sseData.results.forEach((item: any) => {
                          if (item.episodes && Array.isArray(item.episodes)) {
                            const key = `${item.source_type || 'official'}-${
                              item.id
                            }`;
                            if (!seenResults.has(key)) {
                              seenResults.add(key);
                              newResults.push({
                                id: item.id || item.vod_id?.toString() || '',
                                title: item.title || item.vod_name || '',
                                poster: item.poster || item.vod_pic || '',
                                episodes: item.episodes,
                                source: item.source || 'official',
                                source_name: item.source_name || '官方资源',
                                class: item.class || item.vod_class || '',
                                year:
                                  item.year ||
                                  item.vod_year?.match(/\d{4}/)?.[0] ||
                                  'unknown',
                                desc: item.desc || item.vod_content || '',
                                type_name: item.type_name,
                                douban_id: item.douban_id || item.vod_douban_id,
                                source_type: 'official',
                              });
                            }
                          }
                        });

                        if (newResults.length > 0) {
                          console.log(
                            `[SSE Stream] 流式推送 ${newResults.length} 个官方资源结果`
                          );
                          pushResult(newResults, false, {
                            source: 'official',
                            sourceName: '官方资源',
                            newResultCount: newResults.length,
                          });
                        }
                      }

                      // 如果done为true，停止处理
                      if (sseData.done === true) {
                        break;
                      }
                    } catch (e) {
                      // 忽略解析错误，继续处理下一行
                      console.warn(
                        '[SSE] SSE行解析失败:',
                        trimmedLine.substring(0, 100)
                      );
                    }
                  }
                }
              }

              console.log('[SSE] 官方资源搜索流式处理完成');
              return true;
            } else {
              // 如果不是SSE格式，回退到原来的方法
              console.log('[SSE] 非SSE格式，使用原有方法');
              const officialResults = await searchOfficialResources(
                query,
                undefined
              );
              console.log(
                `[SSE] 官方资源搜索完成，结果数: ${officialResults.length}`
              );
              if (officialResults.length > 0) {
                const newResults: SearchResult[] = [];
                officialResults.forEach((result) => {
                  const key = `${result.source_type}-${result.id}`;
                  if (!seenResults.has(key)) {
                    seenResults.add(key);
                    newResults.push(result);
                  }
                });

                if (newResults.length > 0) {
                  console.log(
                    `[SSE Stream] 推送 ${newResults.length} 个官方资源结果`
                  );
                  pushResult(newResults, false, {
                    source: 'official',
                    sourceName: '官方资源',
                    resultCount: officialResults.length,
                    newResultCount: newResults.length,
                  });
                }
              }
              return true;
            }
          } catch (fetchError) {
            clearTimeout(timeoutId);
            throw fetchError;
          }
        } catch (error) {
          console.error('[SSE] 官方资源搜索失败:', error);
          if (error instanceof Error) {
            console.error('[SSE] 官方资源搜索错误详情:', {
              message: error.message,
              stack: error.stack,
              name: error.name,
            });
          }
          return false;
        }
      })();
      console.log('[SSE] 官方资源搜索任务已创建');

      console.log('[SSE] 开始创建非官方资源搜索任务');
      const unofficialSearchTask = (async () => {
        try {
          console.log('[SSE] 非官方资源搜索任务开始执行');

          // 【优化】如果配置了非官方资源搜索URL，直接流式处理SSE响应
          const unofficialSearchUrl =
            process.env.NEXT_PUBLIC_UNOFFICIAL_SEARCH_URL ||
            process.env.NEXT_PUBLIC_CF_SEARCH_WORKER_URL ||
            'https://ss.riowang.win';

          const apiUrl = `${unofficialSearchUrl}/?q=${encodeURIComponent(
            query
          )}`;
          console.log(`[SSE] 非官方资源搜索URL: ${apiUrl}`);

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒超时

          try {
            const response = await fetch(apiUrl, {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                Accept: 'application/json, text/event-stream',
              },
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              throw new Error(`非官方资源搜索返回错误状态: ${response.status}`);
            }

            const contentType = response.headers.get('content-type') || '';

            // 如果是SSE格式，流式处理
            if (contentType.includes('text/event-stream') || response.body) {
              console.log('[SSE] 检测到SSE格式，开始流式处理');

              const reader = response.body?.getReader();
              const decoder = new TextDecoder();
              let buffer = '';

              if (!reader) {
                throw new Error('无法获取响应流');
              }

              // eslint-disable-next-line no-constant-condition
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // 保留最后不完整的行

                for (const line of lines) {
                  const trimmedLine = line.trim();
                  if (trimmedLine.startsWith('data:')) {
                    try {
                      const jsonStr = trimmedLine.substring(5).trim();
                      const sseData = JSON.parse(jsonStr);

                      // 处理结果
                      if (
                        sseData.results &&
                        Array.isArray(sseData.results) &&
                        sseData.results.length > 0
                      ) {
                        const newResults: SearchResult[] = [];
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        sseData.results.forEach((item: any) => {
                          if (item.episodes && Array.isArray(item.episodes)) {
                            const key = `${item.source_type || 'unofficial'}-${
                              item.id
                            }`;
                            if (!seenResults.has(key)) {
                              seenResults.add(key);
                              newResults.push({
                                id: item.id || item.vod_id?.toString() || '',
                                title: item.title || item.vod_name || '',
                                poster: item.poster || item.vod_pic || '',
                                episodes: item.episodes,
                                source: item.source || 'unofficial',
                                source_name: item.source_name || '非官方资源',
                                class: item.class || item.vod_class || '',
                                year:
                                  item.year ||
                                  item.vod_year?.match(/\d{4}/)?.[0] ||
                                  'unknown',
                                desc: item.desc || item.vod_content || '',
                                type_name: item.type_name,
                                douban_id: item.douban_id || item.vod_douban_id,
                                source_type: 'unofficial',
                              });
                            }
                          }
                        });

                        if (newResults.length > 0) {
                          console.log(
                            `[SSE Stream] 流式推送 ${newResults.length} 个非官方资源结果`
                          );
                          pushResult(newResults, false, {
                            source: 'unofficial',
                            sourceName: '非官方资源',
                            newResultCount: newResults.length,
                          });
                        }
                      }

                      // 如果done为true，停止处理
                      if (sseData.done === true) {
                        break;
                      }
                    } catch (e) {
                      // 忽略解析错误，继续处理下一行
                      console.warn(
                        '[SSE] SSE行解析失败:',
                        trimmedLine.substring(0, 100)
                      );
                    }
                  }
                }
              }

              console.log('[SSE] 非官方资源搜索流式处理完成');
              return true;
            } else {
              // 如果不是SSE格式，回退到原来的方法
              console.log('[SSE] 非SSE格式，使用原有方法');
              const unofficialResults = await searchUnofficialResources(
                query,
                undefined
              );
              console.log(
                `[SSE] 非官方资源搜索完成，结果数: ${unofficialResults.length}`
              );
              if (unofficialResults.length > 0) {
                const newResults: SearchResult[] = [];
                unofficialResults.forEach((result) => {
                  const key = `${result.source_type}-${result.id}`;
                  if (!seenResults.has(key)) {
                    seenResults.add(key);
                    newResults.push(result);
                  }
                });

                if (newResults.length > 0) {
                  console.log(
                    `[SSE Stream] 推送 ${newResults.length} 个非官方资源结果`
                  );
                  pushResult(newResults, false, {
                    source: 'unofficial',
                    sourceName: '非官方资源',
                    resultCount: unofficialResults.length,
                    newResultCount: newResults.length,
                  });
                }
              }
              return true;
            }
          } catch (fetchError) {
            clearTimeout(timeoutId);
            throw fetchError;
          }
        } catch (error) {
          if (process.env.NODE_ENV === 'development') {
            console.error('[SSE] 非官方资源搜索失败:', error);
          }
          return false;
        }
      })();

      // 等待所有搜索任务完成（仅官方和非官方资源搜索），然后发送完成标志
      console.log('[SSE] 开始等待所有搜索任务完成');
      Promise.allSettled([officialSearchTask, unofficialSearchTask])
        .then((results) => {
          // 【优化】记录搜索性能统计
          console.log('[SSE] 所有搜索任务完成，结果统计:', {
            total: results.length,
            officialTaskStatus: results[0]?.status,
            unofficialTaskStatus: results[1]?.status,
          });
          const successCount = results.filter(
            (r) => r.status === 'fulfilled'
          ).length;
          const failureCount = results.filter(
            (r) => r.status === 'rejected'
          ).length;
          const totalTime = Date.now() - searchStartTime;

          if (process.env.NODE_ENV === 'development') {
            // eslint-disable-next-line no-console
            console.log(
              `[SSE] 搜索完成: 成功 ${successCount}, 失败 ${failureCount}, 总耗时 ${totalTime}ms`
            );
          }

          // 所有源完成后发送完成标志
          if (!isClosed) {
            pushResult([], true);
            try {
              controller.close();
              isClosed = true;
            } catch (error) {
              // Controller 可能已经关闭
              isClosed = true;
            }
          }
        })
        .catch((error) => {
          // 【修复】记录最终错误
          if (process.env.NODE_ENV === 'development') {
            // eslint-disable-next-line no-console
            console.error('[SSE] 搜索流发生错误:', error);
          }
          // 发生错误时也发送完成标志
          if (!isClosed) {
            pushResult([], true);
            try {
              controller.close();
              isClosed = true;
            } catch (closeError) {
              // Controller 可能已经关闭
              isClosed = true;
            }
          }
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
