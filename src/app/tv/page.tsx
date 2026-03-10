/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

'use client';

import { useEffect, useState } from 'react';

import type { PlayRecord } from '@/lib/db.client';
import { getAllPlayRecords, subscribeToDataUpdates } from '@/lib/db.client';
import { getDoubanCategories } from '@/lib/douban.client';
import { DoubanItem } from '@/lib/types';

import TvVideoCard from '@/components/tv/TvVideoCard';

// Row indices for focus grid
const ROW_CONTINUE = 1;
const ROW_MOVIES = 2;
const ROW_TV = 3;
const ROW_VARIETY = 4;

export default function TvHomePage() {
  const [playRecords, setPlayRecords] = useState<
    (PlayRecord & { key: string })[]
  >([]);
  const [hotMovies, setHotMovies] = useState<DoubanItem[]>([]);
  const [hotTvShows, setHotTvShows] = useState<DoubanItem[]>([]);
  const [hotVarietyShows, setHotVarietyShows] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Load play records
  useEffect(() => {
    getAllPlayRecords().then((records) => {
      const arr = Object.entries(records)
        .map(([key, record]) => ({ ...record, key }))
        .sort((a, b) => b.save_time - a.save_time);
      setPlayRecords(arr);
    });

    const unsubscribe = subscribeToDataUpdates(
      'playRecordsUpdated',
      (newRecords: Record<string, PlayRecord>) => {
        const arr = Object.entries(newRecords)
          .map(([key, record]) => ({ ...record, key }))
          .sort((a, b) => b.save_time - a.save_time);
        setPlayRecords(arr);
      }
    );
    return unsubscribe;
  }, []);

  // Load douban categories
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [movies, tv, variety] = await Promise.all([
          getDoubanCategories({
            kind: 'movie',
            category: '热门',
            type: '全部',
          }),
          getDoubanCategories({ kind: 'tv', category: 'tv', type: 'tv' }),
          getDoubanCategories({
            kind: 'tv',
            category: 'show',
            type: 'show',
          }),
        ]);
        if (movies.code === 200) setHotMovies(movies.list);
        if (tv.code === 200) setHotTvShows(tv.list);
        if (variety.code === 200) setHotVarietyShows(variety.list);
      } catch (err) {
        console.error('Failed to load douban data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Cache douban titles for pinyin suggestions
  useEffect(() => {
    const allTitles = [
      ...hotMovies.map((m) => m.title),
      ...hotTvShows.map((t) => t.title),
      ...hotVarietyShows.map((v) => v.title),
    ];
    if (allTitles.length > 0) {
      try {
        sessionStorage.setItem('tv_douban_titles', JSON.stringify(allTitles));
      } catch {
        // ignore
      }
    }
  }, [hotMovies, hotTvShows, hotVarietyShows]);

  function parseKey(key: string): { source: string; id: string } {
    const plusIndex = key.indexOf('+');
    return { source: key.slice(0, plusIndex), id: key.slice(plusIndex + 1) };
  }

  return (
    <div>
      {/* Continue Watching */}
      {playRecords.length > 0 && (
        <section className='mb-10'>
          <h2 className='mb-4 text-2xl font-bold text-gray-100'>继续观看</h2>
          <div className='tv-row'>
            {playRecords.slice(0, 20).map((record, idx) => {
              const { source, id } = parseKey(record.key);
              return (
                <TvVideoCard
                  key={record.key}
                  poster={record.cover}
                  title={record.title}
                  source={source}
                  id={id}
                  year={record.year}
                  episodes={record.total_episodes}
                  badge={`第${record.index + 1}集`}
                  row={ROW_CONTINUE}
                  col={idx}
                  query={record.search_title}
                  from='continue'
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Hot Movies */}
      <section className='mb-10'>
        <h2 className='mb-4 text-2xl font-bold text-gray-100'>热门电影</h2>
        <div className='tv-row'>
          {loading
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className='tv-card animate-pulse'>
                  <div className='tv-card-poster bg-gray-800' />
                  <div className='p-2'>
                    <div className='h-4 bg-gray-800 rounded' />
                  </div>
                </div>
              ))
            : hotMovies.map((movie, idx) => (
                <TvVideoCard
                  key={movie.id}
                  poster={movie.poster}
                  title={movie.title}
                  year={movie.year}
                  rate={movie.rate}
                  row={ROW_MOVIES}
                  col={idx}
                  query={movie.title}
                  from='douban'
                />
              ))}
        </div>
      </section>

      {/* Hot TV Shows */}
      <section className='mb-10'>
        <h2 className='mb-4 text-2xl font-bold text-gray-100'>热门剧集</h2>
        <div className='tv-row'>
          {loading
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className='tv-card animate-pulse'>
                  <div className='tv-card-poster bg-gray-800' />
                  <div className='p-2'>
                    <div className='h-4 bg-gray-800 rounded' />
                  </div>
                </div>
              ))
            : hotTvShows.map((show, idx) => (
                <TvVideoCard
                  key={show.id}
                  poster={show.poster}
                  title={show.title}
                  year={show.year}
                  rate={show.rate}
                  row={ROW_TV}
                  col={idx}
                  query={show.title}
                  from='douban'
                />
              ))}
        </div>
      </section>

      {/* Hot Variety Shows */}
      <section className='mb-10'>
        <h2 className='mb-4 text-2xl font-bold text-gray-100'>热门综艺</h2>
        <div className='tv-row'>
          {loading
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className='tv-card animate-pulse'>
                  <div className='tv-card-poster bg-gray-800' />
                  <div className='p-2'>
                    <div className='h-4 bg-gray-800 rounded' />
                  </div>
                </div>
              ))
            : hotVarietyShows.map((show, idx) => (
                <TvVideoCard
                  key={show.id}
                  poster={show.poster}
                  title={show.title}
                  year={show.year}
                  rate={show.rate}
                  row={ROW_VARIETY}
                  col={idx}
                  query={show.title}
                  from='douban'
                />
              ))}
        </div>
      </section>
    </div>
  );
}
