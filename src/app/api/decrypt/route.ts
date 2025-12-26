/**
 * 官方解析器解密API
 * 参考 final_direct_parser_v2.py 的实现
 */
/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getStorage } from '@/lib/db';
import { decryptUrl } from '@/lib/decrypt';

// Storage 接口定义
interface StorageWithMethods {
  get: (key: string) => Promise<{ m3u8Url: string; timestamp: number } | null>;
  set: (
    key: string,
    value: { m3u8Url: string; timestamp: number }
  ) => Promise<void>;
}

// 内存缓存（用于快速访问）
const memoryCache = new Map<string, { m3u8Url: string; timestamp: number }>();
const CACHE_TTL = 3600000; // 1小时缓存

interface DecryptRequest {
  parserUrl: string; // 解析器URL（来自detail字段）
  videoUrl: string; // 原始视频URL
}

// DecryptResponse interface is used in return types
// eslint-disable-next-line unused-imports/no-unused-vars
interface DecryptResponse {
  success: boolean;
  m3u8Url?: string;
  error?: string;
  cached?: boolean;
}

/**
 * 获取缓存键
 */
function getCacheKey(parserUrl: string, videoUrl: string): string {
  return `decrypt:${parserUrl}:${videoUrl}`;
}

/**
 * 从缓存获取解密结果
 */
async function getCachedResult(cacheKey: string): Promise<string | null> {
  // 先检查内存缓存
  const memoryCached = memoryCache.get(cacheKey);
  if (memoryCached && Date.now() - memoryCached.timestamp < CACHE_TTL) {
    return memoryCached.m3u8Url;
  }

  // 检查数据库缓存（如果支持）
  try {
    const storage = getStorage();
    if (
      storage &&
      typeof (storage as unknown as StorageWithMethods).get === 'function'
    ) {
      const cached = await (storage as unknown as StorageWithMethods).get(
        cacheKey
      );
      if (cached && cached.m3u8Url) {
        // 同时更新内存缓存
        memoryCache.set(cacheKey, {
          m3u8Url: cached.m3u8Url,
          timestamp: Date.now(),
        });
        return cached.m3u8Url;
      }
    }
  } catch (error) {
    // 缓存获取失败，继续执行解密
    console.warn('获取缓存失败:', error);
  }

  return null;
}

/**
 * 保存解密结果到缓存
 */
async function saveToCache(cacheKey: string, m3u8Url: string): Promise<void> {
  // 保存到内存缓存
  memoryCache.set(cacheKey, {
    m3u8Url,
    timestamp: Date.now(),
  });

  // 保存到数据库缓存（如果支持）
  try {
    const storage = getStorage();
    if (
      storage &&
      typeof (storage as unknown as StorageWithMethods).set === 'function'
    ) {
      await (storage as unknown as StorageWithMethods).set(cacheKey, {
        m3u8Url,
        timestamp: Date.now(),
      });
    }
  } catch (error) {
    // 缓存保存失败，不影响主流程
    console.warn('保存缓存失败:', error);
  }
}

/**
 * 获取iframe URL
 */
