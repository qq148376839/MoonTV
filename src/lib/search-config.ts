/**
 * 搜索 API 配置
 * 支持使用 Cloudflare Worker 或本地 API
 */

/**
 * 获取搜索 API 的基础 URL
 * 如果配置了 NEXT_PUBLIC_CF_SEARCH_WORKER_URL，则使用 Cloudflare Worker
 * 否则使用本地 API
 */
export function getSearchApiBaseUrl(): string {
  // 检查是否配置了 Cloudflare Worker URL
  const cfWorkerUrl = process.env.NEXT_PUBLIC_CF_SEARCH_WORKER_URL;

  if (cfWorkerUrl && cfWorkerUrl.trim()) {
    // 移除末尾的斜杠（如果有）
    return cfWorkerUrl.replace(/\/$/, '');
  }

  // 默认使用本地 API
  return '';
}

/**
 * 获取流式搜索 API 的完整 URL
 */
export function getStreamSearchUrl(query: string): string {
  const baseUrl = getSearchApiBaseUrl();

  if (baseUrl) {
    // 使用 Cloudflare Worker
    return `${baseUrl}?q=${encodeURIComponent(query)}`;
  }

  // 使用本地 API
  return `/api/search/stream?q=${encodeURIComponent(query)}`;
}

/**
 * 获取普通搜索 API 的完整 URL
 */
export function getSearchUrl(query: string): string {
  const baseUrl = getSearchApiBaseUrl();

  if (baseUrl) {
    // 使用 Cloudflare Worker（注意：Worker 只支持流式，这里返回流式 URL）
    return `${baseUrl}?q=${encodeURIComponent(query)}`;
  }

  // 使用本地 API
  return `/api/search?q=${encodeURIComponent(query)}`;
}
