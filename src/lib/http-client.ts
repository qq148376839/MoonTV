/**
 * HTTP客户端工具 - 使用 Node.js 原生 http/https 模块
 * 用于解决 fetch API 无法访问内网地址的问题
 * 
 * ⚠️ 注意：此模块只能在服务器端使用（API Routes），不能在客户端使用
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: Buffer;
  ok: boolean;
}

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
  method?: string;
}

/**
 * 使用 Node.js 原生 http/https 模块发送 HTTP 请求
 * 解决 fetch API 无法访问内网地址的问题
 * 
 * @param url 目标URL
 * @param options 请求选项
 * @returns Promise<HttpResponse> 响应对象
 */
export async function httpRequest(
  url: string,
  options: HttpRequestOptions = {}
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    let urlObj: URL;
    try {
      urlObj = new URL(url);
    } catch (error) {
      reject(new Error(`Invalid URL: ${url}`));
      return;
    }

    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;

    const port = urlObj.port 
      ? parseInt(urlObj.port, 10) 
      : (isHttps ? 443 : 80);

    const requestOptions: http.RequestOptions = {
      hostname: urlObj.hostname,
      port: port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        ...options.headers,
      },
      // 设置超时时间（默认30秒）
      timeout: options.timeout || 30000,
    };

    // 对于内网地址，确保使用正确的网络接口
    // 如果 hostname 是 IP 地址，直接使用，避免 DNS 解析问题
    if (/^\d+\.\d+\.\d+\.\d+$/.test(urlObj.hostname)) {
      // IP 地址，不需要 DNS 解析
      requestOptions.hostname = urlObj.hostname;
    }

    const req = client.request(requestOptions, (res) => {
      const chunks: Buffer[] = [];
      const headers: Record<string, string> = {};

      // 收集响应头
      Object.keys(res.headers).forEach((key) => {
        const value = res.headers[key];
        if (value) {
          headers[key] = Array.isArray(value) ? value.join(', ') : value;
        }
      });

      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const status = res.statusCode || 200;
        
        resolve({
          status,
          statusText: res.statusMessage || '',
          headers,
          body,
          ok: status >= 200 && status < 300,
        });
      });
    });

    req.on('error', (error: Error) => {
      // 提供更详细的错误信息
      const errorMessage = error.message || String(error);
      const enhancedError = new Error(
        `HTTP request failed: ${errorMessage} (URL: ${url.substring(0, 100)})`
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (enhancedError as any).originalError = error;
      reject(enhancedError);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout after ${requestOptions.timeout}ms (URL: ${url.substring(0, 100)})`));
    });

    // 发送请求
    req.end();
  });
}

/**
 * 获取文本内容（用于 M3U8 文件）
 */
export async function httpGetText(
  url: string,
  options: HttpRequestOptions = {}
): Promise<string> {
  const response = await httpRequest(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.body.toString('utf-8');
}

/**
 * 获取二进制内容（用于 TS 文件）
 */
export async function httpGetBuffer(
  url: string,
  options: HttpRequestOptions = {}
): Promise<Buffer> {
  const response = await httpRequest(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.body;
}

/**
 * 获取响应头（用于检查 Content-Type 等）
 */
export async function httpGetHeaders(
  url: string,
  options: HttpRequestOptions = {}
): Promise<Record<string, string>> {
  const response = await httpRequest(url, { ...options, method: 'HEAD' });
  return response.headers;
}
