/**
 * Client-safe utilities for deciding whether to proxy a media URL through
 * our same-origin proxy endpoint to avoid CORS.
 */
export type ProxyFlag = boolean | undefined;

export function parseProxyFlag(value: string | null): ProxyFlag {
  if (value == null) return undefined;
  const v = value.trim().toLowerCase();
  if (v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on')
    return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return undefined;
}

export function isProxyM3u8Url(url: string): boolean {
  return url.startsWith('/api/proxy/m3u8');
}

export function isLocalApiUrl(url: string): boolean {
  return url.startsWith('/api/');
}

export function isAbsoluteHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

export function isPrivateIpHost(hostname: string): boolean {
  if (!hostname) return false;
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (host.startsWith('192.168.')) return true;
  if (host.startsWith('10.')) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)) return true;
  if (host.startsWith('169.254.')) return true; // link-local
  return false;
}

export function isPrivateIpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return isPrivateIpHost(u.hostname);
  } catch {
    return false;
  }
}

export function shouldProxyMediaUrl(url: string): boolean {
  if (!url) return false;
  if (isProxyM3u8Url(url) || isLocalApiUrl(url)) return false;
  if (!isAbsoluteHttpUrl(url)) return false;

  // Same-origin URLs are not representable here (absolute URL would include the current origin),
  // so we use a heuristic: localhost/127.0.0.1 are treated as local and not forced through proxy.
  // Everything else (public domain or private IP) is proxied to avoid CORS.
  if (url.includes('localhost') || url.includes('127.0.0.1')) return false;
  return true;
}

export function buildProxyM3u8Url(targetUrl: string, clean?: boolean): string {
  const cleanValue = clean ? '1' : '0';
  return `/api/proxy/m3u8?url=${encodeURIComponent(targetUrl)}&clean=${cleanValue}`;
}

export function convertToProxyM3u8UrlIfNeeded(
  url: string,
  options: { proxyEnabled: boolean; clean?: boolean }
): string {
  if (!options.proxyEnabled) return url;
  if (isProxyM3u8Url(url) || isLocalApiUrl(url)) return url;
  if (!shouldProxyMediaUrl(url)) return url;
  return buildProxyM3u8Url(url, options.clean);
}

