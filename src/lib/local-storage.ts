/* eslint-disable no-console */

import fs from 'fs';
import path from 'path';

import { SearchResult } from './types';

// 本地资源元数据接口
export interface LocalResourceMetadata {
  id: string;
  title: string;
  poster: string;
  episodes: string[];
  source: string;
  source_name: string;
  original_source: string;
  original_id: string;
  year: string;
  desc?: string;
  type_name?: string;
  local_path: string;
  download_time: number;
  file_size: number;
  episode_count: number;
  episodes_info?: Array<{
    index: number;
    file_path: string;
    file_size: number;
    duration?: number;
    resolution?: string;
  }>;
}

// 资源索引接口
export interface ResourceIndex {
  [key: string]: {
    title: string;
    year: string;
    local_path: string;
    sources: string[];
    created_at: number;
    updated_at: number;
  };
}

// 存储管理器
export class StorageManager {
  private storagePath: string;
  private indexPath: string;
  private enabled: boolean;

  constructor() {
    // 从环境变量获取存储路径
    // 如果未设置，使用项目目录下的相对路径（更适合开发环境）
    const defaultPath = path.join(process.cwd(), 'data', 'videos');
    this.storagePath = process.env.LOCAL_STORAGE_PATH || defaultPath;
    this.indexPath = path.join(this.storagePath, 'index.json');

    // 检查环境变量：如果未设置或设置为 'true'，则启用；只有明确设置为 'false' 时才禁用
    const envEnabled = process.env.LOCAL_STORAGE_ENABLED;
    this.enabled = envEnabled !== 'false';

    console.log('[StorageManager] 初始化配置:', {
      storagePath: this.storagePath,
      enabled: this.enabled,
      envEnabled: envEnabled,
      envEnabledType: typeof envEnabled,
      cwd: process.cwd(),
      allLocalStorageEnvVars: {
        LOCAL_STORAGE_ENABLED: process.env.LOCAL_STORAGE_ENABLED,
        LOCAL_STORAGE_PATH: process.env.LOCAL_STORAGE_PATH,
        LOCAL_STORAGE_MAX_CONCURRENT: process.env.LOCAL_STORAGE_MAX_CONCURRENT,
      },
    });

    // 初始化存储目录
    this.initStorage();
  }

  /**
   * 初始化存储目录
   */
  private initStorage(): void {
    if (!this.enabled) {
      console.log('[StorageManager] 本地存储功能已禁用');
      return;
    }

    try {
      // 检查存储路径是否存在
      if (!fs.existsSync(this.storagePath)) {
        // 创建存储目录
        fs.mkdirSync(this.storagePath, { recursive: true });
        console.log(`[StorageManager] 创建存储目录: ${this.storagePath}`);
      }

      // 检查存储路径是否可写
      try {
        const testFile = path.join(this.storagePath, '.test');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        console.log(
          `[StorageManager] ✓ 存储路径可写检查通过: ${this.storagePath}`
        );
      } catch (err) {
        console.error(
          `[StorageManager] ✗ 存储路径不可写: ${this.storagePath}`,
          err instanceof Error
            ? {
                message: err.message,
                code: (err as NodeJS.ErrnoException).code,
                errno: (err as NodeJS.ErrnoException).errno,
                syscall: (err as NodeJS.ErrnoException).syscall,
              }
            : err
        );
        this.enabled = false;
        return;
      }

      // 初始化索引文件
      if (!fs.existsSync(this.indexPath)) {
        this.writeIndex({});
      }

      console.log(`[StorageManager] 初始化成功: ${this.storagePath}`);
    } catch (err) {
      console.error('[StorageManager] 初始化失败:', err);
      this.enabled = false;
    }
  }

  /**
   * 检查本地存储是否启用
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 获取资源目录路径
   */
  public getResourcePath(
    title: string,
    year: string,
    source: string,
    id: string
  ): string {
    // 清理标题中的特殊字符
    const safeTitle = this.sanitizeFileName(`${title}_${year}`);
    const sourceDir = `${source}_${id}`;
    return path.join(this.storagePath, safeTitle, sourceDir);
  }

