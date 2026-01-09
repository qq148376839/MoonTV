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
                    source: item.source || 'official',
                    source_name: item.source_name || '官方资源',
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
        source: 'official',
        source_name: '官方资源',
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
  baseUrl?: string
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

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(
        `[searchUnofficialResources] 接口返回错误状态: ${response.status}`
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
      console.log(`[searchUnofficialResources] 检测到 SSE 格式响应`);
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
                    source: item.source || 'unofficial',
                    source_name: item.source_name || '非官方资源',
                    class: item.class || item.vod_class || '',
                    year: item.year || item.vod_year?.match(/\d{4}/)?.[0] || 'unknown',
                    desc: cleanHtmlTags(item.desc || item.vod_content || ''),
                    type_name: item.type_name,
                    douban_id: item.douban_id || item.vod_douban_id,
                    source_type: 'unofficial',
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
              `[searchUnofficialResources] SSE 行解析失败:`,
              trimmedLine.substring(0, 100)
            );
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

      // 如果解析到了 ApiSearchItem 格式的数据，构造标准格式的响应
      if (allApiItems.length > 0) {
        console.log(
          `[searchUnofficialResources] SSE 解析到 ApiSearchItem 格式，结果数: ${allApiItems.length}`
        );
        data = {
          code: 1,
          msg: '数据列表',
          list: allApiItems,
        };
      } else {
        // 如果两种格式都没有解析到数据，记录详细日志
        console.warn(
          `[searchUnofficialResources] SSE 解析后数据为空`,
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
          `[searchUnofficialResources] JSON 解析失败:`,
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
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`[searchUnofficialResources] 请求超时`);
    } else {
      console.error(`[searchUnofficialResources] 搜索失败:`, error);
    }
    return [];
  }
}
