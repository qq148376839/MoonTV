/* eslint-disable no-console */
import { API_CONFIG, ApiSite, getConfig } from '@/lib/config';
import { decryptEpisodeUrls, DEFAULT_PARSER_URL } from '@/lib/decrypt';
import { SearchResult } from '@/lib/types';
import { cleanHtmlTags } from '@/lib/utils';

// 获取源的配置信息（用于判断是否需要官方解析）
async function getApiSiteConfig(key: string): Promise<ApiSite | null> {
  try {
    const config = await getConfig();
    return config.SourceConfig.find((s) => s.key === key) || null;
  } catch {
    return null;
  }
}

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

export async function searchFromApi(
  apiSite: ApiSite,
  query: string,
  requestUrl?: string
): Promise<SearchResult[]> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _startTime = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[searchFromApi] 开始搜索 - 源: ${apiSite.key}, 查询: ${query}`);

  // 提前获取源配置，用于设置超时时间
  const siteConfig = await getApiSiteConfig(apiSite.key);
  const isOfficialParser = siteConfig?.official_parser === true;
  console.log(
    `[searchFromApi] 配置检查 - 源: ${apiSite.key}, official_parser: ${isOfficialParser}`
  );

  try {
    const apiBaseUrl = apiSite.api;
    const apiUrl =
      apiBaseUrl + API_CONFIG.search.path + encodeURIComponent(query);
    const apiName = apiSite.name;

    console.log(`[searchFromApi] 请求URL: ${apiUrl}`);

    // 【修复】Edge Runtime环境下的超时处理
    // 使用AbortController实现超时，兼容Edge Runtime
    const controller = new AbortController();

    // 创建超时处理
    // 对于官方解析资源，增加超时时间（因为可能需要更多时间）
    const timeoutMs = isOfficialParser ? 5000 : 2500; // 官方解析资源5秒，普通资源2.5秒
    console.log(
      `[searchFromApi] 设置超时时间 - 源: ${apiSite.key}, 超时: ${timeoutMs}ms`
    );

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      timeoutId = setTimeout(() => {
        console.log(
          `[searchFromApi] ⚠️ 超时触发 - 源: ${apiSite.key}, 超时时间: ${timeoutMs}ms`
        );
        controller.abort();
      }, timeoutMs);
    } catch (e) {
      // 如果setTimeout不可用（Edge Runtime应该支持，但以防万一）
      // 使用Promise.race作为备选方案
    }

    const fetchStartTime = Date.now();
    console.log(
      `[searchFromApi] 发送请求 - 源: ${apiSite.key}, 时间: ${fetchStartTime}`
    );

    const fetchPromise = fetch(apiUrl, {
      headers: API_CONFIG.search.headers,
      signal: controller.signal,
    });

    let response: Response;
    try {
      response = await fetchPromise;
      const fetchDuration = Date.now() - fetchStartTime;
      console.log(
        `[searchFromApi] 收到响应 - 源: ${apiSite.key}, 状态: ${response.status}, 耗时: ${fetchDuration}ms`
      );
    } catch (error) {
      // 如果请求被中止或失败
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      if (error instanceof Error && error.name === 'AbortError') {
        // 超时错误
        if (process.env.NODE_ENV === 'development') {
          // eslint-disable-next-line no-console
          console.warn(`[searchFromApi] ${apiSite.key} request timeout`);
        }
      }
      throw error;
    }

    // 清理超时
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      // 记录非200状态码（仅在开发环境）
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.warn(
          `[searchFromApi] ${apiSite.key} returned status ${response.status}`
        );
      }
      return [];
    }

    const data = await response.json();
    const parseDuration = Date.now() - fetchStartTime;
    console.log(
      `[searchFromApi] 解析JSON完成 - 源: ${apiSite.key}, 耗时: ${parseDuration}ms, 数据:`,
      {
        code: data?.code,
        msg: data?.msg,
        listLength: data?.list?.length || 0,
        total: data?.total,
      }
    );

    if (
      !data ||
      !data.list ||
      !Array.isArray(data.list) ||
      data.list.length === 0
    ) {
      console.log(`[searchFromApi] 数据为空或无效 - 源: ${apiSite.key}`);
      return [];
    }

    // 配置已在函数开始时获取，这里直接使用
    // 【调试日志】记录配置检查结果
    console.log(
      `[searchFromApi] 源: ${apiSite.key}, official_parser: ${isOfficialParser}, 配置:`,
      {
        key: siteConfig?.key,
        official_parser: siteConfig?.official_parser,
        name: siteConfig?.name,
      }
    );

    // 处理第一页结果
    const results = data.list.map((item: ApiSearchItem) => {
      let episodes: string[] = [];

      if (item.vod_play_url) {
        if (isOfficialParser) {
          // 【调试日志】记录官方解析资源的URL提取过程
          if (process.env.NODE_ENV === 'development') {
            console.log(
              `[searchFromApi] 官方解析资源 - 源: ${apiSite.key}, 标题: ${item.vod_name}`
            );
            console.log(
              `[searchFromApi] vod_play_url 长度: ${item.vod_play_url.length}, 前100字符:`,
              item.vod_play_url.substring(0, 100)
            );
          }

          // 官方解析资源：提取所有第三方视频网站URL
          // 格式：播放源1$$$播放源2$$$播放源3
          // 每个播放源格式：剧集名$URL 或 剧集名$URL#剧集名$URL（多个剧集用#分隔）
          const playSources = item.vod_play_url.split('$$$');

          if (process.env.NODE_ENV === 'development') {
            console.log(`[searchFromApi] 播放源数量: ${playSources.length}`);
          }

          // 提取所有播放源的所有剧集URL
          const allEpisodes: string[] = [];

          playSources.forEach((source: string, sourceIndex: number) => {
            if (!source || !source.trim()) {
              return;
            }

            // 每个播放源可能有多个剧集（用#分隔）
            const episodeList = source.split('#');

            if (process.env.NODE_ENV === 'development') {
              console.log(
                `[searchFromApi] 播放源${sourceIndex + 1}的剧集数量: ${
                  episodeList.length
                }`
              );
            }

            episodeList.forEach((ep: string) => {
              if (!ep || !ep.trim()) {
                return;
              }

              // 每个剧集格式：剧集名$URL
              const parts = ep.split('$');
              if (parts.length >= 2) {
                // parts[0] 是剧集名，parts[1] 是URL
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

          // 【调试日志】记录提取结果
          if (process.env.NODE_ENV === 'development') {
            console.log(
              `[searchFromApi] 提取到的episodes总数: ${episodes.length}`
            );
            if (episodes.length > 0) {
              console.log(`[searchFromApi] 所有episodes:`, episodes);
            } else {
              console.warn(
                `[searchFromApi] ⚠️ 未提取到任何episodes！原始数据:`,
                {
                  vod_play_url: item.vod_play_url,
                  playSourcesCount: playSources.length,
                }
              );
            }
          }
        } else {
          // 普通资源：使用正则表达式从 vod_play_url 提取 m3u8 链接
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
      }

      const result = {
        id: item.vod_id.toString(),
        title: item.vod_name.trim().replace(/\s+/g, ' '),
        poster: item.vod_pic,
        episodes,
        source: apiSite.key,
        source_name: apiName,
        class: item.vod_class,
        year: item.vod_year
          ? item.vod_year.match(/\d{4}/)?.[0] || ''
          : 'unknown',
        desc: cleanHtmlTags(item.vod_content || ''),
        type_name: item.type_name,
        douban_id: item.vod_douban_id,
      };

      // 【调试日志】记录每个搜索结果
      if (process.env.NODE_ENV === 'development' && isOfficialParser) {
        console.log(
          `[searchFromApi] 搜索结果 - 标题: ${result.title}, episodes数量: ${result.episodes.length}, source: ${result.source}`
        );
      }

      return result;
    });

    // 【调试日志】记录总结果数
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[searchFromApi] 源: ${apiSite.key}, 总结果数: ${
          results.length
        }, 有episodes的结果数: ${
          results.filter((r: SearchResult) => r.episodes.length > 0).length
        }`
      );
    }

    const config = await getConfig();
    // 【优化】限制多页搜索页数，最多只搜索3页，而不是5页，减少延迟
    const MAX_SEARCH_PAGES: number = Math.min(
      config.SiteConfig.SearchDownstreamMaxPage || 5,
      3
    );

    // 获取总页数
    const pageCount = data.pagecount || 1;
    // 确定需要获取的额外页数
    const pagesToFetch = Math.min(pageCount - 1, MAX_SEARCH_PAGES - 1);

    // 如果有额外页数，获取更多页的结果
    if (pagesToFetch > 0) {
      const additionalPagePromises = [];

      for (let page = 2; page <= pagesToFetch + 1; page++) {
        const pageUrl =
          apiBaseUrl +
          API_CONFIG.search.pagePath
            .replace('{query}', encodeURIComponent(query))
            .replace('{page}', page.toString());

        const pagePromise = (async () => {
          try {
            const pageController = new AbortController();
            // 【优化】降低多页搜索超时时间从8s到2s，提升响应速度
            const pageTimeoutId = setTimeout(
              () => pageController.abort(),
              2000
            );

            const pageResponse = await fetch(pageUrl, {
              headers: API_CONFIG.search.headers,
              signal: pageController.signal,
            });

            clearTimeout(pageTimeoutId);

            if (!pageResponse.ok) return [];

            const pageData = await pageResponse.json();

            if (!pageData || !pageData.list || !Array.isArray(pageData.list))
              return [];

            return pageData.list.map((item: ApiSearchItem) => {
              let episodes: string[] = [];

              if (item.vod_play_url) {
                if (isOfficialParser) {
                  // 官方解析资源：提取所有第三方视频网站URL
                  const playSources = item.vod_play_url.split('$$$');
                  if (playSources.length > 0) {
                    const mainSource = playSources[0];
                    const episodeList = mainSource.split('#');
                    episodes = episodeList
                      .map((ep: string) => {
                        const parts = ep.split('$');
                        return parts.length > 1 ? parts[1] : '';
                      })
                      .filter(
                        (url: string) =>
                          url &&
                          (url.startsWith('http://') ||
                            url.startsWith('https://'))
                      );
                  }
                } else {
                  // 普通资源：使用正则表达式从 vod_play_url 提取 m3u8 链接
                  const m3u8Regex = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
                  episodes = item.vod_play_url.match(m3u8Regex) || [];

                  episodes = Array.from(new Set(episodes)).map(
                    (link: string) => {
                      link = link.substring(1); // 去掉开头的 $
                      const parenIndex = link.indexOf('(');
                      return parenIndex > 0
                        ? link.substring(0, parenIndex)
                        : link;
                    }
                  );
                }
              }

              return {
                id: item.vod_id.toString(),
                title: item.vod_name.trim().replace(/\s+/g, ' '),
                poster: item.vod_pic,
                episodes,
                source: apiSite.key,
                source_name: apiName,
                class: item.vod_class,
                year: item.vod_year
                  ? item.vod_year.match(/\d{4}/)?.[0] || ''
                  : 'unknown',
                desc: cleanHtmlTags(item.vod_content || ''),
                type_name: item.type_name,
                douban_id: item.vod_douban_id,
              };
            });
          } catch (error) {
            return [];
          }
        })();

        additionalPagePromises.push(pagePromise);
      }

      // 等待所有额外页的结果
      const additionalResults = await Promise.all(additionalPagePromises);

      // 合并所有页的结果
      additionalResults.forEach((pageResults) => {
        if (pageResults.length > 0) {
          results.push(...pageResults);
        }
      });
    }

    // 【API层自动解密】如果是官方解析资源，自动解密所有剧集URL
    if (isOfficialParser && results.length > 0) {
      const parserUrl = DEFAULT_PARSER_URL;
      console.log(
        `[searchFromApi] 开始自动解密官方解析资源 - 源: ${apiSite.key}, 结果数: ${results.length}`
      );

      // 收集所有需要解密的URL
      const allEpisodesToDecrypt: Array<{
        resultIndex: number;
        episodeIndex: number;
        url: string;
      }> = [];

      results.forEach((result: SearchResult, resultIndex: number) => {
        result.episodes.forEach((url: string, episodeIndex: number) => {
          allEpisodesToDecrypt.push({
            resultIndex,
            episodeIndex,
            url,
          });
        });
      });

      if (allEpisodesToDecrypt.length > 0) {
        console.log(
          `[searchFromApi] 需要解密的URL总数: ${allEpisodesToDecrypt.length}`
        );

        try {
          // 批量解密所有URL
          // Edge Runtime 环境需要通过 HTTP API 调用解密
          const urlsToDecrypt = allEpisodesToDecrypt.map((item) => item.url);
          const decryptedUrls = await decryptEpisodeUrls(
            parserUrl,
            urlsToDecrypt,
            true, // 强制使用 HTTP API（Edge Runtime）
            requestUrl // 传递请求 URL 用于获取 base URL
          );

          // 更新结果中的URL，过滤掉解密失败的（空字符串）
          allEpisodesToDecrypt.forEach((item, index) => {
            const decryptedUrl = decryptedUrls[index];
            if (
              decryptedUrl &&
              decryptedUrl !== '' &&
              decryptedUrl !== item.url
            ) {
              // 解密成功，更新URL
              results[item.resultIndex].episodes[item.episodeIndex] =
                decryptedUrl;
              console.log(
                `[searchFromApi] ✓ URL解密成功: ${item.url.substring(
                  0,
                  50
                )}... → ${decryptedUrl.substring(0, 50)}...`
              );
            } else {
              // 解密失败（空字符串或返回原始URL），移除该 URL（因为无法播放）
              console.warn(
                `[searchFromApi] ⚠️ URL解密失败，移除该URL: ${item.url.substring(
                  0,
                  50
                )}...`
              );
              // 设置为空字符串，后续会过滤掉
              results[item.resultIndex].episodes[item.episodeIndex] = '';
            }
          });

          // 过滤掉解密失败的 URL（空字符串）
          results.forEach((result: SearchResult) => {
            result.episodes = result.episodes.filter((url) => url !== '');
          });

          const successCount = decryptedUrls.filter(
            (url, index) => url && url !== urlsToDecrypt[index] && url !== ''
          ).length;
          const failCount = decryptedUrls.filter(
            (url) => !url || url === ''
          ).length;

          console.log(
            `[searchFromApi] ✓ 自动解密完成 - 成功: ${successCount}, 失败: ${failCount}`
          );
        } catch (error) {
          // 解密失败，清空所有 episodes（因为无法播放）
          console.error(
            `[searchFromApi] ✗ 自动解密失败，清空所有episodes:`,
            error instanceof Error ? error.message : error
          );
          // 清空所有官方解析资源的 episodes（因为无法播放）
          results.forEach((result: SearchResult) => {
            if (result.source === apiSite.key) {
              result.episodes = [];
            }
          });
          // 不抛出错误，确保API正常返回
        }
      }
    }

    return results;
  } catch (error) {
    return [];
  }
}

