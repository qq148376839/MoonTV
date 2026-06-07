/* eslint-disable no-console */
import { NextResponse } from 'next/server';
export const runtime = 'edge';

interface ParseResponse {
  success: boolean;
  data?: {
    m3u8_url?: string | null;
    method?: string;
    parse_time?: number;
    cached?: boolean;
  };
  fallback_used?: boolean;
  error?: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const videoUrl = searchParams.get('url');

  if (!videoUrl) {
    return NextResponse.json(
      {
        success: false,
        data: {},
        fallback_used: false,
        error: '缺少视频 URL 参数',
      },
      { status: 400 }
    );
  }

  // 获取解析API URL，并清理可能存在的双斜杠
  let parseApiUrl =
    process.env.NEXT_PUBLIC_PARSE_API_URL ||
    'https://gfjx.riowang.win/api/v1/parse';

  // 清理 URL 中的双斜杠（除了协议后的双斜杠）
  parseApiUrl = parseApiUrl.replace(/([^:]\/)\/+/g, '$1');

  const parseUrl = `${parseApiUrl}?url=${encodeURIComponent(videoUrl)}`;

  console.log(`[parse] 请求解析API: ${parseUrl.substring(0, 100)}...`);

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
        `[parse] 解析接口返回错误: ${response.status} ${response.statusText}`
      );
      return NextResponse.json(
        {
          success: false,
          data: {},
          fallback_used: false,
          error: `解析接口返回错误: ${response.status}`,
        },
        { status: response.status }
      );
    }

    const result: ParseResponse = await response.json();

    console.log(`[parse] 解析API响应:`, {
      success: result.success,
      hasM3u8Url: !!result.data?.m3u8_url,
      error: result.error,
    });

    // 检查解析结果
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

        if (isPrivateIP) {
          // 获取当前请求的origin，用于构建代理URL
          // 优先使用 Host 头，避免使用 0.0.0.0 这样的无效地址
          let origin = request.headers.get('origin');

          if (!origin) {
            // 如果没有 origin 头，尝试从 Host 头构建
            const host = request.headers.get('host');
            if (host) {
              // 从 request.url 获取协议
              const urlObj = new URL(request.url);
              const protocol = urlObj.protocol;
              origin = `${protocol}//${host}`;
            } else {
              // 最后才使用 request.url 的 origin
              origin = new URL(request.url).origin;
              // 如果 origin 包含 0.0.0.0，替换为 localhost
              if (origin.includes('0.0.0.0')) {
                origin = origin.replace('0.0.0.0', 'localhost');
              }
            }
          }

          const proxyUrl = `${origin}/api/proxy/m3u8?url=${encodeURIComponent(
            m3u8Url
          )}`;

          console.log(`[parse] 检测到内网地址，转换为代理URL:`, {
            original: m3u8Url.substring(0, 100),
            proxied: proxyUrl.substring(0, 100),
            origin,
          });

          m3u8Url = proxyUrl;
        }
      } catch (e) {
        // URL解析失败，保持原样
        console.warn(`[parse] URL解析失败，保持原样:`, m3u8Url);
      }

      return NextResponse.json({
        success: true,
        data: {
          m3u8_url: m3u8Url,
          method: result.data.method,
          parse_time: result.data.parse_time,
          cached: result.data.cached,
        },
      });
    } else {
      // 解析失败：m3u8_url 为空或 success 为 false
      const errorMsg = result.error || '解析失败：无法获取播放地址';
      console.error(`[parse] 解析失败: ${errorMsg}`);
      return NextResponse.json(
        {
          success: false,
          data: {},
          fallback_used: result.fallback_used || false,
          error: errorMsg,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error(`[parse] 解析请求失败:`, error);
    const errorMsg = error instanceof Error ? error.message : '解析失败';
    return NextResponse.json(
      {
        success: false,
        data: {},
        fallback_used: false,
        error: errorMsg,
      },
      { status: 500 }
    );
  }
}
