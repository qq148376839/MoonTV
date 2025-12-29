/* eslint-disable no-console */

import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

import { getStorageManager } from '@/lib/local-storage';
import { PathUtils } from '@/lib/path-utils';

export const runtime = 'nodejs'; // 需要文件系统访问，使用 Node.js runtime
export const dynamic = 'force-dynamic'; // 强制动态渲染，因为使用了 request.url

/**
 * GET /api/[episode]/[segment] - 处理 HLS.js 解析的相对路径 TS 片段请求
 *
 * 当 M3U8 文件中的相对路径是 episode_01/segment_000.ts 时，
 * HLS.js 会基于 M3U8 的 URL 解析为 /api/episode_01/segment_000.ts
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ episode: string; segment: string }> }
) {
  try {
    const storageManager = getStorageManager();

    if (!storageManager.isEnabled()) {
      return NextResponse.json(
        { error: '本地存储功能未启用' },
        { status: 503 }
      );
    }

    // Next.js 15+ 中 params 是 Promise，需要 await
    const { episode, segment } = await params;

    // 验证参数格式
    const episodePattern = /^episode_\d+$/;
    const segmentPattern = /^segment_\d+\.ts$/;

    if (!episodePattern.test(episode) || !segmentPattern.test(segment)) {
      return NextResponse.json({ error: '无效的路径格式' }, { status: 400 });
    }

    // 构建相对路径：episode_01/segment_000.ts
    const relativePath = `${episode}/${segment}`;

    // 从 Referer 头获取 M3U8 文件的路径
    const referer = request.headers.get('referer');
    let m3u8Path: string | null = null;

    if (referer) {
      try {
        const refererUrl = new URL(referer);
        // 检查是否是播放页面的 Referer（支持 /play 和根路径 /）
        const isPlayPage =
          refererUrl.pathname === '/play' || refererUrl.pathname === '/';

        console.log(
          `[Episode Segment API] 解析 Referer: pathname=${refererUrl.pathname}, isPlayPage=${isPlayPage}, referer=${referer}`
        );

        if (isPlayPage) {
          // 从播放页面获取 source 和 id
          const source = refererUrl.searchParams.get('source');
          const id = refererUrl.searchParams.get('id');

          console.log(
            `[Episode Segment API] 从 Referer 提取参数: source=${source}, id=${id}`
          );

          if (source && id) {
            // 通过 source 和 id 查找资源路径
            const index = storageManager.readIndex();
            const key = `${source}_${id}`;

            console.log(
              `[Episode Segment API] 查找资源索引: key=${key}, indexKeys=${Object.keys(
                index
              ).join(', ')}`
            );

            if (key in index) {
              const indexEntry = index[key];
              const storagePath = storageManager.getStoragePath();
              // 使用 PathUtils 统一处理路径解析
              const resourcePath = PathUtils.resolveResourcePath(
                indexEntry.local_path,
                storagePath
              );

              // 构建 M3U8 文件路径（假设是 episode_01.m3u8）
              const episodeNumber = episode.replace('episode_', '');
              const m3u8FileName = `episode_${episodeNumber.padStart(
                2,
                '0'
              )}.m3u8`;
              m3u8Path = path.join(resourcePath, m3u8FileName);

              console.log(
                `[Episode Segment API] 从 Referer 获取资源路径: ${source}_${id} -> ${m3u8Path}, indexEntry.local_path=${indexEntry.local_path}, storagePath=${storagePath}, resourcePath=${resourcePath}`
              );
            } else {
              console.warn(
                `[Episode Segment API] 资源索引中未找到 key: ${key}, 可用keys: ${Object.keys(
                  index
                ).join(', ')}`
              );
            }
          } else {
            console.warn(
              `[Episode Segment API] Referer 中缺少 source 或 id: source=${source}, id=${id}`
            );
          }
        } else {
          // 尝试从 /api/local-video 的 Referer 中提取路径
          const refererPath = refererUrl.searchParams.get('path');
          if (refererPath) {
            const decodedRefererPath = decodeURIComponent(refererPath);
            if (decodedRefererPath.endsWith('.m3u8')) {
              m3u8Path = decodedRefererPath;
            }
          }
        }
      } catch (error) {
        console.warn('[Episode Segment API] 解析 Referer 失败:', error);
      }
    } else {
      console.warn('[Episode Segment API] 没有 Referer 头');
    }

    const storagePath = storageManager.getStoragePath();
    const resolvedStoragePath = path.resolve(process.cwd(), storagePath);
    const projectRoot = process.cwd();

    let resolvedPath: string | null = null;

    // 策略1：如果从 Referer 获取到了 M3U8 路径，基于它解析 TS 片段路径
    if (m3u8Path) {
      try {
        let m3u8AbsolutePath: string;
        if (path.isAbsolute(m3u8Path)) {
          m3u8AbsolutePath = m3u8Path;
        } else {
          m3u8AbsolutePath = path.resolve(projectRoot, m3u8Path);
        }

        // 验证 M3U8 文件是否存在
        if (!fs.existsSync(m3u8AbsolutePath)) {
          console.warn(
            `[Episode Segment API] M3U8 文件不存在: ${m3u8AbsolutePath}`
          );
        } else {
          const m3u8Dir = path.dirname(m3u8AbsolutePath);
          const segmentPath = path.join(m3u8Dir, relativePath);

          console.log(
            `[Episode Segment API] 尝试解析 TS 片段路径: m3u8Path=${m3u8AbsolutePath}, m3u8Dir=${m3u8Dir}, relativePath=${relativePath}, segmentPath=${segmentPath}`
          );

          if (fs.existsSync(segmentPath)) {
            resolvedPath = segmentPath;
            console.log(
              `[Episode Segment API] ✓ 基于 M3U8 路径解析 TS 片段成功: ${relativePath} -> ${resolvedPath}`
            );
          } else {
            console.warn(
              `[Episode Segment API] TS 片段文件不存在: ${segmentPath}`
            );
          }
        }
      } catch (error) {
        console.warn(
          `[Episode Segment API] 基于 M3U8 路径解析失败: ${m3u8Path}`,
          error
        );
      }
    } else {
      console.warn(
        `[Episode Segment API] 未从 Referer 获取到 M3U8 路径，Referer: ${
          referer || '无'
        }`
      );
    }

    // 策略2：如果策略1失败，遍历存储目录查找（后备方案）
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      try {
        const storageDir = resolvedStoragePath;
        if (fs.existsSync(storageDir)) {
          const resourceDirs = fs.readdirSync(storageDir, {
            withFileTypes: true,
          });
          for (const resourceDir of resourceDirs) {
            if (!resourceDir.isDirectory()) continue;

            const resourcePath = path.join(storageDir, resourceDir.name);
            const episodePath = path.join(resourcePath, episode);

            if (fs.existsSync(episodePath)) {
              const segmentPath = path.join(episodePath, segment);
              if (fs.existsSync(segmentPath)) {
                resolvedPath = segmentPath;
                console.log(
                  `[Episode Segment API] 通过遍历找到 TS 片段: ${relativePath} -> ${resolvedPath}`
                );
                break;
              }
            }
          }
        }
      } catch (error) {
        console.error(
          `[Episode Segment API] 遍历查找 TS 片段失败: ${relativePath}`,
          error
        );
      }
    }

    // 如果还是找不到，返回 404
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      // 策略3：尝试直接从 source 和 id 查找（支持 /play 和根路径 /）
      if (referer) {
        try {
          const refererUrl = new URL(referer);
          const isPlayPage =
            refererUrl.pathname === '/play' || refererUrl.pathname === '/';

          if (isPlayPage) {
            const source = refererUrl.searchParams.get('source');
            const id = refererUrl.searchParams.get('id');

            console.log(
              `[Episode Segment API] 策略3: 从 Referer 提取参数: source=${source}, id=${id}`
            );

            if (source && id) {
              const index = storageManager.readIndex();
              const key = `${source}_${id}`;

              console.log(
                `[Episode Segment API] 策略3: 查找资源索引: key=${key}, indexKeys=${Object.keys(
                  index
                ).join(', ')}`
              );

              if (key in index) {
                const indexEntry = index[key];
                const storagePath = storageManager.getStoragePath();
                const resourcePath = PathUtils.resolveResourcePath(
                  indexEntry.local_path,
                  storagePath
                );

                // 直接构建 TS 片段路径
                const directSegmentPath = path.join(resourcePath, relativePath);

                console.log(
                  `[Episode Segment API] 策略3: 尝试直接路径: indexEntry.local_path=${
                    indexEntry.local_path
                  }, storagePath=${storagePath}, resourcePath=${resourcePath}, relativePath=${relativePath}, directSegmentPath=${directSegmentPath}, exists=${fs.existsSync(
                    directSegmentPath
                  )}`
                );

                if (fs.existsSync(directSegmentPath)) {
                  resolvedPath = directSegmentPath;
                  console.log(
                    `[Episode Segment API] ✓ 策略3: 通过直接路径找到 TS 片段: ${relativePath} -> ${resolvedPath}`
                  );
                } else {
                  console.warn(
                    `[Episode Segment API] ✗ 策略3: TS 片段文件不存在: ${directSegmentPath}`
                  );
                }
              } else {
                console.warn(
                  `[Episode Segment API] ✗ 策略3: 资源索引中未找到 key: ${key}`
                );
              }
            } else {
              console.warn(
                `[Episode Segment API] ✗ 策略3: Referer 中缺少 source 或 id: source=${source}, id=${id}`
              );
            }
          }
        } catch (error) {
          console.warn('[Episode Segment API] 直接路径查找失败:', error);
        }
      }

      // 策略4：如果仍然找不到，尝试从所有资源中查找匹配的 TS 片段（最后的后备方案）
      if (!resolvedPath || !fs.existsSync(resolvedPath)) {
        try {
          const index = storageManager.readIndex();
          const storagePath = storageManager.getStoragePath();

          // 遍历所有资源，查找匹配的 TS 片段
          for (const [key, indexEntry] of Object.entries(index)) {
            const resourcePath = PathUtils.resolveResourcePath(
              indexEntry.local_path,
              storagePath
            );
            const segmentPath = path.join(resourcePath, relativePath);

            if (fs.existsSync(segmentPath)) {
              resolvedPath = segmentPath;
              console.log(
                `[Episode Segment API] ✓ 通过遍历所有资源找到 TS 片段: ${relativePath} -> ${resolvedPath} (资源: ${key})`
              );
              break;
            }
          }
        } catch (error) {
          console.warn('[Episode Segment API] 遍历所有资源查找失败:', error);
        }
      }

      if (!resolvedPath || !fs.existsSync(resolvedPath)) {
        console.error(
          `[Episode Segment API] ✗ 未找到 TS 片段: ${relativePath}, Referer: ${
            referer || '无'
          }, episode=${episode}, segment=${segment}`
        );
        return NextResponse.json(
          { error: 'TS 片段文件不存在' },
          { status: 404 }
        );
      }
    }

    // 确保路径在存储目录内（使用 PathUtils 规范化路径进行比较）
    const normalizedResolvedPath = PathUtils.normalizePath(resolvedPath);
    const normalizedStoragePath = PathUtils.normalizePath(resolvedStoragePath);

    if (!normalizedResolvedPath.startsWith(normalizedStoragePath)) {
      console.error(
        `[Episode Segment API] 路径安全检查失败: resolvedPath=${resolvedPath}, resolvedStoragePath=${resolvedStoragePath}, normalizedResolvedPath=${normalizedResolvedPath}, normalizedStoragePath=${normalizedStoragePath}`
      );
      return NextResponse.json(
        { error: '访问路径不在存储目录内' },
        { status: 403 }
      );
    }

    // 检查是否为文件
    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile()) {
      return NextResponse.json({ error: '路径不是文件' }, { status: 400 });
    }

    // 处理 Range 请求（支持视频拖拽播放）
    const range = request.headers.get('range');
    const fileSize = stats.size;

    // 读取文件
    let start = 0;
    let end = fileSize - 1;
    let status = 200;
    let headers: Record<string, string> = {};

    if (range) {
      // 解析 Range 头
      const parts = range.replace(/bytes=/, '').split('-');
      start = parseInt(parts[0], 10);
      end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        return NextResponse.json(
          { error: 'Range Not Satisfiable' },
          { status: 416 }
        );
      }

      status = 206; // Partial Content
      headers = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
      };
    } else {
      headers = {
        'Content-Length': String(fileSize),
        'Accept-Ranges': 'bytes',
      };
    }

    // 设置 MIME 类型
    headers['Content-Type'] = 'video/mp2t';

    // 读取文件片段
    const fileBuffer = Buffer.alloc(end - start + 1);
    const fileDescriptor = fs.openSync(resolvedPath, 'r');
    fs.readSync(fileDescriptor, fileBuffer, 0, fileBuffer.length, start);
    fs.closeSync(fileDescriptor);

    // 返回响应
    return new NextResponse(fileBuffer, {
      status,
      headers,
    });
  } catch (error) {
    console.error('[Episode Segment API] 处理请求失败:', error);
    return NextResponse.json(
      {
        error: '处理请求失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
