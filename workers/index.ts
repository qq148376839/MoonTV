/**
 * MoonTV Cloudflare Workers Search API
 * 独立的搜索 Worker，支持流式返回结果 (SSE)
 */

// 源配置（直接硬编码，避免依赖文件系统）
const SOURCE_CONFIG = [
  {
    key: "dyttzy",
    api: "http://caiji.dyttzyapi.com/api.php/provide/vod",
    name: "电影天堂资源",
    detail: "http://caiji.dyttzyapi.com"
  },
  {
    key: "heimuer",
    api: "https://json.heimuer.xyz/api.php/provide/vod",
    name: "黑木耳",
    detail: "https://heimuer.tv"
  },
  {
    key: "ruyi",
    api: "http://cj.rycjapi.com/api.php/provide/vod",
    name: "如意资源"
  },
  {
    key: "bfzy",
    api: "https://bfzyapi.com/api.php/provide/vod",
    name: "暴风资源"
  },
  {
    key: "tyyszy",
    api: "https://tyyszy.com/api.php/provide/vod",
    name: "天涯资源"
  },
  {
    key: "ffzy",
    api: "http://ffzy5.tv/api.php/provide/vod",
    name: "非凡影视",
    detail: "http://ffzy5.tv"
  },
  {
    key: "zy360",
    api: "https://360zy.com/api.php/provide/vod",
    name: "360资源"
  },
  {
    key: "maotaizy",
    api: "https://caiji.maotaizy.cc/api.php/provide/vod",
    name: "茅台资源"
  },
  {
    key: "wolong",
    api: "https://wolongzyw.com/api.php/provide/vod",
    name: "卧龙资源"
  },
  {
    key: "jisu",
    api: "https://jszyapi.com/api.php/provide/vod",
    name: "极速资源",
    detail: "https://jszyapi.com"
  },
  {
    key: "dbzy",
    api: "https://dbzy.tv/api.php/provide/vod",
    name: "豆瓣资源"
  },
  {
    key: "mozhua",
    api: "https://mozhuazy.com/api.php/provide/vod",
    name: "魔爪资源"
  },
  {
    key: "mdzy",
    api: "https://www.mdzyapi.com/api.php/provide/vod",
    name: "魔都资源"
  },
  {
    key: "zuid",
    api: "https://api.zuidapi.com/api.php/provide/vod",
    name: "最大资源"
  },
  {
    key: "yinghua",
    api: "https://m3u8.apiyhzy.com/api.php/provide/vod",
    name: "樱花资源"
  },
  {
    key: "wujin",
    api: "https://api.wujinapi.me/api.php/provide/vod",
    name: "无尽资源"
  },
  {
    key: "wwzy",
    api: "https://wwzy.tv/api.php/provide/vod",
    name: "旺旺短剧"
  },
  {
    key: "ikun",
    api: "https://ikunzyapi.com/api.php/provide/vod",
    name: "iKun资源"
  },
  {
    key: "lzi",
    api: "https://cj.lziapi.com/api.php/provide/vod",
    name: "量子资源站"
  },
  {
    key: "xiaomaomi",
    api: "https://zy.xmm.hk/api.php/provide/vod",
    name: "小猫咪资源"
  },
  {
    key: "gay",
    api: "https://cfapi.riowang.win/api/another",
    name: "gay资源"
  },
  {
    key: "hongniu",
    api: "https://www.hongniuzy2.com/api.php/provide/vod",
    name: "红牛资源"
  },
  {
    key: "sdzy",
    api: "https://xsd.sdzyapi.com/api.php/provide/vod",
    name: "闪电资源"
  },
  {
    key: "xinlang",
    api: "https://api.xinlangapi.com/xinlangapi.php/provide/vod",
    name: "新浪资源"
  },
  {
    key: "yzzy",
    api: "https://api.yzzy-api.com/inc/apijson.php/provide/vod",
    name: "云资源"
  },
  {
    key: "suboc",
    api: "https://subocj.com/api.php/provide/vod",
    name: "速播资源"
  },
  {
    key: "hhzy",
    api: "https://hhzyapi.com/api.php/provide/vod",
    name: "海海资源"
  },
  {
    key: "dbzy5",
    api: "https://caiji.dbzy5.com/api.php/provide/vod",
    name: "豆瓣资源5"
  },
  {
    key: "okzyw",
    api: "https://api.okzyw.net/api.php/provide/vod",
    name: "OK资源网"
  },
  {
    key: "yayazy",
    api: "https://cj.yayazy.net/api.php/provide/vod",
    name: "丫丫资源"
  },
  {
    key: "ckzy",
    api: "https://ckzy.me/api.php/provide/vod",
    name: "创客资源"
  },
  {
    key: "suoniapi",
    api: "https://suoniapi.com/api.php/provide/vod",
    name: "锁你资源"
  },
  {
    key: "niuniuzy",
    api: "https://api.niuniuzy.me/api.php/provide/vod",
    name: "牛牛资源"
  },
  {
    key: "789caiji",
    api: "https://gfjx.riowang.win/api/v1/search",
    name: "789采集"
  }
];