async function getIframeUrl(
  parserUrl: string,
  videoUrl: string
): Promise<string> {
  const fullUrl = `${parserUrl}/?url=${encodeURIComponent(videoUrl)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

  try {
    const response = await fetch(fullUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
        Referer: parserUrl,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`获取iframe URL失败: ${response.status}`);
    }

    const html = await response.text();
    const iframePattern = /<iframe[^>]+src=["']([^"']+)["']/i;
    const match = html.match(iframePattern);

    if (!match || !match[1]) {
      throw new Error('未找到iframe URL');
    }

    let iframeUrl = match[1];
    if (!iframeUrl.startsWith('http')) {
      // 相对路径，转换为绝对路径
      const baseUrl = new URL(parserUrl);
      iframeUrl = new URL(iframeUrl, baseUrl).href;
    }

    return iframeUrl;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * 从HTML中提取ConFig对象
 */
function extractConfigFromHtml(
  html: string
): { url: string; uid: string } | null {
  // 提取url字段
  const urlMatch = html.match(/"url"\s*:\s*"([^"]+)"/);
  // 提取uid字段
  const uidMatch = html.match(/"uid"\s*:\s*"([^"]+)"/);

  if (!urlMatch || !uidMatch) {
    return null;
  }

  const url = urlMatch[1].replace(/\\\//g, '/'); // 处理转义的斜杠
  const uid = uidMatch[1];

  return { url, uid };
}

/**
 * 跟踪重定向获取最终m3u8
 */
async function followRedirectToFinalM3u8(
  initialUrl: string,
  maxRedirects = 10
): Promise<string> {
  let currentUrl = initialUrl;
  const visitedUrls = new Set<string>();
  let redirectCount = 0;

  console.log(
    `[followRedirect] 开始跟踪重定向，初始URL: ${initialUrl}, 最大重定向次数: ${maxRedirects}`
  );

  while (redirectCount < maxRedirects) {
    if (visitedUrls.has(currentUrl)) {
      throw new Error('检测到重定向循环');
    }
    visitedUrls.add(currentUrl);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(currentUrl, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
          Accept: '*/*',
        },
        redirect: 'manual', // 手动处理重定向
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // 处理重定向
      if (
        response.status === 301 ||
        response.status === 302 ||
        response.status === 303 ||
        response.status === 307 ||
        response.status === 308
      ) {
        const redirectUrl = response.headers.get('Location');
        if (redirectUrl) {
          let nextUrl: string;
          if (!redirectUrl.startsWith('http')) {
            nextUrl = new URL(redirectUrl, currentUrl).href;
          } else {
            nextUrl = redirectUrl;
          }
          console.log(
            `[followRedirect] 🔄 重定向 (${response.status}) ${currentUrl} → ${nextUrl}`
          );
          currentUrl = nextUrl;
          redirectCount++;
          continue;
        }
      }

      // 检查响应内容
      if (response.status === 200) {
        const contentType = response.headers.get('Content-Type') || '';

        // 如果Content-Type是video/mp4，说明这不是m3u8
        // 根据实际情况，解析后可能得到MP4格式的试看片段，虽然可以播放，但不是完整的m3u8
        // 检查是否有Location头（某些服务器可能在200响应中也包含Location）
        const locationHeader = response.headers.get('Location');
        if (locationHeader) {
          let nextUrl: string;
          if (!locationHeader.startsWith('http')) {
            nextUrl = new URL(locationHeader, currentUrl).href;
          } else {
            nextUrl = locationHeader;
          }
          console.log(
            `[followRedirect] ⚠️ 200响应中包含Location头，继续跟踪: ${nextUrl}`
          );
          currentUrl = nextUrl;
          redirectCount++;
          continue;
        }

        // 如果Content-Type是video/mp4，且没有Location头
        // 说明这是一个MP4视频文件（可能是试看片段），虽然不是m3u8，但也可以播放
        if (contentType.includes('video/mp4')) {
          console.log(
            `[followRedirect] ⚠️ 收到MP4内容（可能是试看片段），URL: ${currentUrl}`
          );
          console.log(
            `[followRedirect] ⚠️ 虽然不是m3u8格式，但可以作为视频URL返回`
          );
          // 返回MP4 URL，让播放器尝试播放
          return currentUrl;
        }

        // 读取响应内容（但只读取前几KB，避免读取整个视频文件）
        const contentLength = parseInt(
          response.headers.get('Content-Length') || '0',
          10
        );
        let content: string;

        if (contentLength > 100000) {
          // 如果内容太大（可能是视频文件），只读取前1KB
          const buffer = await response.arrayBuffer();
          const textDecoder = new TextDecoder('utf-8', { fatal: false });
          content = textDecoder.decode(buffer.slice(0, 1024));
          console.log(
            `[followRedirect] 响应内容过大(${contentLength}字节)，只读取前1KB用于检查`
          );
        } else {
          content = await response.text();
        }

        console.log(
          `[followRedirect] 检查响应 - URL: ${currentUrl}, ContentType: ${contentType}, ContentLength: ${
            contentLength || content.length
          }, 前200字符: ${content.substring(0, 200)}`
        );

        // 检查是否是m3u8格式
        if (content.trim().startsWith('#EXTM3U')) {
          console.log(`[followRedirect] ✓ 找到m3u8内容: ${currentUrl}`);
          return currentUrl;
        }

        // 尝试从响应中提取m3u8链接（多种模式）
        const m3u8Patterns = [
          /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi, // 标准m3u8链接
          /(https?:\/\/[^\s"'<>]+m3u8[^\s"'<>]*)/gi, // 包含m3u8的链接
          /["']([^"']+\.m3u8[^"']*)["']/gi, // 引号内的m3u8链接
          /url\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/gi, // url字段中的m3u8链接
          /src\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/gi, // src字段中的m3u8链接
        ];

        for (const pattern of m3u8Patterns) {
          const matches = content.match(pattern);
          if (matches && matches.length > 0) {
            // 提取第一个匹配的URL（去掉引号）
            let m3u8Url = matches[0].replace(/^["']|["']$/g, '');
            // 如果匹配包含完整URL，提取URL部分
            const urlMatch = m3u8Url.match(/(https?:\/\/[^\s"'<>]+)/);
            if (urlMatch) {
              m3u8Url = urlMatch[1];
            }
            console.log(`[followRedirect] 从内容中提取到m3u8链接: ${m3u8Url}`);
            // 递归调用获取实际的m3u8内容
            return followRedirectToFinalM3u8(
              m3u8Url,
              maxRedirects - redirectCount
            );
          }
        }

        // 检查URL是否包含m3u8
        if (currentUrl.includes('.m3u8') || currentUrl.includes('m3u8')) {
          console.log(`[followRedirect] URL包含m3u8，直接返回: ${currentUrl}`);
          return currentUrl;
        }

        // 如果响应是HTML，尝试查找JavaScript变量中的m3u8链接
        if (
          contentType.includes('text/html') ||
          contentType.includes('application/javascript')
        ) {
          const jsPatterns = [
            /var\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*["']([^"']+\.m3u8[^"']*)["']/gi,
            /let\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*["']([^"']+\.m3u8[^"']*)["']/gi,
            /const\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*["']([^"']+\.m3u8[^"']*)["']/gi,
            /["']([^"']+\.m3u8[^"']*)["']/gi, // 通用引号内的m3u8
          ];

          for (const pattern of jsPatterns) {
            const matches = content.match(pattern);
            if (matches && matches.length > 0) {
              let m3u8Url = matches[0].replace(/^["']|["']$/g, '');
              const urlMatch = m3u8Url.match(/(https?:\/\/[^\s"'<>]+)/);
              if (urlMatch) {
                m3u8Url = urlMatch[1];
                console.log(
                  `[followRedirect] 从JavaScript中提取到m3u8链接: ${m3u8Url}`
                );
                return followRedirectToFinalM3u8(
                  m3u8Url,
                  maxRedirects - redirectCount
                );
              }
            }
          }
        }

        console.error(
          `[followRedirect] 无法从响应中提取m3u8链接 - URL: ${currentUrl}, ContentType: ${contentType}, ContentPreview: ${content.substring(
            0,
            500
          )}`
        );
        throw new Error(
          `无法获取最终的m3u8地址: 响应状态200，但未找到m3u8链接`
        );
      }

      throw new Error(`无法获取最终的m3u8地址: ${response.status}`);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('请求超时');
      }
      throw error;
    }
  }

  throw new Error('重定向次数过多');
}

/**
 * 执行完整的解密流程
 */
async function decryptVideo(
  parserUrl: string,
  videoUrl: string
): Promise<string> {
  // 步骤1: 获取iframe URL
  const iframeUrl = await getIframeUrl(parserUrl, videoUrl);

  // 步骤2: 访问iframe页面并提取ConFig
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(iframeUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        Referer: parserUrl,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`访问iframe页面失败: ${response.status}`);
    }

    const html = await response.text();
    const config = extractConfigFromHtml(html);

    if (!config) {
      throw new Error('未能提取ConFig对象');
    }

    // 步骤3: 解密URL
    const decryptedUrl = decryptUrl(config.url, config.uid);
    if (!decryptedUrl) {
      throw new Error('解密失败');
    }

    console.log(`[decryptVideo] 解密后的URL: ${decryptedUrl}`);

    // 步骤4: 跟踪重定向
    const finalM3u8 = await followRedirectToFinalM3u8(decryptedUrl);
    console.log(`[decryptVideo] ✓ 最终m3u8地址: ${finalM3u8}`);

    return finalM3u8;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: DecryptRequest = await request.json();

    // 验证输入
    if (!body.parserUrl || !body.videoUrl) {
      return NextResponse.json(
        {
          success: false,
          error: '参数缺失：parserUrl 和 videoUrl 都是必需的',
        },
        { status: 400 }
      );
    }

    // 检查缓存
    const cacheKey = getCacheKey(body.parserUrl, body.videoUrl);
    const cachedResult = await getCachedResult(cacheKey);
    if (cachedResult) {
      return NextResponse.json({
        success: true,
        m3u8Url: cachedResult,
        cached: true,
      });
    }

    // 执行解密
    const m3u8Url = await decryptVideo(body.parserUrl, body.videoUrl);

    // 保存到缓存
    await saveToCache(cacheKey, m3u8Url);

    return NextResponse.json({
      success: true,
      m3u8Url,
      cached: false,
    });
  } catch (error) {
    console.error('解密失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '解密失败，请稍后重试',
      },
      { status: 500 }
    );
  }
}
