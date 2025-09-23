/**
 * 搜索结果智能缓存管理器
 * 解决HTTP缓存导致的数据不一致问题
 */

import { SearchResult } from '@/lib/types';

interface CachedSearchResult {
  query: string;
  results: SearchResult[];
  timestamp: number;
  sources: string[]; // 记录哪些源有数据
}

interface SearchCache {
  [query: string]: CachedSearchResult;
}

class SearchCacheManager {
  private static instance: SearchCacheManager;
  private cache: SearchCache = {};
  private readonly CACHE_KEY = 'moontv_search_cache';
  private readonly CACHE_EXPIRE_TIME = 2 * 60 * 60 * 1000; // 2小时，与HTTP缓存一致
  private readonly MAX_CACHE_ENTRIES = 50; // 最多缓存50个搜索结果

  public static getInstance(): SearchCacheManager {
    if (!SearchCacheManager.instance) {
      SearchCacheManager.instance = new SearchCacheManager();
    }
    return SearchCacheManager.instance;
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
        const parsed = JSON.parse(stored) as SearchCache;
        // 清理过期缓存
        this.cache = this.cleanExpiredCache(parsed);
      }
    } catch (error) {
      // 加载搜索缓存失败，使用空缓存
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
      // 保存搜索缓存失败，静默处理
    }
  }

  /**
   * 清理过期缓存
   */
  private cleanExpiredCache(cache: SearchCache): SearchCache {
    const now = Date.now();
    const cleaned: SearchCache = {};

    Object.entries(cache).forEach(([query, data]) => {
      if (now - data.timestamp < this.CACHE_EXPIRE_TIME) {
        cleaned[query] = data;
      }
    });

    return cleaned;
  }

  /**
   * 获取缓存的搜索结果
   */
  public getCachedResults(query: string): SearchResult[] | null {
    const normalizedQuery = query.trim().toLowerCase();
    const cached = this.cache[normalizedQuery];

    if (!cached) {
      return null;
    }

    // 检查是否过期
    if (Date.now() - cached.timestamp > this.CACHE_EXPIRE_TIME) {
      delete this.cache[normalizedQuery];
      this.saveToStorage();
      return null;
    }

    // 使用缓存搜索结果
    return cached.results;
  }

  /**
   * 缓存搜索结果
   */
  public cacheResults(query: string, results: SearchResult[]): void {
    const normalizedQuery = query.trim().toLowerCase();

    // 统计有效数据源
    const validSources = results
      .filter((r) => r.episodes.length > 0)
      .map((r) => r.source);

    const cacheEntry: CachedSearchResult = {
      query: normalizedQuery,
      results,
      timestamp: Date.now(),
      sources: Array.from(new Set(validSources)),
    };

    this.cache[normalizedQuery] = cacheEntry;

    // 限制缓存大小
    this.limitCacheSize();
    this.saveToStorage();

    // 缓存搜索结果完成
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
    toDelete.forEach(([query]) => {
      delete this.cache[query];
    });
  }

  /**
   * 获取缓存统计信息
   */
  public getCacheStats(): {
    totalEntries: number;
    totalResults: number;
    oldestEntry: string | null;
    newestEntry: string | null;
  } {
    const entries = Object.entries(this.cache);

    if (entries.length === 0) {
      return {
        totalEntries: 0,
        totalResults: 0,
        oldestEntry: null,
        newestEntry: null,
      };
    }

    const totalResults = entries.reduce(
      (sum, [, data]) => sum + data.results.length,
      0
    );
    const sortedByTime = entries.sort(
      ([, a], [, b]) => a.timestamp - b.timestamp
    );

    return {
      totalEntries: entries.length,
      totalResults,
      oldestEntry: sortedByTime[0][0],
      newestEntry: sortedByTime[sortedByTime.length - 1][0],
    };
  }

  /**
   * 清空所有缓存
   */
  public clearCache(): void {
    this.cache = {};
    this.saveToStorage();
    // 搜索缓存已清空
  }

  /**
   * 预热缓存 - 为热门搜索词预先缓存结果
   */
  public async warmupCache(popularQueries: string[]): Promise<void> {
    // 开始预热搜索缓存

    for (const query of popularQueries) {
      if (!this.getCachedResults(query)) {
        try {
          // 这里应该调用实际的搜索API
          const response = await fetch(
            `/api/search?q=${encodeURIComponent(query)}`
          );
          const data = await response.json();
          this.cacheResults(query, data.results);

          // 避免请求过于频繁
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          // 预热缓存失败，静默处理
        }
      }
    }

    // 搜索缓存预热完成
  }
}

export const searchCacheManager = SearchCacheManager.getInstance();
export default SearchCacheManager;
