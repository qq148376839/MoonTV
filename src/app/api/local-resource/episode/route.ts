/* eslint-disable no-console */

// 兼容旧接口：DELETE /api/local-resource/episode
// 语义与 /api/local-library/episode 一致：必须删除真实文件；若删除失败则返回 500 且不改 metadata

import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

import { getStorageManager } from '@/lib/local-storage';
import { PathUtils } from '@/lib/path-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function padEpisode(n: number): string {
  return n.toString().padStart(2, '0');
}

async function rmWithRetry(target: string, tries = 3): Promise<null | string> {
  for (let i = 0; i < tries; i++) {
    try {
      if (!fs.existsSync(target)) return null;
      const st = fs.statSync(target);
      if (st.isDirectory()) {
        await fs.promises.rm(target, { recursive: true, force: true });
      } else {
        await fs.promises.rm(target, { force: true });
      }
      if (!fs.existsSync(target)) return null;
    } catch (e) {
      // Windows 上可能被占用，稍后重试
      if (i < tries - 1) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      return e instanceof Error ? e.message : String(e);
    }
  }
  return `无法删除：${target}`;
}

export async function DELETE(request: NextRequest) {
  try {
    const storageManager = getStorageManager();
    if (!storageManager.isEnabled()) {
      return NextResponse.json(
        { error: '本地存储功能未启用' },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || '';
    const id = searchParams.get('id') || '';
    const episodeParam = searchParams.get('episode') || '';
    const episode = Number(episodeParam);

    if (
      !source ||
      !id ||
      !episodeParam ||
      !Number.isFinite(episode) ||
      episode < 1
    ) {
      return NextResponse.json(
        { error: '缺少必要参数: source、id、episode' },
        { status: 400 }
      );
    }

    const index = storageManager.readIndex();
    const key = `${source}_${id}`;
    const entry = index[key];
    if (!entry) {
      return NextResponse.json({ error: '资源不存在' }, { status: 404 });
    }

    const storagePath = storageManager.getStoragePath();
    const localPath = PathUtils.resolveResourcePath(
      entry.local_path,
      storagePath
    );
    if (!fs.existsSync(localPath)) {
      return NextResponse.json({ error: '资源目录不存在' }, { status: 404 });
    }

    const epNo = padEpisode(episode);
    const prefix = `episode_${epNo}`;
    const targets: string[] = [];

    // 1) metadata 指向的真实文件（优先）
    const metadata = storageManager.readMetadata(localPath);
    const recorded = metadata?.episodes?.[episode - 1];
    if (
      recorded &&
      typeof recorded === 'string' &&
      recorded.trim().length > 0
    ) {
      let abs: string;
      if (path.isAbsolute(recorded)) abs = recorded;
      else if (
        PathUtils.startsWith(recorded, 'data/videos') ||
        PathUtils.startsWith(recorded, './data/videos')
      ) {
        abs = PathUtils.resolveResourcePath(recorded);
      } else {
        abs = path.join(localPath, recorded);
      }
      targets.push(abs);
    }

    // 2) 约定命名：episode_XX 目录 + episode_XX.* 文件
    targets.push(path.join(localPath, prefix));
    for (const f of fs.readdirSync(localPath)) {
      const p = path.join(localPath, f);
      if (f.startsWith(prefix) && fs.statSync(p).isFile()) {
        targets.push(p);
      }
    }

    // 去重
    const uniq = Array.from(new Set(targets));
    const failed: Array<{ path: string; error: string }> = [];
    const removed: string[] = [];

    for (const t of uniq) {
      if (!fs.existsSync(t)) continue;
      const err = await rmWithRetry(t, 3);
      if (err) failed.push({ path: t, error: err });
      else removed.push(t);
    }

    if (failed.length > 0) {
      return NextResponse.json(
        {
          error: '删除单集失败（文件可能被占用）',
          details: failed,
          removed,
        },
        { status: 500 }
      );
    }

    // 删除成功后再更新 metadata/index
    if (metadata) {
      if (
        Array.isArray(metadata.episodes) &&
        metadata.episodes.length >= episode
      ) {
        metadata.episodes[episode - 1] = '';
      }
      if (Array.isArray(metadata.episodes_info)) {
        metadata.episodes_info = metadata.episodes_info.filter(
          (e) => e && e.index !== episode
        );
      }
      metadata.episode_count = Array.isArray(metadata.episodes)
        ? metadata.episodes.filter(
            (p) => typeof p === 'string' && p.trim().length > 0
          ).length
        : 0;
      fs.writeFileSync(
        path.join(localPath, 'metadata.json'),
        JSON.stringify(metadata, null, 2),
        'utf-8'
      );
    }

    index[key] = { ...entry, updated_at: Date.now() };
    storageManager.writeIndex(index);

    return NextResponse.json({ success: true, removed }, { status: 200 });
  } catch (error) {
    console.error('[Local Resource Episode API] 删除单集失败:', error);
    return NextResponse.json(
      {
        error: '删除单集失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
