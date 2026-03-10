/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

'use client';

import { Heart, HeartOff } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import {
  deleteFavorite,
  isFavorited,
  saveFavorite,
  savePlayRecord,
} from '@/lib/db.client';
import { playViaNative } from '@/lib/tv-bridge';
import { SearchResult } from '@/lib/types';
import { cleanHtmlTags, processImageUrl } from '@/lib/utils';

import { useTvFocusable } from '@/components/tv/TvFocusProvider';

const ROW_SOURCES = 1;
const ROW_ACTIONS = 2;
const ROW_EPISODES_START = 3;
const EPISODES_PER_ROW = 8;

function TvDetailClient() {
  const searchParams = useSearchParams();
  const paramSource = searchParams.get('source') || '';
  const paramId = searchParams.get('id') || '';
  const paramTitle = searchParams.get('title') || '';
  const paramYear = searchParams.get('year') || '';
  const paramQuery = searchParams.get('q') || '';

  const [detail, setDetail] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [favorited, setFavoritedState] = useState(false);
  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
  const [activeSourceIdx, setActiveSourceIdx] = useState(0);
  const [currentSource, setCurrentSource] = useState(paramSource);
  const [currentId, setCurrentId] = useState(paramId);
  const [episodeStatuses, setEpisodeStatuses] = useState<
    Record<number, string>
  >({});

  const detailRef = useRef<SearchResult | null>(null);

  // Load detail on mount
  useEffect(() => {
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check favorite status
  useEffect(() => {
    if (currentSource && currentId) {
      isFavorited(currentSource, currentId).then(setFavoritedState);
    }
  }, [currentSource, currentId]);

  // Register native playback callback
  useEffect(() => {
    window.onNativePlaybackEnd = (currentTime: number, duration: number) => {
      saveProgress(currentTime, duration);
    };
    return () => {
      window.onNativePlaybackEnd = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, currentSource, currentId]);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // If we have source+id, fetch detail directly
      if (paramSource && paramId) {
        const res = await fetch(
          `/api/detail?source=${encodeURIComponent(
            paramSource
          )}&id=${encodeURIComponent(paramId)}`
        );
        if (!res.ok) throw new Error('Failed to fetch detail');
        const data = await res.json();
        if (data.detail) {
          setDetail(data.detail);
          detailRef.current = data.detail;
          setCurrentSource(data.detail.source || paramSource);
          setCurrentId(data.detail.id || paramId);
        }

        // Also try to load search results for multi-source switching
        loadSearchResults();
        checkDownloadStatuses();
      } else if (paramTitle) {
        // From douban/continue watching: search first, then load detail of first result
        const query = paramQuery || paramTitle;
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error('Search failed');
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          // Find best match by title
          const match =
            data.results.find(
              (r: SearchResult) =>
                r.title.replace(/\s/g, '') === paramTitle.replace(/\s/g, '')
            ) || data.results[0];

          setAvailableSources(data.results);
          setCurrentSource(match.source);
          setCurrentId(match.id);

          // Fetch detail for the matched result
          const detailRes = await fetch(
            `/api/detail?source=${encodeURIComponent(
              match.source
            )}&id=${encodeURIComponent(match.id)}`
          );
          if (detailRes.ok) {
            const detailData = await detailRes.json();
            if (detailData.detail) {
              setDetail(detailData.detail);
              detailRef.current = detailData.detail;
            }
          }
          checkDownloadStatuses();
        } else {
          setError('未找到相关资源');
        }
      }
    } catch (err) {
      console.error('Failed to load detail:', err);
      setError('加载失败，请返回重试');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramSource, paramId, paramTitle, paramQuery]);

  function loadSearchResults() {
    // Try sessionStorage first
    const query = paramQuery || paramTitle;
    if (!query) return;
    try {
      const cached = sessionStorage.getItem(`search_results_${query.trim()}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.results && Array.isArray(parsed.results)) {
          // Filter to same title
          const matching = parsed.results.filter(
            (r: SearchResult) =>
              r.title.replace(/\s/g, '') ===
              (detail?.title || paramTitle).replace(/\s/g, '')
          );
          if (matching.length > 0) {
            setAvailableSources(matching);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  function checkDownloadStatuses() {
    // Check download status for episodes
    if (!currentSource || !currentId) return;
    fetch(
      `/api/local-status?source=${encodeURIComponent(
        currentSource
      )}&id=${encodeURIComponent(currentId)}`
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.statuses) {
          setEpisodeStatuses(data.statuses);
        }
      })
      .catch(() => {
        // ignore - local status check is optional
      });
  }

  function handleSourceSwitch(result: SearchResult, idx: number) {
    setActiveSourceIdx(idx);
    setCurrentSource(result.source);
    setCurrentId(result.id);
    // Re-fetch detail for new source
    setLoading(true);
    fetch(
      `/api/detail?source=${encodeURIComponent(
        result.source
      )}&id=${encodeURIComponent(result.id)}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (data.detail) {
          setDetail(data.detail);
          detailRef.current = data.detail;
        }
      })
      .catch((err) => console.error('Source switch failed:', err))
      .finally(() => setLoading(false));
  }

  function handlePlayEpisode(episodeIdx: number) {
    if (!detail) return;
    const episodeUrl = detail.episodes[episodeIdx];
    if (!episodeUrl) return;

    const isOfficial = detail.source_type === 'official';
    const query = paramQuery || paramTitle;
    const totalEps = detail.episodes.length;

    let playUrl: string;
    if (isOfficial) {
      playUrl = `/api/official-play.m3u8?url=${encodeURIComponent(
        episodeUrl
      )}&source=${encodeURIComponent(currentSource)}&id=${encodeURIComponent(
        currentId
      )}&ep=${episodeIdx}&total=${totalEps}`;
    } else {
      playUrl = `/api/unofficial-play.m3u8?source=${encodeURIComponent(
        currentSource
      )}&id=${encodeURIComponent(currentId)}&q=${encodeURIComponent(
        query
      )}&url=${encodeURIComponent(
        episodeUrl
      )}&ep=${episodeIdx}&total=${totalEps}`;
    }

    // Use full URL for native player
    const fullUrl = `${window.location.origin}${playUrl}`;
    const subtitle = `第${episodeIdx + 1}集`;

    // Try native playback first
    const played = playViaNative(fullUrl, detail.title, subtitle);
    if (!played) {
      // Fallback: open in browser (for desktop testing)
      window.open(fullUrl, '_blank');
    }

    // Save a basic play record immediately
    saveProgress(0, 0, episodeIdx);
  }

  function saveProgress(currentTime: number, duration: number, epIdx?: number) {
    const d = detailRef.current || detail;
    if (!d || !currentSource || !currentId) return;
    const episodeIndex = epIdx !== undefined ? epIdx : 0;

    savePlayRecord(currentSource, currentId, {
      title: d.title,
      source_name: d.source_name,
      year: d.year || paramYear,
      cover: d.poster,
      index: episodeIndex,
      total_episodes: d.episodes.length,
      play_time: currentTime,
      total_time: duration,
      save_time: Date.now(),
      search_title: paramQuery || paramTitle || d.title,
      source: currentSource,
      id: currentId,
    });
  }

  async function toggleFavorite() {
    if (!detail || !currentSource || !currentId) return;
    if (favorited) {
      await deleteFavorite(currentSource, currentId);
      setFavoritedState(false);
    } else {
      await saveFavorite(currentSource, currentId, {
        title: detail.title,
        source_name: detail.source_name,
        year: detail.year || paramYear,
        cover: detail.poster,
        total_episodes: detail.episodes.length,
        save_time: Date.now(),
        search_title: paramQuery || paramTitle || detail.title,
      });
      setFavoritedState(true);
    }
  }

  if (loading) {
    return (
      <div className='flex justify-center py-20'>
        <div className='tv-spinner' />
      </div>
    );
  }

  if (error) {
    return (
      <div className='text-center text-red-400 py-20 text-xl'>{error}</div>
    );
  }

  if (!detail) {
    return (
      <div className='text-center text-gray-500 py-20 text-xl'>无详情数据</div>
    );
  }

  return (
    <div>
      {/* Header: poster + info */}
      <div className='flex gap-8 mb-8'>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={processImageUrl(detail.poster)}
          alt={detail.title}
          className='w-48 aspect-[2/3] object-cover rounded-lg flex-shrink-0'
          onError={(e) => {
            (e.target as HTMLImageElement).src = '/logo.png';
          }}
        />
        <div className='flex-1 min-w-0'>
          <h1 className='text-3xl font-bold mb-2 text-gray-100'>
            {detail.title}
          </h1>
          <div className='flex gap-4 text-gray-400 text-sm mb-3'>
            {detail.year && <span>{detail.year}</span>}
            {detail.class && <span>{detail.class}</span>}
            <span>{detail.source_name}</span>
            <span>{detail.episodes.length}集</span>
          </div>
          {detail.desc && (
            <p className='text-gray-500 text-sm leading-relaxed line-clamp-4'>
              {cleanHtmlTags(detail.desc)}
            </p>
          )}
        </div>
      </div>

      {/* Source tabs */}
      {availableSources.length > 1 && (
        <div className='mb-6'>
          <h3 className='text-lg font-semibold text-gray-400 mb-3'>播放源</h3>
          <div className='flex gap-3 flex-wrap'>
            {availableSources.map((src, idx) => (
              <SourceTab
                key={`${src.source}-${src.id}`}
                label={src.source_name}
                isActive={idx === activeSourceIdx}
                row={ROW_SOURCES}
                col={idx}
                onSelect={() => handleSourceSwitch(src, idx)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Actions row */}
      <div className='flex gap-4 mb-8'>
        <FavButton
          favorited={favorited}
          row={ROW_ACTIONS}
          col={0}
          onToggle={toggleFavorite}
        />
      </div>

      {/* Episode grid */}
      <div className='mb-8'>
        <h3 className='text-lg font-semibold text-gray-400 mb-4'>选集</h3>
        <div className='grid grid-cols-8 gap-3'>
          {detail.episodes.map((_, idx) => {
            const isDownloaded = episodeStatuses[idx] === 'downloaded';
            return (
              <EpisodeButton
                key={idx}
                index={idx}
                downloaded={isDownloaded}
                row={ROW_EPISODES_START + Math.floor(idx / EPISODES_PER_ROW)}
                col={idx % EPISODES_PER_ROW}
                onPlay={() => handlePlayEpisode(idx)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SourceTab({
  label,
  isActive,
  row,
  col,
  onSelect,
}: {
  label: string;
  isActive: boolean;
  row: number;
  col: number;
  onSelect: () => void;
}) {
  const ref = useTvFocusable(row, col);
  return (
    <button
      ref={ref}
      className={`tv-source-tab ${isActive ? 'active' : ''}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelect();
      }}
    >
      {label}
    </button>
  );
}

function FavButton({
  favorited,
  row,
  col,
  onToggle,
}: {
  favorited: boolean;
  row: number;
  col: number;
  onToggle: () => void;
}) {
  const ref = useTvFocusable(row, col);
  return (
    <button
      ref={ref}
      className={`tv-fav-btn flex items-center gap-2 ${
        favorited ? 'bg-red-600/20 text-red-400' : 'bg-gray-800 text-gray-300'
      }`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onToggle();
      }}
    >
      {favorited ? <HeartOff size={20} /> : <Heart size={20} />}
      {favorited ? '取消收藏' : '收藏'}
    </button>
  );
}

function EpisodeButton({
  index,
  downloaded,
  row,
  col,
  onPlay,
}: {
  index: number;
  downloaded: boolean;
  row: number;
  col: number;
  onPlay: () => void;
}) {
  const ref = useTvFocusable(row, col);
  return (
    <button
      ref={ref}
      className={`tv-episode-btn ${downloaded ? 'downloaded' : ''}`}
      onClick={onPlay}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onPlay();
      }}
    >
      第{index + 1}集
      {downloaded && (
        <span className='ml-1 text-xs text-green-400'>&#10003;</span>
      )}
    </button>
  );
}

export default function TvDetailPage() {
  return (
    <Suspense>
      <TvDetailClient />
    </Suspense>
  );
}
