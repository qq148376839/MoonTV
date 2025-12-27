/**
 * 官方解析器解密工具
 * 参考 final_direct_parser_v2.py 的实现
 */
/* eslint-disable no-console */

import crypto from 'crypto';

import { getStorage } from './db';

// DecryptConfig and DecryptResult interfaces are kept for future use
// eslint-disable-next-line unused-imports/no-unused-vars
interface DecryptConfig {
  url: string; // 加密的URL
  uid: string; // 用户ID
}

// eslint-disable-next-line unused-imports/no-unused-vars
interface DecryptResult {
  success: boolean;
  m3u8Url?: string;
  error?: string;
}

// Storage 接口定义（用于缓存）
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

// 默认解析器 URL
export const DEFAULT_PARSER_URL = 'https://jx.789jiexi.com';

// 单个 URL 解密超时时间（10秒）
const DECRYPT_TIMEOUT = 10000;

/**
 * 解密ConFig.url
 * 使用AES-CBC解密，PKCS7填充
 */
export function decryptUrl(encryptedUrl: string, uid: string): string | null {
  // 清理转义字符（HTML中的 \/ 需要转换为 /）
  const cleanedUrl = encryptedUrl.replace(/\\\//g, '/');

  // Key生成方式
  const keyStr = '2890' + uid + 'tB959C';
  const keyBytes = Buffer.from(keyStr, 'utf-8');

  // 尝试不同的密钥生成方式
  const keyMethods: Array<{ name: string; key: Buffer }> = [];

  // 方式1: 直接使用UTF-8字节（如果长度正好是16/24/32）
  if (
    keyBytes.length === 16 ||
    keyBytes.length === 24 ||
    keyBytes.length === 32
  ) {
    keyMethods.push({ name: '直接UTF-8', key: keyBytes });
  }

  // 方式2: MD5哈希（16字节）
  keyMethods.push({
    name: 'MD5哈希',
    key: crypto.createHash('md5').update(keyBytes).digest(),
  });

  // 方式3: SHA256哈希（前16字节）
  keyMethods.push({
    name: 'SHA256前16字节',
    key: crypto.createHash('sha256').update(keyBytes).digest().slice(0, 16),
  });

  // 方式4: SHA256哈希（前24字节）
  if (keyBytes.length !== 24) {
    keyMethods.push({
      name: 'SHA256前24字节',
      key: crypto.createHash('sha256').update(keyBytes).digest().slice(0, 24),
    });
  }

  // 方式5: SHA256哈希（前32字节）
  if (keyBytes.length !== 32) {
    keyMethods.push({
      name: 'SHA256前32字节',
      key: crypto.createHash('sha256').update(keyBytes).digest().slice(0, 32),
    });
  }

  // IV生成方式
  const ivStr = '2F131BE91247866E';
  const ivMethods: Array<{ name: string; iv: Buffer }> = [
    { name: 'UTF-8编码(16字节)', iv: Buffer.from(ivStr, 'utf-8') },
    { name: '十六进制解析(8字节)', iv: Buffer.from(ivStr, 'hex') },
    {
      name: '十六进制解析+填充',
      iv: Buffer.concat([Buffer.from(ivStr, 'hex'), Buffer.alloc(8, 0)]),
    },
    {
      name: '重复填充',
      iv: Buffer.concat([
        Buffer.from(ivStr, 'hex'),
        Buffer.from(ivStr, 'hex'),
      ]).slice(0, 16),
    },
  ];

  // Base64解码
  let encryptedData: Buffer;
  try {
    encryptedData = Buffer.from(cleanedUrl, 'base64');
    if (encryptedData.length % 16 !== 0) {
      console.error('加密数据长度不是16的倍数');
      return null;
    }
  } catch (e) {
    console.error('Base64解码失败:', e);
    return null;
  }

  // 尝试所有组合
  for (const keyMethod of keyMethods) {
    // 确保key长度正确
    let key = keyMethod.key;
    if (key.length < 16) {
      key = Buffer.concat([key, Buffer.alloc(16 - key.length, 0)]);
    } else if (key.length > 16 && key.length < 24) {
      // 尝试截断到16或填充到24
      const key16 = key.slice(0, 16);
      const key24 = Buffer.concat([key, Buffer.alloc(24 - key.length, 0)]);
      keyMethods.push({ name: `${keyMethod.name}(截断到16)`, key: key16 });
      keyMethods.push({ name: `${keyMethod.name}(填充到24)`, key: key24 });
      continue;
    } else if (key.length > 24 && key.length < 32) {
      const key24 = key.slice(0, 24);
      const key32 = Buffer.concat([key, Buffer.alloc(32 - key.length, 0)]);
      keyMethods.push({ name: `${keyMethod.name}(截断到24)`, key: key24 });
      keyMethods.push({ name: `${keyMethod.name}(填充到32)`, key: key32 });
      continue;
    }

    if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
      continue;
    }

    for (const ivMethod of ivMethods) {
      // 确保IV长度为16字节
      let iv = ivMethod.iv;
      if (iv.length < 16) {
        iv = Buffer.concat([iv, Buffer.alloc(16 - iv.length, 0)]);
      } else if (iv.length > 16) {
        iv = iv.slice(0, 16);
      }

      try {
        // AES-CBC解密
        const decipher = crypto.createDecipheriv(
          'aes-128-cbc',
          key.slice(0, 16),
          iv
        );
        let decrypted = Buffer.concat([
          decipher.update(encryptedData),
          decipher.final(),
        ]);

        // 尝试移除PKCS7填充
        try {
          const paddingLen = decrypted[decrypted.length - 1];
          if (paddingLen > 0 && paddingLen <= 16) {
            decrypted = decrypted.slice(0, decrypted.length - paddingLen);
          }
        } catch (e) {
          // 填充移除失败，尝试手动移除
          const paddingLen = decrypted[decrypted.length - 1];
          if (paddingLen > 0 && paddingLen <= 16) {
            decrypted = decrypted.slice(0, decrypted.length - paddingLen);
          }
        }

        const result = decrypted.toString('utf-8');

        if (result.startsWith('http')) {
          console.log(
            `解密成功！密钥方式: ${keyMethod.name}, IV方式: ${ivMethod.name}`
          );
          return result;
        } else if (
          result.includes('http') ||
          result.includes('.m3u8') ||
          result.toLowerCase().includes('m3u8')
        ) {
          console.warn(
            `解密成功但结果不是标准URL: ${result.substring(0, 200)}`
          );
        }
      } catch (e) {
        // 静默失败，继续尝试下一个组合
        continue;
      }
    }
  }

  console.error('所有解密组合都失败了');
  return null;
}

