/* eslint-disable no-console */
import { SearchResult } from '@/lib/types';
import { cleanHtmlTags } from '@/lib/utils';

interface ApiSearchItem {
  vod_id: string;
  vod_name: string;
  vod_pic: string;
  vod_remarks?: string;
  vod_play_url?: string;
  vod_class?: string;
  vod_year?: string;
  vod_content?: string;
  vod_douban_id?: number;
  type_name?: string;
}

interface ApiSearchResponse {
  code: number;
  msg: string;
  page?: number;
  pagecount?: number;
  limit?: number;
  total?: number;
  list?: ApiSearchItem[];
}

/**
 * 从官方资源搜索接口获取搜索结果
 * @param query 搜索关键词
 * @param baseUrl 搜索接口基础URL（默认从环境变量获取）
 * @returns 搜索结果数组
 */
export async function searchOfficialResources(
  query: string,
  baseUrl?: string
): Promise<SearchResult[]> {
  // OrionTV 兼容：官方独立搜索接口（789）返回的 source 字段可能缺失/不稳定。
  // 为了保证 /api/search/resources 返回的 key（789caiji）与 SearchResult.source 一致，这里统一固化。
  const OFFICIAL_SOURCE_KEY = '789caiji';
  const OFFICIAL_SOURCE_NAME = '789采集';

  const officialSearchUrl =
    baseUrl ||
    process.env.NEXT_PUBLIC_OFFICIAL_SEARCH_URL ||
    'https://789jx.riowang.win';

  const apiUrl = `${officialSearchUrl}/?q=${encodeURIComponent(query)}`;

  console.log(`[searchOfficialResources] 请求URL: ${apiUrl}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时

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
      console.warn(
        `[searchOfficialResources] 接口返回错误状态: ${response.status}`
      );
      return [];
    }

    // 检查响应类型，可能是 SSE 格式或 JSON 格式
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    let data: ApiSearchResponse;

    // 如果是 SSE 格式（text/event-stream 或以 "data: " 开头）
    if (
      contentType.includes('text/event-stream') ||
      text.trim().startsWith('data:')
    ) {
      console.log(`[searchOfficialResources] 检测到 SSE 格式响应`);
      // 解析 SSE 格式：提取所有 data: 行的 JSON
      const lines = text.split('\n');
      const allSearchResults: SearchResult[] = [];
      const allApiItems: ApiSearchItem[] = [];
      let hasSearchResultFormat = false;

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('data:')) {
          try {
            const jsonStr = trimmedLine.substring(5).trim(); // 去掉 "data: " 前缀
            const sseData = JSON.parse(jsonStr);

            // SSE 格式可能包含 results 数组
            if (sseData.results && Array.isArray(sseData.results)) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              sseData.results.forEach((item: any) => {
                // 检查是否是 SearchResult 格式（有 episodes 数组）
                if (item.episodes && Array.isArray(item.episodes)) {
                  hasSearchResultFormat = true;
                  // 已经是 SearchResult 格式，直接使用
                  allSearchResults.push({
                    id: item.id || item.vod_id?.toString() || '',
                    title: item.title || item.vod_name || '',
                    poster: item.poster || item.vod_pic || '',
                    episodes: item.episodes,
                    source: OFFICIAL_SOURCE_KEY,
                    source_name: OFFICIAL_SOURCE_NAME,
                    class: item.class || item.vod_class || '',
                    year: item.year || item.vod_year?.match(/\d{4}/)?.[0] || 'unknown',
                    desc: cleanHtmlTags(item.desc || item.vod_content || ''),
                    type_name: item.type_name,
                    douban_id: item.douban_id || item.vod_douban_id,
                    source_type: 'official',
                  });
                } else if (item.vod_id || item.id) {
                  // 是 ApiSearchItem 格式，需要转换
                  allApiItems.push({
                    vod_id: item.vod_id || item.id,
                    vod_name: item.vod_name || item.title,
                    vod_pic: item.vod_pic || item.poster,
                    vod_play_url: item.vod_play_url,
                    vod_class: item.vod_class || item.class,
                    vod_year: item.vod_year || item.year,
                    vod_content: item.vod_content || item.desc,
                    vod_douban_id: item.vod_douban_id || item.douban_id,
                    type_name: item.type_name,
                  });
                }
              });
            } else if (sseData.list && Array.isArray(sseData.list)) {
              // 如果是标准的 API 响应格式
              allApiItems.push(...sseData.list);
            }

            // 如果 done 为 true，停止解析
            if (sseData.done === true) {
              break;
            }
          } catch (e) {
            // 忽略解析错误，继续处理下一行
            console.warn(
              `[searchOfficialResources] SSE 行解析失败:`,
              trimmedLine.substring(0, 100)
            );
          }
        }
      }

      // 如果已经是 SearchResult 格式，直接返回
      if (hasSearchResultFormat && allSearchResults.length > 0) {
        console.log(
          `[searchOfficialResources] SSE 返回 SearchResult 格式，结果数: ${allSearchResults.length}`
        );
        return allSearchResults;
      }

      // 如果解析到了 ApiSearchItem 格式的数据，构造标准格式的响应
      if (allApiItems.length > 0) {
        console.log(
          `[searchOfficialResources] SSE 解析到 ApiSearchItem 格式，结果数: ${allApiItems.length}`
        );
        data = {
          code: 1,
          msg: '数据列表',
          list: allApiItems,
        };
      } else {
        // 如果两种格式都没有解析到数据，记录详细日志
        console.warn(
          `[searchOfficialResources] SSE 解析后数据为空`,
          {
            textLength: text.length,
            linesCount: lines.length,
            hasSearchResultFormat,
            allSearchResultsLength: allSearchResults.length,
            allApiItemsLength: allApiItems.length,
            firstFewLines: lines.slice(0, 5),
          }
        );
        return [];
      }
    } else {
      // 标准 JSON 格式
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        console.error(
          `[searchOfficialResources] JSON 解析失败:`,
          parseError,
          `响应前100字符:`,
          text.substring(0, 100)
        );
        return [];
      }
    }

    if (
      !data ||
      !data.list ||
      !Array.isArray(data.list) ||
      data.list.length === 0
    ) {
      console.log(`[searchOfficialResources] 数据为空或无效`);
      return [];
    }

    // 处理搜索结果
    const results: SearchResult[] = data.list.map((item: ApiSearchItem) => {
      let episodes: string[] = [];

      if (item.vod_play_url) {
        // 官方资源：提取所有第三方视频网站URL（非m3u8格式）
        // 格式：播放源1$$$播放源2$$$播放源3
        // 每个播放源格式：剧集名$URL 或 剧集名$URL#剧集名$URL（多个剧集用#分隔）
        const playSources = item.vod_play_url.split('$$$');

        const allEpisodes: string[] = [];

        playSources.forEach((source: string) => {
          if (!source || !source.trim()) {
            return;
          }

          // 每个播放源可能有多个剧集（用#分隔）
          const episodeList = source.split('#');

          episodeList.forEach((ep: string) => {
            if (!ep || !ep.trim()) {
              return;
            }

            // 每个剧集格式：剧集名$URL
            const parts = ep.split('$');
            if (parts.length >= 2) {
              const url = parts[1]?.trim();
              if (
                url &&
                (url.startsWith('http://') || url.startsWith('https://'))
              ) {
                allEpisodes.push(url);
              }
            }
          });
        });

        episodes = allEpisodes;
      }

      return {
        id: item.vod_id.toString(),
        title: item.vod_name.trim().replace(/\s+/g, ' '),
        poster: item.vod_pic,
        episodes,
        source: OFFICIAL_SOURCE_KEY,
        source_name: OFFICIAL_SOURCE_NAME,
        class: item.vod_class,
        year: item.vod_year
          ? item.vod_year.match(/\d{4}/)?.[0] || ''
          : 'unknown',
        desc: cleanHtmlTags(item.vod_content || ''),
        type_name: item.type_name,
        douban_id: item.vod_douban_id,
        source_type: 'official',
      };
    });

    console.log(
      `[searchOfficialResources] 搜索完成，结果数: ${results.length}`
    );
    return results;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`[searchOfficialResources] 请求超时`);
    } else {
      console.error(`[searchOfficialResources] 搜索失败:`, error);
    }
    return [];
  }
}

/**
 * 从非官方资源搜索接口获取搜索结果
 * @param query 搜索关键词
 * @param baseUrl 搜索接口基础URL（默认从环境变量获取）
 * @returns 搜索结果数组
 */
export async function searchUnofficialResources(
  query: string,
  baseUrl?: string,
  options?: { exactTitle?: string; limit?: number; source?: string }
): Promise<SearchResult[]> {
  const unofficialSearchUrl =
    baseUrl ||
    process.env.NEXT_PUBLIC_UNOFFICIAL_SEARCH_URL ||
    process.env.NEXT_PUBLIC_CF_SEARCH_WORKER_URL || // 向后兼容：支持 CF Worker URL
    'https://ss.riowang.win';

  const apiUrl = `${unofficialSearchUrl}/?q=${encodeURIComponent(query)}`;

  console.log(`[searchUnofficialResources] 请求URL: ${apiUrl}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时

  try {
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json, text/event-stream',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(
        `[searchUnofficialResources] 接口返回错误状态: ${response.status}`
      );
      return [];
    }

    // 检查响应类型，可能是 SSE 格式或 JSON 格式
    const contentType = response.headers.get('content-type') || '';
    let data: ApiSearchResponse;

    // SSE：使用流式解析，避免 response.text() 等待长连接结束导致接口卡死
    if (contentType.includes('text/event-stream') && response.body) {
      console.log(`[searchUnofficialResources] 检测到 SSE 格式响应`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const allSearchResults: SearchResult[] = [];
      const allApiItems: ApiSearchItem[] = [];
      let hasSearchResultFormat = false;

      const exactTitle = options?.exactTitle;
      const limit = options?.limit ?? 0;
      const wantSource = options?.source;
      const matchedExact: SearchResult[] = [];

      let streamDone = false;
      while (!streamDone) {
        const { value, done } = await reader.read();
        streamDone = done;
        if (streamDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine.startsWith('data:')) continue;

          const jsonStr = trimmedLine.substring(5).trim();
          if (!jsonStr) continue;

          let sseData: unknown;
          try {
            sseData = JSON.parse(jsonStr);
          } catch {
            continue;
          }

          const sseObj =
            typeof sseData === 'object' && sseData !== null
              ? (sseData as Record<string, unknown>)
              : null;

          if (sseObj && Array.isArray(sseObj.results)) {
            const results = sseObj.results as unknown[];
            for (const item of results) {
              if (typeof item !== 'object' || item === null) continue;
              const rec = item as Record<string, unknown>;
              const episodes = rec.episodes;
              if (Array.isArray(episodes)) {
                hasSearchResultFormat = true;
                const doubanRaw = rec.douban_id ?? rec.vod_douban_id;
                const doubanId =
                  typeof doubanRaw === 'number'
                    ? doubanRaw
                    : typeof doubanRaw === 'string'
                      ? parseInt(doubanRaw, 10)
                      : undefined;

                const sr: SearchResult = {
                  id: String(rec.id || (rec.vod_id as string | number | undefined) || ''),
                  title: String(rec.title || rec.vod_name || ''),
                  poster: String(rec.poster || rec.vod_pic || ''),
                  episodes: episodes as string[],
                  source: String(rec.source || 'unofficial'),
                  source_name: String(rec.source_name || '非官方资源'),
                  class: String(rec.class || rec.vod_class || ''),
                  year:
                    String(rec.year || rec.vod_year || '').match(/\d{4}/)?.[0] ||
                    'unknown',
                  desc: cleanHtmlTags(String(rec.desc || rec.vod_content || '')),
                  type_name: rec.type_name as string | undefined,
                  douban_id: Number.isFinite(doubanId) ? doubanId : undefined,
                  source_type: 'unofficial',
                };

                // 支持提前返回：只要拿到同标题的前 N 条就够了（/api/search/one 用）
                const isExact = !!exactTitle && sr.title === exactTitle;
                const isSourceOk = !wantSource || sr.source === wantSource;

                if (isExact && isSourceOk) {
                  matchedExact.push(sr);
                  if (limit > 0 && matchedExact.length >= limit) {
                    reader.cancel();
                    return matchedExact.slice(0, limit);
                  }
                }

                // 默认行为：不做过滤时才累积全量结果（避免在 /api/search/one 中把大流全部塞进内存）
                if (!exactTitle && !wantSource && limit <= 0) {
                  allSearchResults.push(sr);
                }
              } else {
                const vodId = rec.vod_id ?? rec.id;
                if (vodId) {
                  allApiItems.push({
                    vod_id: String(vodId),
                    vod_name: String(rec.vod_name ?? rec.title ?? ''),
                    vod_pic: String(rec.vod_pic ?? rec.poster ?? ''),
                    vod_play_url: rec.vod_play_url as string | undefined,
                    vod_class: rec.vod_class
                      ? String(rec.vod_class)
                      : rec.class
                        ? String(rec.class)
                        : undefined,
                    vod_year: rec.vod_year
                      ? String(rec.vod_year)
                      : rec.year
                        ? String(rec.year)
                        : undefined,
                    vod_content: rec.vod_content
                      ? String(rec.vod_content)
                      : rec.desc
                        ? String(rec.desc)
                        : undefined,
                    vod_douban_id:
                      typeof rec.vod_douban_id === 'number'
                        ? rec.vod_douban_id
                        : typeof rec.douban_id === 'number'
                          ? rec.douban_id
                          : undefined,
                    type_name: rec.type_name as string | undefined,
                  });
                }
              }
            }
          } else if (sseObj && Array.isArray(sseObj.list)) {
            allApiItems.push(...(sseObj.list as ApiSearchItem[]));
          }

          if (sseObj?.done === true) {
            reader.cancel();
            break;
          }
        }
      }

      // 如果已经是 SearchResult 格式，直接返回
      if (hasSearchResultFormat && allSearchResults.length > 0) {
        console.log(
          `[searchUnofficialResources] SSE 返回 SearchResult 格式，结果数: ${allSearchResults.length}`
        );
        return allSearchResults;
      }

      // 如果开启了精确过滤/限流，但没有提前命中，也返回已收集的精确结果（可能为空）
      if ((exactTitle || wantSource || limit > 0) && hasSearchResultFormat) {
        return matchedExact;
      }

      if (allApiItems.length > 0) {
        console.log(
          `[searchUnofficialResources] SSE 解析到 ApiSearchItem 格式，结果数: ${allApiItems.length}`
        );
        data = { code: 1, msg: '数据列表', list: allApiItems };
      } else {
        console.warn(`[searchUnofficialResources] SSE 解析后数据为空`);
        return [];
      }
    }

    // 非 SSE：按 JSON 读取
    const text = await response.text();
    // 如果没有设置 content-type 但实际是 SSE 文本，这里兜底走原逻辑（会慢，但至少不 crash）
    if (text.trim().startsWith('data:')) {
      console.log(`[searchUnofficialResources] 检测到 SSE 文本响应（非 event-stream）`);
      // 复用旧逻辑：把 data: 行拆出来 JSON.parse
      const lines = text.split('\n');
      const allSearchResults: SearchResult[] = [];
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine.startsWith('data:')) continue;
        try {
          const jsonStr = trimmedLine.substring(5).trim();
          const sseData = JSON.parse(jsonStr);
          if (sseData?.results && Array.isArray(sseData.results)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sseData.results.forEach((item: any) => {
              if (item.episodes && Array.isArray(item.episodes)) {
                allSearchResults.push({
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
                  desc: cleanHtmlTags(item.desc || item.vod_content || ''),
                  type_name: item.type_name,
                  douban_id: item.douban_id || item.vod_douban_id,
                  source_type: 'unofficial',
                });
              }
            });
          }
        } catch {
          // ignore
        }
      }
      return allSearchResults;
    }

    // 标准 JSON 格式
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      console.error(
        `[searchUnofficialResources] JSON 解析失败:`,
        parseError,
        `响应前100字符:`,
        text.substring(0, 100)
      );
      return [];
    }

    if (
      !data ||
      !data.list ||
      !Array.isArray(data.list) ||
      data.list.length === 0
    ) {
      console.log(`[searchUnofficialResources] 数据为空或无效`);
      return [];
    }

    // 处理搜索结果
    const results: SearchResult[] = data.list.map((item: ApiSearchItem) => {
      let episodes: string[] = [];

      if (item.vod_play_url) {
        // 非官方资源：使用正则表达式从 vod_play_url 提取 m3u8 链接
        const m3u8Regex = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
        // 先用 $$$ 分割
        const vod_play_url_array = item.vod_play_url.split('$$$');
        // 对每个分片做匹配，取匹配到最多的作为结果
        vod_play_url_array.forEach((url: string) => {
          const matches = url.match(m3u8Regex) || [];
          if (matches.length > episodes.length) {
            episodes = matches;
          }
        });

        episodes = Array.from(new Set(episodes)).map((link: string) => {
          link = link.substring(1); // 去掉开头的 $
          const parenIndex = link.indexOf('(');
          return parenIndex > 0 ? link.substring(0, parenIndex) : link;
        });
      }

      return {
        id: item.vod_id.toString(),
        title: item.vod_name.trim().replace(/\s+/g, ' '),
        poster: item.vod_pic,
        episodes,
        source: 'unofficial',
        source_name: '非官方资源',
        class: item.vod_class,
        year: item.vod_year
          ? item.vod_year.match(/\d{4}/)?.[0] || ''
          : 'unknown',
        desc: cleanHtmlTags(item.vod_content || ''),
        type_name: item.type_name,
        douban_id: item.vod_douban_id,
        source_type: 'unofficial',
      };
    });

    console.log(
      `[searchUnofficialResources] 搜索完成，结果数: ${results.length}`
    );
    return results;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`[searchUnofficialResources] 请求超时`);
    } else {
      console.error(`[searchUnofficialResources] 搜索失败:`, error);
    }
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}
