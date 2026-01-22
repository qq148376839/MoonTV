/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getStorageManager } from '@/lib/local-storage';
import { PathUtils } from '@/lib/path-utils';
import { getResourceDetector } from '@/lib/resource-detector';

export const runtime = 'nodejs'; // 需要文件系统访问，使用 Node.js runtime
export const dynamic = 'force-dynamic'; // 强制动态渲染，因为使用了 request.url

/**
 * GET /api/local-resource - 检测本地资源是否存在
 */
export async function GET(request: NextRequest) {
  try {
    const resourceDetector = getResourceDetector();
    const storageManager = getStorageManager();
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const id = searchParams.get('id');

    if (!source || !id) {
      return NextResponse.json(
        { error: '缺少必要参数: source 和 id' },
        { status: 400 }
      );
    }

    // 检查资源是否存在
    const resourceInfo = await resourceDetector.checkResource(source, id);

    if (!resourceInfo.exists) {
      return NextResponse.json(
        {
          exists: false,
          message: '资源不存在',
        },
        { status: 200 }
      );
    }

    // OrionTV/按需播放下载兼容：提供“每集是否完整下载”的判定与 m3u8 路径（不完整则应走在线）
    // - downloaded_episodes: boolean[]，长度与 metadata.episodes 对齐（1-based episodeIndex => [episodeIndex-1]）
    // - episode_m3u8_paths: string[]，每集对应 episode_XX.m3u8 的 project-relative 路径（若不存在则为空字符串）
    const downloadedEpisodes: boolean[] = [];
    const episodeM3u8Paths: string[] = [];
    try {
      if (storageManager.isEnabled() && resourceInfo.metadata) {
        const total = Array.isArray(resourceInfo.metadata.episodes)
          ? resourceInfo.metadata.episodes.length
          : 0;

        // 尝试从 index 推导资源目录（与 StorageManager.isEpisodeDownloaded 的口径保持一致）
        const index = storageManager.readIndex();
        const key = `${source}_${id}`;
        const entry = index[key];
        const resourcePath = entry
          ? PathUtils.resolveResourcePath(entry.local_path, storageManager.getStoragePath())
          : null;

        for (let ep = 1; ep <= total; ep++) {
          const ok = storageManager.isEpisodeDownloaded(source, id, ep);
          downloadedEpisodes.push(ok);

          if (resourcePath) {
            const epNo = String(ep).padStart(2, '0');
            const m3u8Abs = `${resourcePath}/episode_${epNo}.m3u8`;
            // 返回 project-relative（更适配 local-video 的安全检查）
            const rel = PathUtils.resolveResourcePath(m3u8Abs).replace(/\\/g, '/');
            // 注意：这里 rel 是“规范化后的绝对路径”，PathUtils.resolveResourcePath 对绝对路径会原样返回
            // local-video 支持绝对路径（且会校验必须在 storagePath 内）
            episodeM3u8Paths.push(rel);
          } else {
            episodeM3u8Paths.push('');
          }
        }
      }
    } catch (e) {
      // best-effort; don't block response
    }

    // 返回资源信息
    return NextResponse.json(
      {
        exists: true,
        metadata: resourceInfo.metadata,
        local_path: resourceInfo.localPath,
        sources: resourceInfo.sources,
        downloaded_episodes: downloadedEpisodes,
        episode_m3u8_paths: episodeM3u8Paths,
      },
      {
        status: 200,
        headers: {
          // 确保播放页/调试时每次都拿到最新的 metadata（避免浏览器/中间层缓存）
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error('[Local Resource API] 检测资源失败:', error);
    return NextResponse.json(
      {
        error: '检测资源失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
