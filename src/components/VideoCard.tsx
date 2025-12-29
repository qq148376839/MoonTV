/* eslint-disable @typescript-eslint/no-explicit-any */

import { CheckCircle, Heart, Link, PlayCircleIcon } from 'lucide-react';
import Image from 'next/image';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  deleteFavorite,
  deletePlayRecord,
  generateStorageKey,
  isFavorited,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';

import { ImagePlaceholder } from '@/components/ImagePlaceholder';

interface VideoCardProps {
  id?: string;
  source?: string;
  title?: string;
  query?: string;
  poster?: string;
  episodes?: number;
  source_name?: string;
  progress?: number;
  year?: string;
  from: 'playrecord' | 'favorite' | 'search' | 'douban';
  currentEpisode?: number;
  douban_id?: string;
  onDelete?: () => void;
  rate?: string;
  items?: SearchResult[];
  type?: string;
}

export default function VideoCard({
  id,
  title = '',
  query = '',
  poster = '',
  episodes,
  source,
  source_name,
  progress = 0,
  year,
  from,
  currentEpisode,
  douban_id,
  onDelete,
  rate,
  items,
  type = '',
}: VideoCardProps) {
  // 【强制日志】确认组件被渲染（仅在开发环境或有问题时输出）
  if (
    process.env.NODE_ENV === 'development' &&
    (!from || (!id && !source && !title && !items?.length))
  ) {
    // eslint-disable-next-line no-console
    console.warn('🔴 [VideoCard] 组件渲染，props 可能不完整:', {
      id,
      source,
      title,
      from,
      itemsLength: items?.length,
      isAggregate: from === 'search' && !!items?.length,
    });
  }

  const [favorited, setFavorited] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const isAggregate = from === 'search' && !!items?.length;

  const aggregateData = useMemo(() => {
    if (!isAggregate || !items) return null;
    const countMap = new Map<string | number, number>();
    const episodeCountMap = new Map<number, number>();
    items.forEach((item) => {
      if (item.douban_id && item.douban_id !== 0) {
        countMap.set(item.douban_id, (countMap.get(item.douban_id) || 0) + 1);
      }
      const len = item.episodes?.length || 0;
      if (len > 0) {
        episodeCountMap.set(len, (episodeCountMap.get(len) || 0) + 1);
      }
    });

    const getMostFrequent = <T extends string | number>(
      map: Map<T, number>
    ) => {
      let maxCount = 0;
      let result: T | undefined;
      map.forEach((cnt, key) => {
        if (cnt > maxCount) {
          maxCount = cnt;
          result = key;
        }
      });
      return result;
    };

    return {
      first: items[0],
      mostFrequentDoubanId: getMostFrequent(countMap),
      mostFrequentEpisodes: getMostFrequent(episodeCountMap) || 0,
    };
  }, [isAggregate, items]);

  // 【修复】确保聚合模式下正确获取source和id
  // 优先级：aggregateData?.first > items[0] > props
  const actualTitle = aggregateData?.first?.title ?? items?.[0]?.title ?? title;
  const actualPoster =
    aggregateData?.first?.poster ?? items?.[0]?.poster ?? poster;

  // 【诊断】在计算前先记录原始值
  if (isAggregate && items && items.length > 0) {
    // eslint-disable-next-line no-console
    console.error('🔴 [VideoCard] 🔍 聚合模式数据检查:', {
      aggregateDataFirst: aggregateData?.first
        ? {
            source: aggregateData.first.source,
            id: aggregateData.first.id,
          }
        : null,
      itemsFirst: items[0]
        ? {
            source: items[0].source,
            id: items[0].id,
          }
        : null,
      propsSource: source,
      propsId: id,
    });
  }

  const actualSource =
    isAggregate && items && items.length > 0
      ? aggregateData?.first?.source ?? items[0]?.source ?? source
      : aggregateData?.first?.source ?? source;
  const actualId =
    isAggregate && items && items.length > 0
      ? aggregateData?.first?.id ?? items[0]?.id ?? id
      : aggregateData?.first?.id ?? id;

  // 【诊断】记录最终计算的值
  if (isAggregate) {
    // eslint-disable-next-line no-console
    console.error('🔴 [VideoCard] ✅ 聚合模式最终值:', {
      actualSource: actualSource || '(空)',
      actualId: actualId || '(空)',
      hasSource: !!actualSource,
      hasId: !!actualId,
      canNavigate: !!(actualSource && actualId),
    });
  }
  const actualDoubanId = String(
    aggregateData?.mostFrequentDoubanId ?? douban_id
  );
  const actualEpisodes = aggregateData?.mostFrequentEpisodes ?? episodes;
  const actualYear = aggregateData?.first?.year ?? items?.[0]?.year ?? year;
  const actualQuery = query || '';
  const actualSearchType = isAggregate
    ? (aggregateData?.first?.episodes ?? items?.[0]?.episodes)?.length === 1
      ? 'movie'
      : 'tv'
    : type;

  // 获取收藏状态
  useEffect(() => {
    if (from === 'douban' || !actualSource || !actualId) return;

    const fetchFavoriteStatus = async () => {
      try {
        const fav = await isFavorited(actualSource, actualId);
        setFavorited(fav);
      } catch (err) {
        throw new Error('检查收藏状态失败');
      }
    };

    fetchFavoriteStatus();

    // 监听收藏状态更新事件
    const storageKey = generateStorageKey(actualSource, actualId);
    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, any>) => {
        // 检查当前项目是否在新的收藏列表中
        const isNowFavorited = !!newFavorites[storageKey];
        setFavorited(isNowFavorited);
      }
    );

    return unsubscribe;
  }, [from, actualSource, actualId]);

  const handleToggleFavorite = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (from === 'douban' || !actualSource || !actualId) return;
      try {
        if (favorited) {
          // 如果已收藏，删除收藏
          await deleteFavorite(actualSource, actualId);
          setFavorited(false);
        } else {
          // 如果未收藏，添加收藏
          await saveFavorite(actualSource, actualId, {
            title: actualTitle,
            source_name: source_name || '',
            year: actualYear || '',
            cover: actualPoster,
            total_episodes: actualEpisodes ?? 1,
            save_time: Date.now(),
          });
          setFavorited(true);
        }
      } catch (err) {
        throw new Error('切换收藏状态失败');
      }
    },
    [
      from,
      actualSource,
      actualId,
      actualTitle,
      source_name,
      actualYear,
      actualPoster,
      actualEpisodes,
      favorited,
    ]
  );

  const handleDeleteRecord = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (from !== 'playrecord' || !actualSource || !actualId) return;
      try {
        await deletePlayRecord(actualSource, actualId);
        onDelete?.();
      } catch (err) {
        throw new Error('删除播放记录失败');
      }
    },
    [from, actualSource, actualId, onDelete]
  );

  const handleClick = useCallback(() => {
    // 【诊断日志】点击时的详细参数信息（强制输出）
    // eslint-disable-next-line no-console
    console.error('🔴 [VideoCard] 🖱️ 点击事件触发:', {
      from,
      isAggregate,
      actualSource,
      actualId,
      actualTitle,
      actualYear,
      actualQuery,
      actualSearchType,
      itemsLength: items?.length,
      aggregateData: isAggregate
        ? {
            firstSource: aggregateData?.first.source,
            firstId: aggregateData?.first.id,
            itemsCount: items?.length,
          }
        : null,
    });

    // 【修复】确保有source和id时才跳转
    if (from === 'douban') {
      const url = `/play?title=${encodeURIComponent(actualTitle.trim())}${
        actualYear ? `&year=${actualYear}` : ''
      }${actualSearchType ? `&stype=${actualSearchType}` : ''}`;
      // eslint-disable-next-line no-console
      console.error(
        '🔴 [VideoCard] 📤 立即跳转到播放页面（豆瓣模式，不等待任何操作）:',
        url
      );
      // 【优化】使用 window.location.href 强制立即跳转
      window.location.href = url;
    } else if (actualSource && actualId) {
      // 【修复】聚合模式下，传递完整的items信息到sessionStorage
      if (isAggregate && items && items.length > 0) {
        try {
          sessionStorage.setItem(
            `video_sources_${actualTitle}_${actualYear || ''}`,
            JSON.stringify({
              items: items,
              query: actualQuery,
              timestamp: Date.now(),
            })
          );
          // eslint-disable-next-line no-console
          console.error('🔴 [VideoCard] 💾 已保存源信息到 sessionStorage:', {
            key: `video_sources_${actualTitle}_${actualYear || ''}`,
            itemsCount: items.length,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[VideoCard] 无法保存源信息到 sessionStorage:', err);
        }
      }

      const url = `/play?source=${actualSource}&id=${actualId}&title=${encodeURIComponent(
        actualTitle
      )}${actualYear ? `&year=${actualYear}` : ''}${
        isAggregate ? '&prefer=true' : ''
      }${
        actualQuery ? `&stitle=${encodeURIComponent(actualQuery.trim())}` : ''
      }${actualSearchType ? `&stype=${actualSearchType}` : ''}`;

      // eslint-disable-next-line no-console
      console.error('🔴 [VideoCard] 📤 立即跳转到播放页面（不等待SSE完成）:', {
        url,
        params: {
          source: actualSource,
          id: actualId,
          title: actualTitle,
          year: actualYear,
          prefer: isAggregate ? 'true' : undefined,
          stitle: actualQuery,
          stype: actualSearchType,
        },
      });

      // 【优化】使用 window.location.href 强制立即跳转，不等待任何React状态更新
      // 这样可以确保即使SSE还在进行中，也能立即跳转到播放页面
      window.location.href = url;
    } else {
      // 【修复】如果没有source和id，打印警告信息
      // eslint-disable-next-line no-console
      console.error('[VideoCard] ✗ 无法跳转：缺少 source 或 id', {
        actualSource,
        actualId,
        isAggregate,
        itemsLength: items?.length,
        aggregateDataFirst: aggregateData?.first,
        itemsFirst: items?.[0],
      });
    }
  }, [
    from,
    actualSource,
    actualId,
    actualTitle,
    actualYear,
    isAggregate,
    actualQuery,
    actualSearchType,
    items,
    aggregateData,
  ]);

  const config = useMemo(() => {
    const configs = {
      playrecord: {
        showSourceName: true,
        showProgress: true,
        showPlayButton: true,
        showHeart: true,
        showCheckCircle: true,
        showDoubanLink: false,
        showRating: false,
      },
      favorite: {
        showSourceName: true,
        showProgress: false,
        showPlayButton: true,
        showHeart: true,
        showCheckCircle: false,
        showDoubanLink: false,
        showRating: false,
      },
      search: {
        showSourceName: true,
        showProgress: false,
        showPlayButton: true,
        showHeart: !isAggregate,
        showCheckCircle: false,
        showDoubanLink: !!actualDoubanId,
        showRating: false,
      },
      douban: {
        showSourceName: false,
        showProgress: false,
        showPlayButton: true,
        showHeart: false,
        showCheckCircle: false,
        showDoubanLink: true,
        showRating: !!rate,
      },
    };
    return configs[from] || configs.search;
  }, [from, isAggregate, actualDoubanId, rate]);

  return (
    <div
      className='group relative w-full rounded-lg bg-transparent cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.05] hover:z-[500]'
      onClick={handleClick}
    >
      {/* 海报容器 */}
      <div className='relative aspect-[2/3] overflow-hidden rounded-lg'>
        {/* 骨架屏 */}
        {!isLoading && <ImagePlaceholder aspectRatio='aspect-[2/3]' />}
        {/* 图片 */}
        <Image
          src={processImageUrl(actualPoster)}
          alt={actualTitle}
          fill
          className='object-cover'
          referrerPolicy='no-referrer'
          onLoadingComplete={() => setIsLoading(true)}
        />

        {/* 悬浮遮罩 */}
        <div className='absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 transition-opacity duration-300 ease-in-out group-hover:opacity-100' />

        {/* 播放按钮 */}
        {config.showPlayButton && (
          <div className='absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-300 ease-in-out delay-75 group-hover:opacity-100 group-hover:scale-100'>
            <PlayCircleIcon
              size={50}
              strokeWidth={0.8}
              className='text-white fill-transparent transition-all duration-300 ease-out hover:fill-green-500 hover:scale-[1.1]'
            />
          </div>
        )}

        {/* 操作按钮 */}
        {(config.showHeart || config.showCheckCircle) && (
          <div className='absolute bottom-3 right-3 flex gap-3 opacity-0 translate-y-2 transition-all duration-300 ease-in-out group-hover:opacity-100 group-hover:translate-y-0'>
            {config.showCheckCircle && (
              <CheckCircle
                onClick={handleDeleteRecord}
                size={20}
                className='text-white transition-all duration-300 ease-out hover:stroke-green-500 hover:scale-[1.1]'
              />
            )}
            {config.showHeart && (
              <Heart
                onClick={handleToggleFavorite}
                size={20}
                className={`transition-all duration-300 ease-out ${
                  favorited
                    ? 'fill-red-600 stroke-red-600'
                    : 'fill-transparent stroke-white hover:stroke-red-400'
                } hover:scale-[1.1]`}
              />
            )}
          </div>
        )}

        {/* 徽章 */}
        {config.showRating && rate && (
          <div className='absolute top-2 right-2 bg-pink-500 text-white text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center shadow-md transition-all duration-300 ease-out group-hover:scale-110'>
            {rate}
          </div>
        )}

        {actualEpisodes && actualEpisodes > 1 && (
          <div className='absolute top-2 right-2 bg-green-500 text-white text-xs font-semibold px-2 py-1 rounded-md shadow-md transition-all duration-300 ease-out group-hover:scale-110'>
            {currentEpisode
              ? `${currentEpisode}/${actualEpisodes}`
              : actualEpisodes}
          </div>
        )}

        {/* 豆瓣链接 */}
        {config.showDoubanLink && actualDoubanId && (
          <a
            href={`https://movie.douban.com/subject/${actualDoubanId}`}
            target='_blank'
            rel='noopener noreferrer'
            onClick={(e) => e.stopPropagation()}
            className='absolute top-2 left-2 opacity-0 -translate-x-2 transition-all duration-300 ease-in-out delay-100 group-hover:opacity-100 group-hover:translate-x-0'
          >
            <div className='bg-green-500 text-white text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center shadow-md hover:bg-green-600 hover:scale-[1.1] transition-all duration-300 ease-out'>
              <Link size={16} />
            </div>
          </a>
        )}
      </div>

      {/* 进度条 */}
      {config.showProgress && progress !== undefined && (
        <div className='mt-1 h-1 w-full bg-gray-200 rounded-full overflow-hidden'>
          <div
            className='h-full bg-green-500 transition-all duration-500 ease-out'
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* 标题与来源 */}
      <div className='mt-2 text-center'>
        <div className='relative'>
          <span className='block text-sm font-semibold truncate text-gray-900 dark:text-gray-100 transition-colors duration-300 ease-in-out group-hover:text-green-600 dark:group-hover:text-green-400 peer'>
            {actualTitle}
          </span>
          {/* 自定义 tooltip */}
          <div className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-gray-800 text-white text-xs rounded-md shadow-lg opacity-0 invisible peer-hover:opacity-100 peer-hover:visible transition-all duration-200 ease-out delay-100 whitespace-nowrap pointer-events-none'>
            {actualTitle}
            <div className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'></div>
          </div>
        </div>
        {config.showSourceName && source_name && (
          <span className='block text-xs text-gray-500 dark:text-gray-400 mt-1'>
            <span className='inline-block border rounded px-2 py-0.5 border-gray-500/60 dark:border-gray-400/60 transition-all duration-300 ease-in-out group-hover:border-green-500/60 group-hover:text-green-600 dark:group-hover:text-green-400'>
              {source_name}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
