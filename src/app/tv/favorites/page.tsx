/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

'use client';

import { useEffect, useState } from 'react';

import {
  getAllFavorites,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';

import TvVideoCard from '@/components/tv/TvVideoCard';

const COLS_PER_ROW = 5;
const ROW_START = 1;

interface FavoriteItem {
  source: string;
  id: string;
  title: string;
  poster: string;
  year: string;
  episodes: number;
  source_name: string;
  currentEpisode?: number;
  search_title?: string;
}

export default function TvFavoritesPage() {
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        const allFavorites = await getAllFavorites();
        await processAndSet(allFavorites);
      } catch (err) {
        console.error('Failed to load favorites:', err);
      } finally {
        setLoading(false);
      }
    }
    init();

    const unsub = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, any>) => {
        processAndSet(newFavorites);
      }
    );
    return unsub;
  }, []);

  async function processAndSet(allFavorites: Record<string, any>) {
    const allPlayRecords = await getAllPlayRecords();
    const sorted = Object.entries(allFavorites)
      .sort(([, a], [, b]) => b.save_time - a.save_time)
      .map(([key, fav]) => {
        const plusIndex = key.indexOf('+');
        const source = key.slice(0, plusIndex);
        const id = key.slice(plusIndex + 1);
        const playRecord = allPlayRecords[key];

        return {
          source,
          id,
          title: fav.title,
          poster: fav.cover,
          year: fav.year,
          episodes: fav.total_episodes,
          source_name: fav.source_name,
          currentEpisode: playRecord?.index,
          search_title: fav.search_title,
        } as FavoriteItem;
      });
    setItems(sorted);
  }

  if (loading) {
    return (
      <div className='flex justify-center py-20'>
        <div className='tv-spinner' />
      </div>
    );
  }

  return (
    <div>
      <h1 className='text-2xl font-bold text-gray-100 mb-6'>我的收藏</h1>
      {items.length === 0 ? (
        <div className='text-center text-gray-500 py-20 text-xl'>
          暂无收藏内容
        </div>
      ) : (
        <div className='grid grid-cols-5 gap-4'>
          {items.map((item, idx) => (
            <TvVideoCard
              key={`${item.source}-${item.id}`}
              poster={item.poster}
              title={item.title}
              source={item.source}
              id={item.id}
              year={item.year}
              episodes={item.episodes}
              badge={
                item.currentEpisode !== undefined
                  ? `看到第${item.currentEpisode + 1}集`
                  : undefined
              }
              row={ROW_START + Math.floor(idx / COLS_PER_ROW)}
              col={idx % COLS_PER_ROW}
              query={item.search_title}
              from='favorite'
            />
          ))}
        </div>
      )}
    </div>
  );
}