// 敏感词配置（用于过滤）
const YELLOW_WORDS = [
  '伦理',
  '三级',
  '金瓶梅',
  '色戒',
  '肉蒲团',
  '艳史',
  '淫',
  '激情',
  '乱伦',
  '性爱',
  '自慰',
  'AV',
  'H片',
  'R级',
  '成人',
  '限制级',
];

// 源优先级配置
const SOURCE_PRIORITY = {
  bfzy: 1, // 暴风资源 - 通常较快
  tyyszy: 2, // 天涯资源 - 稳定
  zy360: 3, // 360资源 - 较快
  wolong: 4, // 卧龙资源 - 中等
  jisu: 5, // 极速资源 - 较快
  dbzy: 6, // 豆瓣资源 - 中等
};

// API配置
const API_CONFIG = {
  search: {
    path: '?ac=videolist&wd=',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
};

// 辅助函数：清理HTML标签
function cleanHtmlTags(str) {
  if (!str) return '';
  return str.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

/**
 * 执行搜索请求
 */
async function searchFromApi(apiSite, query) {
  try {
    const apiBaseUrl = apiSite.api;
    const apiUrl = apiBaseUrl + API_CONFIG.search.path + encodeURIComponent(query);
    
    // 超时控制
    const controller = new AbortController();
    const timeoutMs = 3000; // 默认3秒超时
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(apiUrl, {
      headers: API_CONFIG.search.headers,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) return [];

    const data = await response.json();
    
    if (!data || !data.list || !Array.isArray(data.list) || data.list.length === 0) {
      return [];
    }

    // 处理结果
    return data.list.map((item) => {
      let episodes = [];

      if (item.vod_play_url) {
        // 使用正则表达式从 vod_play_url 提取 m3u8 链接
        const m3u8Regex = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
        // 先用 $$$ 分割
        const vod_play_url_array = item.vod_play_url.split('$$$');
        // 对每个分片做匹配，取匹配到最多的作为结果
        vod_play_url_array.forEach((url) => {
          const matches = url.match(m3u8Regex) || [];
          if (matches.length > episodes.length) {
            episodes = matches;
          }
        });

        episodes = Array.from(new Set(episodes)).map((link) => {
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
        source: apiSite.key,
        source_name: apiSite.name,
        class: item.vod_class,
        year: item.vod_year ? item.vod_year.match(/\d{4}/)?.[0] || '' : 'unknown',
        desc: cleanHtmlTags(item.vod_content || ''),
        type_name: item.type_name,
        douban_id: item.vod_douban_id,
      };
    });
  } catch (error) {
    // 忽略错误，返回空数组
    return [];
  }
}

/**
 * Cloudflare Worker 主逻辑
 */
const worker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const query = url.searchParams.get('q');
    
    // CORS 头部
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // 处理 OPTIONS 请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (!query) {
      return new Response('Missing query parameter', { 
        status: 400,
        headers: corsHeaders 
      });
    }

    // 1. 设置 SSE 响应流
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // 2. 构造响应对象（立即返回，不等待搜索完成）
    const response = new Response(readable, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });

    // 3. 异步执行搜索任务
    ctx.waitUntil((async () => {
      try {
        // 过滤禁用的源（此处默认全部启用）
        const apiSites = SOURCE_CONFIG;

        // 按优先级排序源
        const sortedSites = apiSites.sort((a, b) => {
          const priorityA = SOURCE_PRIORITY[a.key] || 999;
          const priorityB = SOURCE_PRIORITY[b.key] || 999;
          return priorityA - priorityB;
        });

        // 已见结果去重
        const seenResults = new Set();
        
        // 并发搜索所有源
        const searchTasks = sortedSites.map(async (site) => {
          try {
            const results = await searchFromApi(site, query);
            
            if (results.length > 0) {
              // 过滤黄色内容
              // 注意：这里简单过滤，如果不需要可以移除
              const filteredResults = results.filter((result) => {
                const typeName = result.type_name || '';
                return !YELLOW_WORDS.some((word) => typeName.includes(word));
              });

              if (filteredResults.length > 0) {
                // 去重
                const newResults = [];
                filteredResults.forEach((result) => {
                  const key = `${result.source}-${result.id}`;
                  if (!seenResults.has(key)) {
                    seenResults.add(key);
                    newResults.push(result);
                  }
                });

                // 推送结果
                if (newResults.length > 0) {
                  const message = JSON.stringify({
                    results: newResults,
                    done: false,
                    timestamp: Date.now()
                  });
                  await writer.write(encoder.encode(`data: ${message}\n\n`));
                }
              }
            }
          } catch (e) {
            // 单个源失败忽略
          }
        });

        // 等待所有源处理完毕
        await Promise.allSettled(searchTasks);
        
        // 发送结束信号
        const doneMessage = JSON.stringify({
          results: [],
          done: true,
          timestamp: Date.now()
        });
        await writer.write(encoder.encode(`data: ${doneMessage}\n\n`));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Search worker error:', err);
      } finally {
        await writer.close();
      }
    })());

    return response;
  }
};

export default worker;
