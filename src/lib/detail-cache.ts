/**
 * 视频详情智能缓存管理器
 * 用于缓存视频详情数据，减少API调用
 */

import { SearchResult } from '@/lib/types';

interface CachedDetail {
  detail: SearchResult;
  timestamp: number;
}

interface DetailCache {
  [key: string]: CachedDetail; // key 格式: `${source}-${id}`
}

class DetailCacheManager {
  private static instance: DetailCacheManager;
  private cache: DetailCache = {};
  private readonly CACHE_KEY = 'moontv_detail_cache';
  private readonly CACHE_EXPIRE_TIME = 2 * 60 * 60 * 1000; // 2小时
  private readonly MAX_CACHE_ENTRIES = 100; // 最多缓存100个详情

  public static getInstance(): DetailCacheManager {
    if (!DetailCacheManager.instance) {
      DetailCacheManager.instance = new DetailCacheManager();
    }
    return DetailCacheManager.instance;
  }

  constructor() {
    this.loadFromStorage();
  }

  /**
   * 从localStorage加载缓存
   */
  private loadFromStorage(): void {
    if (typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(this.CACHE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as DetailCache;
        // 清理过期缓存
        this.cache = this.cleanExpiredCache(parsed);
      }
    } catch (error) {
      // 加载详情缓存失败，使用空缓存
      this.cache = {};
    }
  }

  /**
   * 保存缓存到localStorage
   */
  private saveToStorage(): void {
    if (typeof window === 'undefined') return;

    try {
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(this.cache));
    } catch (error) {
      // 保存详情缓存失败，静默处理
    }
  }

  /**
   * 清理过期缓存
   */
  private cleanExpiredCache(cache: DetailCache): DetailCache {
    const now = Date.now();
    const cleaned: DetailCache = {};

    Object.entries(cache).forEach(([key, data]) => {
      if (now - data.timestamp < this.CACHE_EXPIRE_TIME) {
        cleaned[key] = data;
      }
    });

    return cleaned;
  }

  /**
   * 生成缓存键
   */
  private getCacheKey(source: string, id: string): string {
    return `${source}-${id}`;
  }

  /**
   * 获取缓存的详情
   */
  public getCachedDetail(source: string, id: string): SearchResult | null {
    const key = this.getCacheKey(source, id);
    const cached = this.cache[key];

    if (!cached) {
      return null;
    }

    // 检查是否过期
    if (Date.now() - cached.timestamp > this.CACHE_EXPIRE_TIME) {
      delete this.cache[key];
      this.saveToStorage();
      return null;
    }

    return cached.detail;
  }

  /**
   * 缓存详情
   */
  public cacheDetail(source: string, id: string, detail: SearchResult): void {
    const key = this.getCacheKey(source, id);

    this.cache[key] = {
      detail,
      timestamp: Date.now(),
    };

    // 限制缓存大小
    this.limitCacheSize();
    this.saveToStorage();
  }

  /**
   * 限制缓存大小，删除最旧的条目
   */
  private limitCacheSize(): void {
    const entries = Object.entries(this.cache);
    if (entries.length <= this.MAX_CACHE_ENTRIES) {
      return;
    }

    // 按时间戳排序，删除最旧的条目
    entries.sort(([, a], [, b]) => a.timestamp - b.timestamp);

    const toDelete = entries.slice(0, entries.length - this.MAX_CACHE_ENTRIES);
    toDelete.forEach(([key]) => {
      delete this.cache[key];
    });
  }

  /**
   * 预加载详情（后台异步加载，不阻塞UI）
   */
  public async preloadDetails(
    results: SearchResult[],
    limit: number
  ): Promise<void> {
    const toPreload = results.slice(0, limit);

    const preloadPromises = toPreload.map(async (result) => {
      try {
        // 如果已有缓存，跳过
        const cached = this.getCachedDetail(result.source, result.id);
        if (cached) {
          return;
        }

        // 从API获取详情
        const response = await fetch(
          `/api/detail?source=${result.source}&id=${result.id}`
        );
        if (!response.ok) {
          return;
        }

        const detailData = (await response.json()) as SearchResult;
        this.cacheDetail(result.source, result.id, detailData);
      } catch (error) {
        // 预加载失败不影响使用，静默处理
      }
    });

    // 不等待所有完成，后台进行
    Promise.allSettled(preloadPromises).then(() => {
      // eslint-disable-next-line no-console
      console.log(`[DetailCache] 预加载完成，共 ${toPreload.length} 个`);
    });
  }

  /**
   * 清空所有缓存
   */
  public clearCache(): void {
    this.cache = {};
    this.saveToStorage();
  }
}

export const detailCacheManager = DetailCacheManager.getInstance();
export default DetailCacheManager;
