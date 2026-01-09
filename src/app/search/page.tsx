/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any, no-console */
'use client';

import { ChevronUp, Search, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';

import {
  addSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { detailCacheManager } from '@/lib/detail-cache';
import { searchCacheManager } from '@/lib/search-cache';
import { getStreamSearchUrl } from '@/lib/search-config';
import { SearchResult } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';

import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

function SearchPageClient() {
  // 搜索历史
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  // 返回顶部按钮显示状态
  const [showBackToTop, setShowBackToTop] = useState(false);
  // 缓存统计信息（预留，后续可用于显示缓存状态）
  // const [cacheStats, setCacheStats] = useState<{
  //   totalEntries: number;
  //   totalResults: number;
  //   oldestEntry: string | null;
  //   newestEntry:(year:string | null;
  // } | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  // 获取默认聚合设置：只读取用户本地设置，默认为 true
  const getDefaultAggregate = () => {
    if (typeof window !== 'undefined') {
      const userSetting = localStorage.getItem('defaultAggregateSearch');
      if (userSetting !== null) {
        return JSON.parse(userSetting);
      }
    }
    return true; // 默认启用聚合
  };

  const [viewMode, setViewMode] = useState<'agg' | 'all'>(() => {
    return getDefaultAggregate() ? 'agg' : 'all';
  });

  // 聚合后的结果（按标题和年份分组）
  const aggregatedResults = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    searchResults.forEach((item) => {
      // 使用 title + year + type 作为键，year 必然存在，但依然兜底 meng未知'
      const key = `${item.title.replaceAll(' ', '')}-${
        item.year || 'unknown'
      }-${item.episodes.length === 1 ? 'movie' : 'tv'}`;
      const arr = map.get(key) || [];
      arr.push(item);
      map.set(key, arr);
    });
    return Array.from(map.entries()).sort((a, b) => {
      // 优先排序：标题与搜索词完全一致的排在前面
      const aExactMatch = a[1][0].title
        .replaceAll(' ', '')
        .includes(searchQuery.trim().replaceAll(' ', ''));
      const bExactMatch = b[1][0].title
        .replaceAll(' ', '')
        .includes(searchQuery.trim().replaceAll(' ', ''));

      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;

      // 年份排序
      if (a[1][0].year === b[1][0].year) {
        return a[0].localeCompare(b[0]);
      } else {
        // 处理 unknown 的情况
        const aYear = a[1][0].year;
        const bYear = b[1][0].year;

        if (aYear === 'unknown' && bYear === 'unknown') {
          return 0;
        } else if (aYear === 'unknown') {
          return 1; // a 排在后面
        } else if (bYear === 'unknown') {
          return -1; // b 排在后面
        } else {
          // 都是数字年份，按数字大小排序（大的在前面）
          return aYear > bYear ? -1 : 1;
        }
      }
    });
  }, [searchResults]);

  useEffect(() => {
    // 无搜索参数时聚焦搜索框
    !searchParams.get('q') && document.getElementById('searchInput')?.focus();

    // 初始加载搜索历史
    getSearchHistory().then(setSearchHistory);

    // 监听搜索历史更新事件
    const unsubscribe = subscribeToDataUpdates(
      'searchHistoryUpdated',
      (newHistory: string[]) => {
        setSearchHistory(newHistory);
      }
    );

    // 获取滚动位置的函数 - 专门针对 body 滚动
    const getScrollTop = () => {
      return document.body.scrollTop || 0;
    };

    // 使用 requestAnimationFrame 持续检测滚动位置
    let isRunning = false;
    const checkScrollPosition = () => {
      if (!isRunning) return;

      const scrollTop = getScrollTop();
      const shouldShow = scrollTop > 300;
      setShowBackToTop(shouldShow);

      requestAnimationFrame(checkScrollPosition);
    };

    // 启动持续检测
    isRunning = true;
    checkScrollPosition();

    // 监听 body 元素的滚动事件
    const handleScroll = () => {
      const scrollTop = getScrollTop();
      setShowBackToTop(scrollTop > 300);
    };

    document.body.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      unsubscribe();
      isRunning = false; // 停止 requestAnimationFrame 循环

      // 移除 body 滚动事件监听器
      document.body.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    // 当搜索参数变化时更新搜索状态
    const query = searchParams.get('q');
    if (query) {
      setSearchQuery(query);
      fetchSearchResultsStream(query); // 使用流式搜索

      // 保存到搜索历史 (事件监听会自动更新界面)
      addSearchHistory(query);
    } else {
      setShowResults(false);
    }
  }, [searchParams]);

  // 流式搜索函数 - 使用 SSE 实时返回结果
  const fetchSearchResultsStream = async (query: string) => {
    // 【修复】防止重复调用：检查是否已有进行中的SSE连接
    if (typeof window !== 'undefined') {
      const existingStatus = sessionStorage.getItem(
        `sse_status_${query.trim()}`
      );
      if (existingStatus) {
        try {
          const parsed = JSON.parse(existingStatus);
          if (parsed.isActive) {
            // eslint-disable-next-line no-console
            console.log('[Search] ⏸️ SSE仍在进行中，跳过重复调用:', query);
            return;
          }
        } catch (err) {
          // 忽略解析错误
        }
      }
    }

    try {
      setIsLoading(true);
      setSearchResults([]); // 清空之前的结果

      // 首先尝试从缓存获取
      const cachedResults = searchCacheManager.getCachedResults(query);
      if (cachedResults) {
        // eslint-disable-next-line no-console
        console.log('[DEBUG] 使用缓存结果，跳过SSE');
        let results = cachedResults;
        if (
          typeof window !== 'undefined' &&
          !(window as any).RUNTIME_CONFIG?.DISABLE_YELLOW_FILTER
        ) {
          results = results.filter((result: SearchResult) => {
            const typeName = result.type_name || '';
            return !yellowWords.some((word: string) => typeName.includes(word));
          });
        }

        setSearchResults(results);
        setShowResults(true);
        setIsLoading(false);

        // 【新增】使用缓存结果时，也保存到 sessionStorage
        try {
          sessionStorage.setItem(
            `search_results_${query.trim()}`,
            JSON.stringify({
              query: query.trim(),
              results: results,
              timestamp: Date.now(),
            })
          );
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[Search] 无法保存搜索结果到 sessionStorage:', err);
        }

        // 【性能优化】使用缓存结果时，也预加载详情
        detailCacheManager
          .preloadDetails(results.slice(0, 10), 10)
          .catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.warn(
              '[DetailCache] 缓存结果预加载失败（不影响使用）:',
              err
            );
          });

        return;
      }

      // eslint-disable-next-line no-console
      console.log('[DEBUG] 开始SSE流式搜索:', query);

      // 使用 SSE 流式搜索（支持 Cloudflare Worker 或本地 API）
      const searchUrl = getStreamSearchUrl(query.trim());
      const eventSource = new EventSource(searchUrl);
      const seenResults = new Set<string>();
      const accumulatedResults: SearchResult[] = [];
      let hasReceivedResults = false;

      // 【调试日志】记录SSE连接
      console.log('[Search] SSE连接已建立，开始接收搜索结果');

      // 连接打开时，立即显示加载状态
      eventSource.onopen = () => {
        setShowResults(true);
        // eslint-disable-next-line no-console
        console.log('[SSE] ✅ 连接已打开，ReadyState:', eventSource.readyState);
      };

      eventSource.onmessage = (event) => {
        try {
          // 【调试】记录原始消息
          console.log('[SSE] 收到原始消息:', event.data);
          
          const data = JSON.parse(event.data);
          
          // 【调试】记录解析后的数据
          console.log('[SSE] 解析后的数据:', {
            done: data.done,
            resultsCount: data.results?.length || 0,
            source: data.source,
            source_name: data.source_name,
            timestamp: data.timestamp
          });

          if (data.done) {
            // eslint-disable-next-line no-console
            console.log(
              '[SSE] 搜索完成，共',
              accumulatedResults.length,
              '个结果'
            );
            eventSource.close();
            // 缓存完整结果
            if (accumulatedResults.length > 0) {
              searchCacheManager.cacheResults(query, accumulatedResults);

              // 【新增】搜索完成时，最终保存到 sessionStorage
              try {
                sessionStorage.setItem(
                  `search_results_${query.trim()}`,
                  JSON.stringify({
                    query: query.trim(),
                    results: accumulatedResults,
                    timestamp: Date.now(),
                  })
                );
                // 【新增】标记SSE已完成
                sessionStorage.setItem(
                  `sse_status_${query.trim()}`,
                  JSON.stringify({
                    isActive: false,
                    query: query.trim(),
                    timestamp: Date.now(),
                  })
                );
              } catch (err) {
                // eslint-disable-next-line no-console
                console.warn(
                  '[Search] 无法保存搜索结果到 sessionStorage:',
                  err
                );
              }

              // 【性能优化】搜索完成后，批量预加载前10个结果的详情
              // 这可以在用户浏览结果时提前准备好数据
              detailCacheManager
                .preloadDetails(accumulatedResults.slice(0, 10), 10)
                .catch((err: unknown) => {
                  // eslint-disable-next-line no-console
                  console.warn(
                    '[DetailCache] 批量预加载失败（不影响使用）:',
                    err
                  );
                });
            }
            setIsLoading(false);
            return;
          }

          // 处理新结果
          if (
            data.results &&
            Array.isArray(data.results) &&
            data.results.length > 0
          ) {
            console.log(`[SSE] 📥 收到 ${data.results.length} 个结果，来源: ${data.source || 'unknown'}`);
            
            const newResults = data.results.filter(
              (result: SearchResult) =>
                !seenResults.has(`${result.source}-${result.id}`)
            );

            if (newResults.length > 0) {
              // eslint-disable-next-line no-console
              console.log(`[SSE] ✅ 过滤后剩余 ${newResults.length} 个新结果（去重了 ${data.results.length - newResults.length} 个）`);
              newResults.forEach((result: SearchResult) => {
                seenResults.add(`${result.source}-${result.id}`);
                accumulatedResults.push(result);
              });

              // 【优化】立即更新 UI，允许用户点击
              setSearchResults([...accumulatedResults]);
              setShowResults(true);

              // 【优化】收到第一个结果时，立即停止加载动画并允许用户点击
              if (!hasReceivedResults) {
                hasReceivedResults = true;
                setIsLoading(false); // 停止加载动画，允许点击
                // eslint-disable-next-line no-console
                console.log('[SSE] ✓ 已收到第一个结果，用户可以立即点击播放');
              }

              // 【新增】标记SSE仍在进行中，供后续使用
              try {
                sessionStorage.setItem(
                  `sse_status_${query.trim()}`,
                  JSON.stringify({
                    isActive: true,
                    query: query.trim(),
                    timestamp: Date.now(),
                  })
                );
              } catch (err) {
                // sessionStorage可能已满，静默处理
              }

              // 【新增】每次更新结果时，保存到 sessionStorage，供播放页面使用
              if (accumulatedResults.length > 0) {
                try {
                  sessionStorage.setItem(
                    `search_results_${query.trim()}`,
                    JSON.stringify({
                      query: query.trim(),
                      results: accumulatedResults,
                      timestamp: Date.now(),
                    })
                  );
                } catch (err) {
                  // sessionStorage 可能已满，静默处理
                  // eslint-disable-next-line no-console
                  console.warn(
                    '[Search] 无法保存搜索结果到 sessionStorage:',
                    err
                  );
                }
              }

              // 【性能优化】后台预加载详情（不阻塞UI）
              // 对新收到的结果进行预加载，最多预加载前10个
              if (accumulatedResults.length <= 10) {
                detailCacheManager
                  .preloadDetails(newResults, newResults.length)
                  .catch((err: unknown) => {
                    // eslint-disable-next-line no-console
                    console.warn(
                      '[DetailCache] 预加载失败（不影响使用）:',
                      err
                    );
                  });
              }
            } else {
              console.log(`[SSE] ⚠️ 所有 ${data.results.length} 个结果都已存在（重复），跳过更新`);
            }
          } else {
            // 【调试】记录为什么没有处理结果
            if (!data.results) {
              console.log('[SSE] ⚠️ 消息中没有 results 字段');
            } else if (!Array.isArray(data.results)) {
              console.log('[SSE] ⚠️ results 不是数组:', typeof data.results);
            } else if (data.results.length === 0) {
              console.log('[SSE] ⚠️ results 数组为空');
            }
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[SSE] ❌ Error parsing SSE message:', err, '原始数据:', event.data);
        }
      };

      eventSource.onerror = (error) => {
        // eslint-disable-next-line no-console
        console.error(
          '[SSE] ❌ Connection error:',
          error,
          'ReadyState:',
          eventSource.readyState,
          'URL:',
          searchUrl
        );
        
        // 检查连接状态
        if (eventSource.readyState === EventSource.CLOSED) {
          console.log('[SSE] 🔴 连接已关闭');
          eventSource.close();
          setIsLoading(false);
          
          // 如果还没有收到任何结果，可能是连接失败
          if (!hasReceivedResults && accumulatedResults.length === 0) {
            console.warn('[SSE] ⚠️ 连接关闭且未收到任何结果，可能存在问题');
          }
        } else if (eventSource.readyState === EventSource.CONNECTING) {
          // 连接中，可能是暂时断线，保持流式更新
          // eslint-disable-next-line no-console
          console.log('[SSE] 🔄 连接中断，尝试重连...');
        } else if (eventSource.readyState === EventSource.OPEN) {
          console.log('[SSE] ✅ 连接正常打开');
        }
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Search error:', error);
      setIsLoading(false);
      setSearchResults([]);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;

    // 回显搜索框
    setSearchQuery(trimmed);
    setIsLoading(true);
    setShowResults(true);

    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    // 直接发请求 - 使用流式搜索
    fetchSearchResultsStream(trimmed);

    // 保存到搜索历史 (事件监听会自动更新界面)
    addSearchHistory(trimmed);
  };

  // 返回顶部功能
  const scrollToTop = () => {
    try {
      // 根据调试结果，真正的滚动容器是 document.body
      document.body.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    } catch (error) {
      // 如果平滑滚动完全失败，使用立即滚动
      document.body.scrollTop = 0;
    }
  };

  return (
    <PageLayout activePath='/search'>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible mb-10'>
        {/* 搜索框 */}
        <div className='mb-8'>
          <form onSubmit={handleSearch} className='max-w-2xl mx-auto'>
            <div className='relative'>
              <Search className='absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500' />
              <input
                id='searchInput'
                type='text'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder='搜索电影、电视剧...'
                className='w-full h-12 rounded-lg bg-gray-50/80 py-3 pl-10 pr-4 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400 focus:bg-white border border-gray-200/50 shadow-sm dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:bg-gray-700 dark:border-gray-700'
              />
            </div>
          </form>
        </div>

        {/* 搜索结果或搜索历史 */}
        <div className='max-w-[95%] mx-auto mt-12 overflow-visible'>
          {isLoading ? (
            <div className='flex justify-center items-center h-40'>
              <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-green-500'></div>
            </div>
          ) : showResults ? (
            <section className='mb-12'>
              {/* 标题 + 聚合开关 */}
              <div className='mb-8 flex items-center justify-between'>
                <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                  搜索结果
                </h2>
                {/* 聚合开关 */}
                <label className='flex items-center gap-2 cursor-pointer select-none'>
                  <span className='text-sm text-gray-700 dark:text-gray-300'>
                    聚合
                  </span>
                  <div className='relative'>
                    <input
                      type='checkbox'
                      className='sr-only peer'
                      checked={viewMode === 'agg'}
                      onChange={() =>
                        setViewMode(viewMode === 'agg' ? 'all' : 'agg')
                      }
                    />
                    <div className='w-9 h-5 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                    <div className='absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4'></div>
                  </div>
                </label>
              </div>
              <div
                key={`search-results-${viewMode}`}
                className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'
              >
                {viewMode === 'agg'
                  ? aggregatedResults.map(([mapKey, group]) => {
                      // 确保 group 不为空
                      if (!group || group.length === 0) {
                        return null;
                      }
                      return (
                        <div key={`agg-${mapKey}`} className='w-full'>
                          <VideoCard
                            from='search'
                            items={group}
                            query={
                              searchQuery.trim() !== group[0]?.title
                                ? searchQuery.trim()
                                : ''
                            }
                          />
                        </div>
                      );
                    })
                  : searchResults.map((item) => (
                      <div
                        key={`all-${item.source}-${item.id}`}
                        className='w-full'
                      >
                        <VideoCard
                          id={item.id}
                          title={item.title + ' ' + item.type_name}
                          poster={item.poster}
                          episodes={item.episodes.length}
                          source={item.source}
                          source_name={item.source_name}
                          douban_id={item.douban_id?.toString()}
                          query={
                            searchQuery.trim() !== item.title
                              ? searchQuery.trim()
                              : ''
                          }
                          year={item.year}
                          from='search'
                          type={item.episodes.length > 1 ? 'tv' : 'movie'}
                        />
                      </div>
                    ))}
                {searchResults.length === 0 && (
                  <div className='col-span-full text-center text-gray-500 py-8 dark:text-gray-400'>
                    未找到相关结果
                  </div>
                )}
              </div>
            </section>
          ) : searchHistory.length > 0 ? (
            // 搜索历史
            <section className='mb-12'>
              <h2 className='mb-4 text-xl font-bold text-gray-800 text-left dark:text-gray-200'>
                搜索历史
                {searchHistory.length > 0 && (
                  <button
                    onClick={() => {
                      clearSearchHistory(); // 事件监听会自动更新界面
                    }}
                    className='ml-3 text-sm text-gray-500 hover:text-red-500 transition-colors dark:text-gray-400 dark:hover:text-red-500'
                  >
                    清空
                  </button>
                )}
              </h2>
              <div className='flex flex-wrap gap-2'>
                {searchHistory.map((item) => (
                  <div key={item} className='relative group'>
                    <button
                      onClick={() => {
                        setSearchQuery(item);
                        router.push(
                          `/search?q=${encodeURIComponent(item.trim())}`
                        );
                      }}
                      className='px-4 py-2 bg-gray-500/10 hover:bg-gray-300 rounded-full text-sm text-gray-700 transition-colors duration-200 dark:bg-gray-700/50 dark:hover:bg-gray-600 dark:text-gray-300'
                    >
                      {item}
                    </button>
                    {/* 删除按钮 */}
                    <button
                      aria-label='删除搜索历史'
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        deleteSearchHistory(item); // 事件监听会自动更新界面
                      }}
                      className='absolute -top-1 -right-1 w-4 h-4 opacity-0 group-hover:opacity-100 bg-gray-400 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] transition-colors'
                    >
                      <X className='w-3 h-3' />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      {/* 返回顶部悬浮按钮 */}
      <button
        onClick={scrollToTop}
        className={`fixed bottom-20 md:bottom-6 right-6 z-[500] w-12 h-12 bg-green-500/90 hover:bg-green-500 text-white rounded-full shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out flex items-center justify-center group ${
          showBackToTop
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
        aria-label='返回顶部'
      >
        <ChevronUp className='w-6 h-6 transition-transform group-hover:scale-110' />
      </button>
    </PageLayout>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageClient />
    </Suspense>
  );
}