// 匹配 m3u8 链接的正则
const M3U8_PATTERN = /(https?:\/\/[^"'\s]+?\.m3u8)/g;

export async function getDetailFromApi(
  apiSite: ApiSite,
  id: string,
  requestUrl?: string
): Promise<SearchResult> {
  if (apiSite.detail) {
    return handleSpecialSourceDetail(id, apiSite);
  }

  // 获取源配置，判断是否为官方解析资源
  const siteConfig = await getApiSiteConfig(apiSite.key);
  const isOfficialParser = siteConfig?.official_parser === true;

  const detailUrl = `${apiSite.api}${API_CONFIG.detail.path}${id}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const response = await fetch(detailUrl, {
    headers: API_CONFIG.detail.headers,
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`详情请求失败: ${response.status}`);
  }

  const data = await response.json();

  if (
    !data ||
    !data.list ||
    !Array.isArray(data.list) ||
    data.list.length === 0
  ) {
    throw new Error('获取到的详情内容无效');
  }

  const videoDetail = data.list[0];
  let episodes: string[] = [];

  // 处理播放源拆分
  if (videoDetail.vod_play_url) {
    if (isOfficialParser) {
      // 官方解析资源：提取所有第三方视频网站URL
      const playSources = videoDetail.vod_play_url.split('$$$');
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
    } else {
      // 普通资源：使用原有逻辑
      const playSources = videoDetail.vod_play_url.split('$$$');
      if (playSources.length > 0) {
        const mainSource = playSources[0];
        const episodeList = mainSource.split('#');
        episodes = episodeList
          .map((ep: string) => {
            const parts = ep.split('$');
            return parts.length > 1 ? parts[1] : '';
          })
          .filter(
            (url: string) =>
              url && (url.startsWith('http://') || url.startsWith('https://'))
          );
      }
    }
  }

  // 如果播放源为空，则尝试从内容中解析 m3u8
  if (episodes.length === 0 && videoDetail.vod_content) {
    const matches = videoDetail.vod_content.match(M3U8_PATTERN) || [];
    episodes = matches.map((link: string) => link.replace(/^\$/, ''));
  }

  // 【API层自动解密】如果是官方解析资源，自动解密所有剧集URL
  if (isOfficialParser && episodes.length > 0) {
    const parserUrl = DEFAULT_PARSER_URL;
    console.log(
      `[getDetailFromApi] 开始自动解密官方解析资源 - 源: ${apiSite.key}, 剧集数: ${episodes.length}`
    );

    try {
      // 批量解密所有URL
      // Edge Runtime 环境需要通过 HTTP API 调用解密
      const decryptedUrls = await decryptEpisodeUrls(
        parserUrl,
        episodes,
        true, // 强制使用 HTTP API（Edge Runtime）
        requestUrl // 传递请求 URL 用于获取 base URL
      );

      // 统计解密结果
      const successCount = decryptedUrls.filter(
        (url, index) => url && url !== episodes[index] && url !== ''
      ).length;
      const failCount = decryptedUrls.filter(
        (url) => !url || url === ''
      ).length;

      // 更新episodes，过滤掉解密失败的（空字符串）
      episodes = decryptedUrls.filter((url) => url !== '');

      console.log(
        `[getDetailFromApi] ✓ 自动解密完成 - 成功: ${successCount}, 失败: ${failCount}`
      );
    } catch (error) {
      // 解密失败，清空所有 episodes（因为无法播放）
      console.error(
        `[getDetailFromApi] ✗ 自动解密失败，清空所有episodes:`,
        error instanceof Error ? error.message : error
      );
      // 清空所有 episodes（因为无法播放）
      episodes = [];
      // 不抛出错误，确保API正常返回
    }
  }

  return {
    id: id.toString(),
    title: videoDetail.vod_name,
    poster: videoDetail.vod_pic,
    episodes,
    source: apiSite.key,
    source_name: apiSite.name,
    class: videoDetail.vod_class,
    year: videoDetail.vod_year
      ? videoDetail.vod_year.match(/\d{4}/)?.[0] || ''
      : 'unknown',
    desc: cleanHtmlTags(videoDetail.vod_content),
    type_name: videoDetail.type_name,
    douban_id: videoDetail.vod_douban_id,
  };
}

async function handleSpecialSourceDetail(
  id: string,
  apiSite: ApiSite
): Promise<SearchResult> {
  const detailUrl = `${apiSite.detail}/index.php/vod/detail/id/${id}.html`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const response = await fetch(detailUrl, {
    headers: API_CONFIG.detail.headers,
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`详情页请求失败: ${response.status}`);
  }

  const html = await response.text();
  let matches: string[] = [];

  if (apiSite.key === 'ffzy') {
    const ffzyPattern =
      /\$(https?:\/\/[^"'\s]+?\/\d{8}\/\d+_[a-f0-9]+\/index\.m3u8)/g;
    matches = html.match(ffzyPattern) || [];
  }

  if (matches.length === 0) {
    const generalPattern = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
    matches = html.match(generalPattern) || [];
  }

  // 去重并清理链接前缀
  matches = Array.from(new Set(matches)).map((link: string) => {
    link = link.substring(1); // 去掉开头的 $
    const parenIndex = link.indexOf('(');
    return parenIndex > 0 ? link.substring(0, parenIndex) : link;
  });

  // 提取标题
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const titleText = titleMatch ? titleMatch[1].trim() : '';

  // 提取描述
  const descMatch = html.match(
    /<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/
  );
  const descText = descMatch ? cleanHtmlTags(descMatch[1]) : '';

  // 提取封面
  const coverMatch = html.match(/(https?:\/\/[^"'\s]+?\.jpg)/g);
  const coverUrl = coverMatch ? coverMatch[0].trim() : '';

  // 提取年份
  const yearMatch = html.match(/>(\d{4})</);
  const yearText = yearMatch ? yearMatch[1] : 'unknown';

  return {
    id,
    title: titleText,
    poster: coverUrl,
    episodes: matches,
    source: apiSite.key,
    source_name: apiSite.name,
    class: '',
    year: yearText,
    desc: descText,
    type_name: '',
    douban_id: 0,
  };
}
