'use client';

import { useRouter } from 'next/navigation';

import { processImageUrl } from '@/lib/utils';

import { useTvFocusable } from './TvFocusProvider';

interface TvVideoCardProps {
  /** Poster image URL */
  poster: string;
  /** Video title */
  title: string;
  /** Source key */
  source?: string;
  /** Resource ID */
  id?: string;
  /** Year */
  year?: string;
  /** Number of episodes */
  episodes?: number;
  /** Episode badge text override */
  badge?: string;
  /** Focus grid row */
  row: number;
  /** Focus grid column */
  col: number;
  /** Douban rating */
  rate?: string;
  /** Search query to pass forward */
  query?: string;
  /** Origin context: 'search' | 'douban' | 'favorite' | 'continue' */
  from?: string;
}

export default function TvVideoCard({
  poster,
  title,
  source,
  id,
  year,
  episodes,
  badge,
  row,
  col,
  rate,
  query,
  from,
}: TvVideoCardProps) {
  const router = useRouter();
  const ref = useTvFocusable(row, col);

  const badgeText = badge ?? (episodes && episodes > 1 ? `${episodes}集` : '');

  function handleSelect() {
    const params = new URLSearchParams();
    if (source) params.set('source', source);
    if (id) params.set('id', id);
    params.set('title', title);
    if (year) params.set('year', year);
    if (query) params.set('q', query);
    if (from) params.set('from', from);
    router.push(`/tv/detail?${params.toString()}`);
  }

  return (
    <button
      ref={ref}
      className='tv-card tv-focusable text-left'
      onClick={handleSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter') handleSelect();
      }}
    >
      <div className='relative'>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className='tv-card-poster'
          src={processImageUrl(poster)}
          alt={title}
          loading='lazy'
          onError={(e) => {
            (e.target as HTMLImageElement).src = '/logo.png';
          }}
        />
        {badgeText && (
          <span className='absolute bottom-2 right-2 rounded bg-black/70 px-2 py-0.5 text-xs text-green-400'>
            {badgeText}
          </span>
        )}
        {rate && (
          <span className='absolute top-2 right-2 rounded bg-black/70 px-2 py-0.5 text-xs text-yellow-400'>
            {rate}
          </span>
        )}
      </div>
      <div className='tv-card-title'>{title}</div>
      {year && <div className='px-2.5 pb-2 text-xs text-gray-500'>{year}</div>}
    </button>
  );
}
