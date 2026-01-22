/* eslint-disable no-console */
/**
 * 解析辅助函数：用于将官方资源的 HTML URL 转换为 m3u8 URL
 * 用于 OrionTV 兼容性：OrionTV 期望 episodes 数组中的 URL 可以直接播放
 */

/**
 * 检测 URL 是否是 HTML 页面（需要解析）
 */
export function isLikelyWebPageUrl(url: string): boolean {
  try {
    if (!(url.startsWith('http://') || url.startsWith('https://'))) {
      return false;
    }
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const p = u.pathname.toLowerCase();
    const isHtml =
      p.endsWith('.html') || url.toLowerCase().includes('.html#');
    const isKnownVideoPageHost =
      host.includes('youku.com') ||
      host.includes('iqiyi.com') ||
      host.includes('v.qq.com') ||
      host.includes('mgtv.com') ||
      host.includes('bilibili.com');
    return isHtml || isKnownVideoPageHost;
  } catch {
    return false;
  }
}

/**
 * 调用解析 API 将 HTML URL 转换为 m3u8 URL
 * @param videoUrl 需要解析的视频 URL
 * @param origin 当前请求的 origin（用于构建代理 URL）
 * @returns 解析后的 m3u8 URL，失败返回 null
 */
export async function parseToM3u8Url(
  videoUrl: string,
  origin?: string
): Promise<string | null> {
  let parseApiUrl =
    process.env.NEXT_PUBLIC_PARSE_API_URL ||
    'https://gfjx.riowang.win/api/v1/parse';

  // 清理 URL 中的双斜杠（除了协议后的双斜杠）
  parseApiUrl = parseApiUrl.replace(/([^:]\/)\/+/g, '$1');

  const parseUrl = `${parseApiUrl}?url=${encodeURIComponent(videoUrl)}`;

  console.log(
    `[parse-helper] 请求解析API: ${parseUrl.substring(0, 100)}...`
  );

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时

    const response = await fetch(parseUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(
        `[parse-helper] 解析接口返回错误: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const result = await response.json();

    if (result.success && result.data?.m3u8_url) {
      let m3u8Url = result.data.m3u8_url;

      // 检测是否是内网地址，如果是则转换为代理URL
      try {
        const urlObj = new URL(m3u8Url);
        const hostname = urlObj.hostname;

        // 检测内网地址模式
        const isPrivateIP =
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname.startsWith('192.168.') ||
          hostname.startsWith('10.') ||
          /^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname) ||
          hostname.startsWith('169.254.'); // 链路本地地址

        if (isPrivateIP && origin) {
          const proxyUrl = `${origin}/api/proxy/m3u8?url=${encodeURIComponent(m3u8Url)}`;
          console.log(
            `[parse-helper] 检测到内网地址，转换为代理URL: ${proxyUrl.substring(0, 100)}...`
          );
          m3u8Url = proxyUrl;
        }
      } catch (e) {
        // URL解析失败，保持原样
        console.warn(`[parse-helper] URL解析失败，保持原样:`, m3u8Url);
      }

      console.log(
        `[parse-helper] ✓ 解析成功: ${m3u8Url.substring(0, 100)}...`
      );
      return m3u8Url;
    } else {
      console.error(
        `[parse-helper] 解析失败: ${result.error || '无法获取播放地址'}`
      );
      return null;
    }
  } catch (error) {
    console.error(`[parse-helper] 解析请求失败:`, error);
    return null;
  }
}

/**
 * 批量转换官方资源的 episodes：将 HTML URL 转换为 m3u8 URL
 * 为了性能考虑，只转换第一个需要解析的 URL（OrionTV 通常只播放第一个）
 * @param episodes 原始 episodes 数组
 * @param origin 当前请求的 origin（用于构建代理 URL）
 * @returns 转换后的 episodes 数组
 */
export async function convertOfficialEpisodes(
  episodes: string[],
  origin?: string
): Promise<string[]> {
  if (!episodes || episodes.length === 0) {
    return episodes;
  }

  // 检查第一个 episode 是否需要解析
  const firstEpisode = episodes[0];
  if (firstEpisode && isLikelyWebPageUrl(firstEpisode)) {
    // OrionTV 兼容：不要在 search 阶段同步调用外部解析（易超时），改为返回“可播放的解析跳转 URL”
    // 播放器真正拉取该 URL 时再由服务端解析并 302 到 m3u8。
    if (origin) {
      const playable = `${origin}/api/parse-m3u8?url=${encodeURIComponent(firstEpisode)}`;
      return [playable, ...episodes.slice(1)];
    }

    // 没有 origin 的情况下再尝试直接解析（可能会慢/失败）
    const m3u8Url = await parseToM3u8Url(firstEpisode, origin);
    return m3u8Url ? [m3u8Url, ...episodes.slice(1)] : episodes;
  }

  // 如果第一个 URL 已经是 m3u8 或不需要解析，直接返回
  return episodes;
}

/**
 * 将 URL 转换为代理 URL（用于解决 CORS 问题）
 * @param url 原始 URL
 * @param origin 当前请求的 origin（用于构建代理 URL）
 * @returns 转换后的代理 URL
 */
export function convertToProxyUrl(url: string, origin?: string): string {
  if (!origin) {
    console.warn('[parse-helper] 无法获取 origin，无法转换为代理 URL');
    return url;
  }

  // 如果已经是代理 URL 或本地 API 路径，直接返回
  if (url.startsWith('/api/proxy/m3u8') || url.startsWith('/api/')) {
    return url;
  }

  // 转换为代理 URL
  return `${origin}/api/proxy/m3u8?url=${encodeURIComponent(url)}`;
}

/**
 * 批量转换非官方资源的 episodes：将所有 m3u8 URL 转换为代理 URL（解决 CORS 问题）
 * 为了性能考虑，只转换第一个 URL（OrionTV 通常只播放第一个）
 * @param episodes 原始 episodes 数组
 * @param origin 当前请求的 origin（用于构建代理 URL）
 * @returns 转换后的 episodes 数组
 */
export function convertUnofficialEpisodes(
  episodes: string[],
  origin?: string
): string[] {
  if (!episodes || episodes.length === 0) {
    return episodes;
  }

  // 转换第一个 episode 为代理 URL（解决 CORS 问题）
  const firstEpisode = episodes[0];
  if (firstEpisode) {
    const proxiedUrl = convertToProxyUrl(firstEpisode, origin);
    if (proxiedUrl !== firstEpisode) {
      console.log(
        `[parse-helper] 非官方资源 URL 转换为代理 URL: ${firstEpisode.substring(0, 100)}... -> ${proxiedUrl.substring(0, 100)}...`
      );
      return [proxiedUrl, ...episodes.slice(1)];
    }
  }

  return episodes;
}
