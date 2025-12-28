/* eslint-disable no-console */

import fs from 'fs';
import path from 'path';

import {
  getStorageManager,
  LocalResourceMetadata,
  StorageManager,
} from './local-storage';

// 本地资源检测结果
export interface LocalResourceInfo {
  exists: boolean;
  metadata?: LocalResourceMetadata;
  localPath?: string;
  sources?: Array<{
    source: string;
    source_name: string;
    local_path: string;
    episode_count: number;
    status: string;
  }>;
}

// 资源检测服务
export class ResourceDetector {
  private storageManager: StorageManager;
  private metadataCache: Map<string, LocalResourceMetadata> = new Map();
  private cacheExpiry: number = 5 * 60 * 1000; // 5分钟

  constructor() {
    this.storageManager = getStorageManager();
  }

  /**
   * 检查资源是否存在
   */
  public async checkResource(
    source: string,
    id: string
  ): Promise<LocalResourceInfo> {
    if (!this.storageManager.isEnabled()) {
      return { exists: false };
    }

    // 检查资源索引
    const index = this.storageManager.readIndex();
    const key = `${source}_${id}`;

    if (!(key in index)) {
      return { exists: false };
    }

    const indexEntry = index[key];
    // local_path 已经是完整路径（包含 source_id 目录）
    let localPath = indexEntry.local_path;

    // 如果是相对路径，转换为绝对路径
    if (!path.isAbsolute(localPath)) {
      if (
        localPath.startsWith('data/videos') ||
        localPath.startsWith('./data/videos')
      ) {
        localPath = path.resolve(process.cwd(), localPath.replace(/^\.\//, ''));
      } else {
        // 否则相对于 storagePath
        const storagePath = this.storageManager.getStoragePath();
        localPath = path.resolve(storagePath || process.cwd(), localPath);
      }
    }

    // 检查目录是否存在
    if (!fs.existsSync(localPath)) {
      return { exists: false };
    }

    // 读取元数据
    const metadata = this.storageManager.readMetadata(localPath);
    if (!metadata) {
      return { exists: false };
    }

    // 验证文件是否存在
    const filesExist = metadata.episodes.every((ep) => {
      let filePath: string;

      if (path.isAbsolute(ep)) {
        // 绝对路径，直接使用
        filePath = ep;
      } else if (
        ep.startsWith('data/videos') ||
        ep.startsWith('./data/videos')
      ) {
        // 相对路径，但以 data/videos 开头，相对于项目根目录解析
        filePath = path.resolve(process.cwd(), ep.replace(/^\.\//, ''));
      } else {
        // 其他相对路径，相对于 localPath
        filePath = path.join(localPath, ep);
      }

      if (ep.endsWith('.m3u8')) {
        // M3U8 文件，检查文件本身和目录
        const episodeDir = path.dirname(filePath);
        return fs.existsSync(filePath) && fs.existsSync(episodeDir);
      } else {
        // 直接文件，检查文件是否存在
        return fs.existsSync(filePath);
      }
    });

    if (!filesExist) {
      return { exists: false };
    }

    return {
      exists: true,
      metadata,
      localPath,
    };
  }

  /**
   * 获取本地资源的播放地址
   */
  public getLocalPlayUrl(
    metadata: LocalResourceMetadata,
    episodeIndex: number
  ): string | null {
    if (episodeIndex < 1 || episodeIndex > metadata.episodes.length) {
      return null;
    }

    const episodePath = metadata.episodes[episodeIndex - 1];
    const absolutePath = path.isAbsolute(episodePath)
      ? episodePath
      : path.join(metadata.local_path, episodePath);

    // 转换为 HTTP 服务地址
    const encodedPath = encodeURIComponent(absolutePath);
    return `/api/local-video?path=${encodedPath}`;
  }

  /**
   * 检查多个站点的资源
   */
  public async checkMultipleSources(
    sources: Array<{ source: string; id: string }>
  ): Promise<LocalResourceInfo> {
    if (!this.storageManager.isEnabled()) {
      return { exists: false };
    }

    const availableSources: Array<{
      source: string;
      source_name: string;
      local_path: string;
      episode_count: number;
      status: string;
    }> = [];

    for (const { source, id } of sources) {
      const info = await this.checkResource(source, id);
      if (info.exists && info.metadata) {
        availableSources.push({
          source,
          source_name: info.metadata.source_name.replace('本地资源-', ''),
          local_path: info.metadata.local_path,
          episode_count: info.metadata.episode_count,
          status: 'completed',
        });
      }
    }

    if (availableSources.length === 0) {
      return { exists: false };
    }

    return {
      exists: true,
      sources: availableSources,
    };
  }

  /**
   * 刷新资源索引（启动时调用）
   */
  public async refreshIndex(): Promise<void> {
    if (!this.storageManager.isEnabled()) {
      return;
    }

    console.log('[ResourceDetector] 开始刷新资源索引...');

    const storagePath = this.storageManager.getStoragePath();
    const index: Record<
      string,
      {
        title: string;
        year: string;
        local_path: string;
        sources: string[];
        created_at: number;
        updated_at: number;
      }
    > = {};

    try {
      // 扫描存储目录
      const resourceDirs = fs.readdirSync(storagePath, {
        withFileTypes: true,
      });

      for (const dir of resourceDirs) {
        if (!dir.isDirectory() || dir.name === 'index.json') {
          continue;
        }

        const resourceRootPath = path.join(storagePath, dir.name);
        const sourceDirs = fs.readdirSync(resourceRootPath, {
          withFileTypes: true,
        });

        for (const sourceDir of sourceDirs) {
          if (!sourceDir.isDirectory()) {
            continue;
          }

          // 解析 source_id
          const parts = sourceDir.name.split('_');
          if (parts.length < 2) {
            continue;
          }

          const id = parts.slice(1).join('_');
          const source = parts[0];
          const key = `${source}_${id}`;

          // 读取元数据
          const metadataPath = path.join(
            resourceRootPath,
            sourceDir.name,
            'metadata.json'
          );

          if (!fs.existsSync(metadataPath)) {
            continue;
          }

          try {
            const metadataContent = fs.readFileSync(metadataPath, 'utf-8');
            const metadata = JSON.parse(
              metadataContent
            ) as LocalResourceMetadata;

            // 解析标题和年份
            const titleYearMatch = dir.name.match(/^(.+)_(\d{4})$/);
            const title = titleYearMatch ? titleYearMatch[1] : metadata.title;
            const year = titleYearMatch ? titleYearMatch[2] : metadata.year;

            if (index[key]) {
              index[key].sources.push(source);
              index[key].updated_at = Date.now();
            } else {
              index[key] = {
                title,
                year,
                local_path: path.join(resourceRootPath, sourceDir.name),
                sources: [source],
                created_at: metadata.download_time || Date.now(),
                updated_at: Date.now(),
              };
            }
          } catch (error) {
            console.error(
              `[ResourceDetector] 读取元数据失败: ${metadataPath}`,
              error
            );
          }
        }
      }

      // 写入索引
      this.storageManager.writeIndex(index);

      console.log(
        `[ResourceDetector] 资源索引刷新完成，共 ${
          Object.keys(index).length
        } 个资源`
      );
    } catch (error) {
      console.error('[ResourceDetector] 刷新资源索引失败:', error);
    }
  }
}

// 单例实例
let resourceDetectorInstance: ResourceDetector | null = null;

/**
 * 获取资源检测服务实例
 */
export function getResourceDetector(): ResourceDetector {
  if (!resourceDetectorInstance) {
    resourceDetectorInstance = new ResourceDetector();
  }
  return resourceDetectorInstance;
}
