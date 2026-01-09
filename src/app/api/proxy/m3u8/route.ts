import { NextRequest, NextResponse } from 'next/server';

import { httpRequest } from '@/lib/http-client';
import { M3U8Cleaner } from '@/lib/m3u8-cleaner';

export const runtime = 'nodejs'; // 需要访问内网地址，使用 Node.js runtime

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get('url');

  if (!url) {
    return new NextResponse('Missing url parameter', { status: 400 });
  }

  try {
    // 使用 Node.js 原生 http/https 模块替代 fetch，解决内网地址访问问题
    const response = await httpRequest(url, {
      timeout: 30000, // 30秒超时
    });

    if (!response.ok) {
      return new NextResponse(`Failed to fetch source: ${response.status}`, {
        status: response.status,
      });
    }

    const contentType = response.headers['content-type'] || '';
    
    // 检查是否是TS片段文件（.ts文件）
    const isTsFile = url.endsWith('.ts') || contentType.includes('video/mp2t') || contentType.includes('application/octet-stream');
    
    if (isTsFile) {
      // TS文件是二进制文件，使用Buffer
      return new NextResponse(response.body, {
        headers: {
          'Content-Type': contentType || 'video/mp2t',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }
    
    // M3U8文件是文本文件，使用text
    const content = response.body.toString('utf-8');

    // Check if it's an M3U8 file
    if (
      (contentType && contentType.includes('application/vnd.apple.mpegurl')) ||
      (contentType && contentType.includes('application/x-mpegurl')) ||
      content.includes('#EXTM3U')
    ) {
      // Clean the M3U8 content
      let cleanedContent = M3U8Cleaner.clean(content, url);
      
      // 将m3u8文件中的所有TS片段URL也转换为代理URL，解决CORS问题
      // 获取当前请求的origin，用于构建代理URL
      // 优先使用 Host 头，避免使用 0.0.0.0 这样的无效地址
      let origin = request.headers.get('origin');
      
      if (!origin) {
        // 如果没有 origin 头，尝试从 Host 头构建
        const host = request.headers.get('host');
        if (host) {
          // 从 request.nextUrl 获取协议
          const protocol = request.nextUrl.protocol;
          origin = `${protocol}//${host}`;
        } else {
          // 最后才使用 request.nextUrl 的 origin
          origin = request.nextUrl.origin;
          // 如果 origin 包含 0.0.0.0，替换为 localhost
          if (origin.includes('0.0.0.0')) {
            origin = origin.replace('0.0.0.0', 'localhost');
          }
        }
      }
      
      const proxyBaseUrl = `${origin}/api/proxy/m3u8`;
      
      // 替换m3u8文件中的所有URL为代理URL
      const lines = cleanedContent.split('\n');
      const proxiedLines = lines.map((line) => {
        const trimmedLine = line.trim();
        // 跳过注释和空行
        if (trimmedLine.startsWith('#') || trimmedLine.length === 0) {
          return line;
        }
        
        // 如果是URL行（不以#开头且不是空行）
        if (trimmedLine.startsWith('http://') || trimmedLine.startsWith('https://')) {
          // 已经是绝对URL，转换为代理URL
          const proxiedUrl = `${proxyBaseUrl}?url=${encodeURIComponent(trimmedLine)}`;
          return proxiedUrl;
        } else {
          // 相对URL，先解析为绝对URL，再转换为代理URL
          try {
            const absoluteUrl = new URL(trimmedLine, url).href;
            const proxiedUrl = `${proxyBaseUrl}?url=${encodeURIComponent(absoluteUrl)}`;
            return proxiedUrl;
          } catch (e) {
            // 解析失败，保持原样
            return line;
          }
        }
      });
      
      cleanedContent = proxiedLines.join('\n');

      return new NextResponse(cleanedContent, {
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    // If not M3U8, just return the content as is (or redirect?)
    // For now, let's proxy it but maybe we shouldn't use this endpoint for non-m3u8
    return new NextResponse(content, {
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[proxy] Proxy error:', error);
    
    // 提供更详细的错误信息
    const errorMessage = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalError = (error as any)?.originalError;
    const originalErrorMessage = originalError instanceof Error ? originalError.message : '';
    
    // 检测网络错误类型
    const isNetworkError = 
      errorMessage.includes('ECONNREFUSED') || 
      errorMessage.includes('ENOTFOUND') ||
      errorMessage.includes('ETIMEDOUT') ||
      errorMessage.includes('timeout') ||
      originalErrorMessage.includes('ECONNREFUSED') ||
      originalErrorMessage.includes('ENOTFOUND') ||
      originalErrorMessage.includes('ETIMEDOUT');
    
    if (isNetworkError) {
      // eslint-disable-next-line no-console
      console.error(`[proxy] 网络错误，无法访问目标URL: ${url}`);
      // eslint-disable-next-line no-console
      console.error(`[proxy] 错误详情:`, {
        message: errorMessage,
        originalError: originalErrorMessage,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        code: (originalError as any)?.code,
      });
      
      return new NextResponse(
        JSON.stringify({
          error: '无法访问目标URL',
          message: `网络错误: ${errorMessage}`,
          originalError: originalErrorMessage || undefined,
          url: url.substring(0, 100), // 只返回URL的前100个字符，避免泄露敏感信息
        }),
        {
          status: 502,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }
    
    return new NextResponse(
      JSON.stringify({
        error: '代理请求失败',
        message: errorMessage,
        originalError: originalErrorMessage || undefined,
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}