/**
 * 移除PKCS7填充
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _unpadPKCS7(data: Buffer): Buffer {
  const paddingLen = data[data.length - 1];
  if (paddingLen > 0 && paddingLen <= 16) {
    return data.slice(0, data.length - paddingLen);
  }
  return data;
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
    console.warn('[decrypt] 获取缓存失败:', error);
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
    console.warn('[decrypt] 保存缓存失败:', error);
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
 * 执行完整的解密流程（内部函数）
 */
async function decryptVideoInternal(
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

    console.log(`[decryptVideoInternal] 解密后的URL: ${decryptedUrl}`);

    // 步骤4: 跟踪重定向
    const finalM3u8 = await followRedirectToFinalM3u8(decryptedUrl);
    console.log(`[decryptVideoInternal] ✓ 最终m3u8地址: ${finalM3u8}`);

    return finalM3u8;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * 检测是否在 Edge Runtime 环境中
 */
function isEdgeRuntime(): boolean {
  try {
    // Edge Runtime 中没有 process.versions.node
    return typeof process === 'undefined' || !process.versions?.node;
  } catch {
    // 如果访问 process 抛出错误，说明是 Edge Runtime
    return true;
  }
}

/**
 * 获取基础 URL（用于构建 API 路径）
 * @param requestUrl 可选的请求 URL，用于提取 origin
 */
function getBaseUrl(requestUrl?: string): string {
  // 如果提供了请求 URL，从中提取 origin
  if (requestUrl) {
    try {
      const url = new URL(requestUrl);
      let origin = url.origin;

      // 修复：将 0.0.0.0 替换为 localhost
      if (origin.includes('0.0.0.0')) {
        origin = origin.replace('0.0.0.0', 'localhost');
      }

      return origin;
    } catch {
      // 如果解析失败，继续使用其他方式
    }
  }

  // 优先使用环境变量
  try {
    if (process.env.NEXT_PUBLIC_BASE_URL) {
      return process.env.NEXT_PUBLIC_BASE_URL;
    }
  } catch {
    // Edge Runtime 中可能无法访问 process.env
  }

  // 浏览器环境
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  // Vercel 环境
  try {
    if (process.env.VERCEL_URL) {
      return `https://${process.env.VERCEL_URL}`;
    }
  } catch {
    // Edge Runtime 中可能无法访问 process.env
  }

  // 默认值（开发环境）
  return 'http://localhost:51000';
}

/**
 * 解密单个剧集 URL（内部调用，不通过 HTTP）
 * @param parserUrl 解析器 URL（默认：https://jx.789jiexi.com）
 * @param videoUrl 第三方视频网站 URL
 * @param useHttpApi 是否强制使用 HTTP API（用于 Edge Runtime）
 * @param requestUrl 可选的请求 URL，用于获取 base URL
 * @returns Promise<string> 解密后的 m3u8 或 MP4 地址，失败返回原始 URL（保证数据可用性）
 */
export async function decryptEpisodeUrl(
  parserUrl: string,
  videoUrl: string,
  useHttpApi = false,
  requestUrl?: string
): Promise<string> {
  // Edge Runtime 环境或强制使用 HTTP API 时，通过 HTTP 调用解密 API
  if (useHttpApi || isEdgeRuntime()) {
    try {
      // 获取当前请求的基础 URL（用于构建 API 路径）
      const baseUrl = getBaseUrl(requestUrl);

      console.log(
        `[decryptEpisodeUrl] 通过 HTTP API 调用解密: ${baseUrl}/api/decrypt`
      );

      const response = await fetch(`${baseUrl}/api/decrypt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parserUrl,
          videoUrl,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`解密 API 请求失败: ${response.status} ${errorText}`);
      }

      const result = await response.json();

      if (result.success && result.m3u8Url) {
        return result.m3u8Url;
      } else {
        // 解密失败，抛出错误（不返回原始 URL，因为无法播放）
        console.error(
          `[decryptEpisodeUrl] HTTP API 解密失败: ${videoUrl}`,
          result.error
        );
        throw new Error(result.error || '解密失败');
      }
    } catch (error) {
      // HTTP 调用失败，抛出错误（不返回原始 URL，因为无法播放）
      console.error(
        `[decryptEpisodeUrl] HTTP API 调用失败: ${videoUrl}`,
        error instanceof Error ? error.message : error
      );
      throw error;
    }
  }

  // Node.js Runtime 环境，直接调用内部函数
  // 检查缓存
  const cacheKey = getCacheKey(parserUrl, videoUrl);
  const cachedResult = await getCachedResult(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }

  // 使用 Promise.race 实现超时控制
  const decryptPromise = decryptVideoInternal(parserUrl, videoUrl);
  const timeoutPromise = new Promise<string>((_, reject) => {
    setTimeout(() => {
      reject(new Error('解密超时'));
    }, DECRYPT_TIMEOUT);
  });

  try {
    const result = await Promise.race([decryptPromise, timeoutPromise]);
    // 保存到缓存
    await saveToCache(cacheKey, result);
    return result;
  } catch (error) {
    // 解密失败，抛出错误（不返回原始 URL，因为无法播放）
    console.error(
      `[decryptEpisodeUrl] 解密失败: ${videoUrl}`,
      error instanceof Error ? error.message : error
    );
    throw error;
  }
}

/**
 * 批量解密剧集 URL
 * @param parserUrl 解析器 URL
 * @param videoUrls 第三方视频网站 URL 数组
 * @param useHttpApi 是否强制使用 HTTP API（用于 Edge Runtime）
 * @param requestUrl 可选的请求 URL，用于获取 base URL
 * @returns Promise<string[]> 解密后的 URL 数组，失败项返回原始 URL（保证数据可用性）
 */
export async function decryptEpisodeUrls(
  parserUrl: string,
  videoUrls: string[],
  useHttpApi = false,
  requestUrl?: string
): Promise<string[]> {
  if (videoUrls.length === 0) {
    return [];
  }

  // 使用 Promise.allSettled 并发解密，确保单个失败不影响其他
  const decryptPromises = videoUrls.map((videoUrl) =>
    decryptEpisodeUrl(parserUrl, videoUrl, useHttpApi, requestUrl)
  );

  const results = await Promise.allSettled(decryptPromises);

  // 处理结果，失败时返回空字符串（因为非解密的 URL 无法播放）
  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      // 检查是否返回了原始 URL（表示解密失败）
      if (result.value === videoUrls[index]) {
        // 解密失败，返回空字符串
        console.error(
          `[decryptEpisodeUrls] URL[${index}] 解密失败（返回原始URL）:`,
          videoUrls[index]
        );
        return '';
      }
      return result.value;
    } else {
      // 解密失败，返回空字符串（因为无法播放）
      console.error(
        `[decryptEpisodeUrls] URL[${index}] 解密失败:`,
        videoUrls[index],
        result.reason
      );
      return '';
    }
  });
}
