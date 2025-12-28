/* eslint-disable no-console */

import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

import { getStorageManager } from '@/lib/local-storage';

export const runtime = 'nodejs'; // 需要文件系统访问，使用 Node.js runtime

/**
 * GET /api/local-video - 提供本地视频文件的 HTTP 访问
 */
export async function GET(request: NextRequest) {
  try {
    const storageManager = getStorageManager();

    if (!storageManager.isEnabled()) {
      return NextResponse.json(
        { error: '本地存储功能未启用' },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path');

    if (!filePath) {
      return NextResponse.json(
        { error: '缺少必要参数: path' },
        { status: 400 }
      );
    }

    // 解码路径
    const decodedPath = decodeURIComponent(filePath);

    // 安全检查：防止路径遍历攻击
    const storagePath = storageManager.getStoragePath();
    const resolvedStoragePath = path.resolve(process.cwd(), storagePath);

    // 处理路径：可能是相对路径或绝对路径
    let resolvedPath: string;
    if (path.isAbsolute(decodedPath)) {
      // 绝对路径，直接使用
      resolvedPath = decodedPath;
    } else {
      // 相对路径，需要判断是相对于项目根目录还是相对于 M3U8 文件所在目录
      const projectRoot = process.cwd();

      // 检查是否是 M3U8 中的相对路径 TS 片段（格式：episode_XX/segment_XXX.ts）
      const tsSegmentPattern = /^episode_\d+\/segment_\d+\.ts$/;
      if (tsSegmentPattern.test(decodedPath)) {
        // 这是 M3U8 中的相对路径 TS 片段
        // 策略1：尝试从 Referer 头获取 M3U8 文件的路径
        const referer = request.headers.get('referer');
        let m3u8Path: string | null = null;

        if (referer) {
          try {
            const refererUrl = new URL(referer);
            const refererPath = refererUrl.searchParams.get('path');
            if (refererPath) {
              const decodedRefererPath = decodeURIComponent(refererPath);
              // 检查是否是 M3U8 文件
              if (decodedRefererPath.endsWith('.m3u8')) {
                m3u8Path = decodedRefererPath;
                console.log(
                  `[Local Video API] 从 Referer 获取 M3U8 路径: ${m3u8Path}`
                );
              }
            }
          } catch (error) {
            // Referer 解析失败，忽略
            console.warn('[Local Video API] 解析 Referer 失败:', error);
          }
        }

        // 如果从 Referer 获取到了 M3U8 路径，基于它解析 TS 片段路径
        if (m3u8Path) {
          try {
            // 将 M3U8 路径解析为绝对路径
            let m3u8AbsolutePath: string;
            if (path.isAbsolute(m3u8Path)) {
              m3u8AbsolutePath = m3u8Path;
            } else {
              m3u8AbsolutePath = path.resolve(projectRoot, m3u8Path);
            }

            // 获取 M3U8 文件所在目录
            const m3u8Dir = path.dirname(m3u8AbsolutePath);
            // 将 TS 片段相对路径与 M3U8 目录拼接
            const segmentPath = path.join(m3u8Dir, decodedPath);

            if (fs.existsSync(segmentPath)) {
              resolvedPath = segmentPath;
              console.log(
                `[Local Video API] 基于 M3U8 路径解析 TS 片段: ${decodedPath} -> ${resolvedPath}`
              );
            }
          } catch (error) {
            console.warn(
              `[Local Video API] 基于 M3U8 路径解析失败: ${m3u8Path}`,
              error
            );
          }
        }

        // 策略2：如果策略1失败，遍历存储目录查找（后备方案）
        if (!resolvedPath || !fs.existsSync(resolvedPath)) {
          const segmentDir = path.dirname(decodedPath); // episode_01
          const segmentFileName = path.basename(decodedPath); // segment_000.ts

          try {
            const storageDir = resolvedStoragePath;
            if (fs.existsSync(storageDir)) {
              const resourceDirs = fs.readdirSync(storageDir, {
                withFileTypes: true,
              });
              for (const resourceDir of resourceDirs) {
                if (!resourceDir.isDirectory()) continue;

                const resourcePath = path.join(storageDir, resourceDir.name);
                const episodePath = path.join(resourcePath, segmentDir);

                // 检查 episode 目录是否存在，且包含该 TS 片段
                if (fs.existsSync(episodePath)) {
                  const segmentPath = path.join(episodePath, segmentFileName);
                  if (fs.existsSync(segmentPath)) {
                    resolvedPath = segmentPath;
                    console.log(
                      `[Local Video API] 通过遍历找到 TS 片段: ${decodedPath} -> ${resolvedPath}`
                    );
                    break;
                  }
                }
              }
            }
          } catch (error) {
            console.error(
              `[Local Video API] 遍历查找 TS 片段失败: ${decodedPath}`,
              error
            );
          }
        }

        // 如果还是找不到，返回 404
        if (!resolvedPath || !fs.existsSync(resolvedPath)) {
          console.warn(
            `[Local Video API] 未找到 TS 片段: ${decodedPath}, Referer: ${
              referer || '无'
            }`
          );
          return NextResponse.json(
            { error: 'TS 片段文件不存在' },
            { status: 404 }
          );
        }
      } else {
        // 普通相对路径，相对于项目根目录解析
        resolvedPath = path.resolve(projectRoot, decodedPath);
      }
    }

    // 确保路径在存储目录内
    if (!resolvedPath.startsWith(resolvedStoragePath)) {
      console.error(
        `[Local Video API] 路径安全检查失败: resolvedPath=${resolvedPath}, resolvedStoragePath=${resolvedStoragePath}`
      );
      return NextResponse.json(
        { error: '访问路径不在存储目录内' },
        { status: 403 }
      );
    }

    // 检查文件是否存在
    if (!fs.existsSync(resolvedPath)) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
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

    // 确定 MIME 类型
    const ext = path.extname(resolvedPath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.m3u8': 'application/vnd.apple.mpegurl',
      '.ts': 'video/mp2t',
      '.mkv': 'video/x-matroska',
      '.webm': 'video/webm',
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    headers['Content-Type'] = contentType;

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
    console.error('[Local Video API] 处理请求失败:', error);
    return NextResponse.json(
      {
        error: '处理请求失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