  /**
   * 获取资源根目录路径
   */
  public getResourceRootPath(title: string, year: string): string {
    const safeTitle = this.sanitizeFileName(`${title}_${year}`);
    return path.join(this.storagePath, safeTitle);
  }

  /**
   * 清理文件名中的特殊字符
   */
  private sanitizeFileName(fileName: string): string {
    return fileName
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  /**
   * 检查资源是否已下载
   */
  public isResourceDownloaded(source: string, id: string): boolean {
    if (!this.enabled) {
      return false;
    }

    try {
      const index = this.readIndex();
      const key = `${source}_${id}`;
      return key in index;
    } catch (err) {
      console.error('[StorageManager] 检查资源失败:', err);
      return false;
    }
  }

  /**
   * 检查特定剧集是否已下载
   */
  public isEpisodeDownloaded(
    source: string,
    id: string,
    episodeIndex: number
  ): boolean {
    if (!this.enabled) {
      return false;
    }

    try {
      // 从资源索引中获取资源路径
      const index = this.readIndex();
      const key = `${source}_${id}`;

      if (!(key in index)) {
        console.log(
          `[StorageManager] isEpisodeDownloaded: 资源不在索引中 - ${source}_${id}, episodeIndex: ${episodeIndex}`
        );
        return false;
      }

      const indexEntry = index[key];
      // local_path 已经是完整路径（包含 source_id 目录）
      // 如果是相对路径，转换为绝对路径（相对于项目根目录）
      let resourcePath = indexEntry.local_path;
      if (!path.isAbsolute(resourcePath)) {
        // 如果路径以 data/videos 开头，说明是相对于项目根目录
        if (
          resourcePath.startsWith('data/videos') ||
          resourcePath.startsWith('./data/videos')
        ) {
          resourcePath = path.resolve(
            process.cwd(),
            resourcePath.replace(/^\.\//, '')
          );
        } else {
          // 否则相对于 storagePath
          resourcePath = path.resolve(this.storagePath, resourcePath);
        }
      }

      if (!fs.existsSync(resourcePath)) {
        console.log(
          `[StorageManager] isEpisodeDownloaded: 资源路径不存在 - ${resourcePath}, episodeIndex: ${episodeIndex}`
        );
        return false;
      }

      // 检查剧集文件是否存在
      const episodeFileName = `episode_${episodeIndex
        .toString()
        .padStart(2, '0')}.m3u8`;
      const episodeFilePath = path.join(resourcePath, episodeFileName);

      // 如果 M3U8 文件不存在，认为未下载
      if (!fs.existsSync(episodeFilePath)) {
        console.log(
          `[StorageManager] isEpisodeDownloaded: M3U8文件不存在 - ${episodeFilePath}`
        );
        return false;
      }

      // 读取 M3U8 文件，检查其中列出的所有 TS 片段是否都存在
      const episodeDir = path.join(
        resourcePath,
        `episode_${episodeIndex.toString().padStart(2, '0')}`
      );

      if (!fs.existsSync(episodeDir)) {
        return false;
      }

      // 读取 M3U8 文件内容
      const m3u8Content = fs.readFileSync(episodeFilePath, 'utf-8');
      const lines = m3u8Content.split('\n');

      // 统计 M3U8 中列出的 TS 片段数量
      let expectedSegmentCount = 0;
      for (const line of lines) {
        const trimmedLine = line.trim();
        // 检查是否是 TS 片段路径（不是注释行）
        if (
          trimmedLine &&
          !trimmedLine.startsWith('#') &&
          trimmedLine.endsWith('.ts')
        ) {
          expectedSegmentCount++;
        }
      }

      // 如果 M3U8 中没有 TS 片段引用，检查目录中是否有 TS 文件
      if (expectedSegmentCount === 0) {
        const files = fs.readdirSync(episodeDir);
        const tsFiles = files.filter((file) => file.endsWith('.ts'));
        // 至少有一个 TS 片段文件
        return tsFiles.length > 0;
      }

      // 检查目录中实际存在的 TS 片段数量
      const files = fs.readdirSync(episodeDir);
      const tsFiles = files.filter((file) => file.endsWith('.ts'));

      // 如果实际片段数量少于预期，认为未完全下载
      if (tsFiles.length < expectedSegmentCount) {
        return false;
      }

      // 如果实际片段数量等于或大于预期数量，认为已下载完成
      // 允许实际数量略多于预期（可能有一些临时文件）
      if (tsFiles.length >= expectedSegmentCount) {
        // 进一步检查：确保从 segment_000.ts 到 segment_XXX.ts 的连续片段都存在
        // 这可以避免中间有缺失片段的情况
        const segmentPattern = /segment_(\d+)\.ts/;
        const foundSegments = new Set<number>();

        for (const file of tsFiles) {
          const match = file.match(segmentPattern);
          if (match) {
            foundSegments.add(parseInt(match[1], 10));
          }
        }

        // 检查前 expectedSegmentCount 个片段是否都存在
        // 允许有额外的片段（索引 >= expectedSegmentCount）
        let missingCount = 0;
        for (let i = 0; i < expectedSegmentCount; i++) {
          if (!foundSegments.has(i)) {
            missingCount++;
          }
        }

        // 如果缺失片段少于5%，认为已下载完成（允许少量缺失）
        const missingRatio = missingCount / expectedSegmentCount;
        if (missingRatio <= 0.05) {
          console.log(
            `[StorageManager] isEpisodeDownloaded: ✓ 剧集已下载 - ${source}_${id}, episodeIndex: ${episodeIndex}, 预期: ${expectedSegmentCount}, 实际: ${tsFiles.length}, 缺失: ${missingCount}`
          );
          return true;
        } else {
          console.log(
            `[StorageManager] isEpisodeDownloaded: ✗ 片段缺失过多 - ${source}_${id}, episodeIndex: ${episodeIndex}, 缺失: ${missingCount}/${expectedSegmentCount} (${(
              missingRatio * 100
            ).toFixed(1)}%)`
          );
        }
      } else {
        console.log(
          `[StorageManager] isEpisodeDownloaded: ✗ 片段数量不足 - ${source}_${id}, episodeIndex: ${episodeIndex}, 预期: ${expectedSegmentCount}, 实际: ${tsFiles.length}`
        );
      }

      return false;
    } catch (err) {
      console.error('[StorageManager] 检查剧集失败:', err);
      return false;
    }
  }

  /**
   * 读取资源索引
   */
  public readIndex(): ResourceIndex {
    if (!fs.existsSync(this.indexPath)) {
      return {};
    }

    try {
      const content = fs.readFileSync(this.indexPath, 'utf-8');
      return JSON.parse(content) as ResourceIndex;
    } catch (err) {
      console.error('[StorageManager] 读取索引失败:', err);
      return {};
    }
  }

  /**
   * 写入资源索引
   */
  public writeIndex(index: ResourceIndex): void {
    if (!this.enabled) {
      return;
    }

    try {
      fs.writeFileSync(this.indexPath, JSON.stringify(index, null, 2), 'utf-8');
    } catch (err) {
      console.error('[StorageManager] 写入索引失败:', err);
    }
  }

  /**
   * 更新资源索引
   */
  public updateIndex(
    source: string,
    id: string,
    title: string,
    year: string,
    localPath: string
  ): void {
    if (!this.enabled) {
      return;
    }

    const index = this.readIndex();
    const key = `${source}_${id}`;
    const now = Date.now();

    if (index[key]) {
      index[key].updated_at = now;
      index[key].local_path = localPath;
    } else {
      index[key] = {
        title,
        year,
        local_path: localPath,
        sources: [source],
        created_at: now,
        updated_at: now,
      };
    }

    this.writeIndex(index);
  }

  /**
   * 创建资源目录
   */
  public createResourceDirectory(
    title: string,
    year: string,
    source: string,
    id: string
  ): string {
    if (!this.enabled) {
      throw new Error('本地存储功能未启用');
    }

    const resourcePath = this.getResourcePath(title, year, source, id);
    const resourceRootPath = this.getResourceRootPath(title, year);

    // 创建资源根目录
    if (!fs.existsSync(resourceRootPath)) {
      fs.mkdirSync(resourceRootPath, { recursive: true });
    }

    // 创建站点子目录
    if (!fs.existsSync(resourcePath)) {
      fs.mkdirSync(resourcePath, { recursive: true });
    }

    return resourcePath;
  }

  /**
   * 生成元数据文件
   */
  public async generateMetadata(
    resource: SearchResult,
    localPath: string,
    episodes: string[],
    fileSize: number
  ): Promise<LocalResourceMetadata> {
    // 将绝对路径转换为相对路径（相对于项目根目录）
    const normalizePath = (filePath: string): string => {
      // 如果已经是相对路径，直接返回
      if (!path.isAbsolute(filePath)) {
        return filePath;
      }

      // 转换为相对于项目根目录的路径
      const projectRoot = process.cwd();
      const relativePath = path.relative(projectRoot, filePath);

      // 确保路径使用正斜杠（跨平台兼容）
      return relativePath.replace(/\\/g, '/');
    };

    // 规范化所有路径
    const normalizedEpisodes = episodes.map(normalizePath);
    const normalizedLocalPath = normalizePath(localPath);

    const metadata: LocalResourceMetadata = {
      id: `local_${resource.source}_${resource.id}`,
      title: resource.title,
      poster: resource.poster,
      episodes: normalizedEpisodes,
      source: 'local',
      source_name: `本地资源-${resource.source_name}`,
      original_source: resource.source,
      original_id: resource.id,
      year: resource.year,
      desc: resource.desc,
      type_name: resource.type_name,
      local_path: normalizedLocalPath,
      download_time: Date.now(),
      file_size: fileSize,
      episode_count: episodes.length,
      episodes_info: normalizedEpisodes.map((ep, index) => ({
        index: index + 1,
        file_path: ep,
        file_size: 0, // 将在下载完成后更新
      })),
    };

    // 写入元数据文件
    const metadataPath = path.join(localPath, 'metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

    return metadata;
  }

  /**
   * 读取资源元数据
   */
  public readMetadata(localPath: string): LocalResourceMetadata | null {
    const metadataPath = path.join(localPath, 'metadata.json');
    if (!fs.existsSync(metadataPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(metadataPath, 'utf-8');
      return JSON.parse(content) as LocalResourceMetadata;
    } catch (err) {
      console.error('[StorageManager] 读取元数据失败:', err);
      return null;
    }
  }

  /**
   * 检查存储空间
   */
  public checkStorageSpace(): {
    available: boolean;
    freeSpace?: number;
    totalSpace?: number;
  } {
    if (!this.enabled) {
      return { available: false };
    }

    try {
      // 检查目录是否存在（statSync 会抛出异常如果不存在）
      fs.statSync(this.storagePath);
      // Node.js 不直接提供磁盘空间信息，这里只检查目录是否存在
      // 实际空间检查需要在下载前通过其他方式实现
      return { available: true };
    } catch (err) {
      return { available: false };
    }
  }

  /**
   * 获取存储路径
   */
  public getStoragePath(): string {
    return this.storagePath;
  }
}

// 单例实例
let storageManagerInstance: StorageManager | null = null;

/**
 * 获取存储管理器实例
 */
export function getStorageManager(): StorageManager {
  if (!storageManagerInstance) {
    storageManagerInstance = new StorageManager();
  }
  return storageManagerInstance;
}
