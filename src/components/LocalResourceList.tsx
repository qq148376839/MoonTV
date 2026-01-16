/* eslint-disable no-console */

'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

type LocalLibraryItem = {
  source: string;
  id: string;
  title?: string;
  year?: string;
  poster?: string;
  local_path: string;
  downloaded_episodes?: number;
  updated_at: number;
};

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export default function LocalResourceList() {
  const [items, setItems] = useState<LocalLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const fetchList = async () => {
    try {
      const res = await fetch('/api/local-library', { cache: 'no-store' });
      if (!res.ok) {
        const data = await safeJson(res);
        throw new Error(data?.error || `请求失败: ${res.status}`);
      }
      const data = await res.json();
      setItems(Array.isArray(data?.items) ? data.items : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = items.slice().sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    if (!q) return base;
    return base.filter((it) => (it.title || '').toLowerCase().includes(q));
  }, [items, query]);

  if (loading) {
    return (
      <div className='text-sm text-gray-600 dark:text-gray-300'>加载中...</div>
    );
  }

  return (
    <div className='space-y-3'>
      {error && (
        <div className='text-sm text-red-600 dark:text-red-400'>{error}</div>
      )}

      <div className='flex items-center gap-2'>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='按标题搜索...'
          className='w-full max-w-md px-3 py-2 rounded border border-gray-200/60 dark:border-gray-700/60 bg-white/60 dark:bg-gray-900/40 text-sm'
        />
        <button
          onClick={fetchList}
          className='px-3 py-2 rounded bg-gray-700/90 hover:bg-gray-700 text-white text-sm'
        >
          刷新
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className='text-sm text-gray-600 dark:text-gray-300'>
          暂无已下载资源
        </div>
      ) : (
        <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
          {filtered.map((it) => (
            <Link
              key={`${it.source}_${it.id}`}
              href={`/offline/resource?source=${encodeURIComponent(
                it.source
              )}&id=${encodeURIComponent(it.id)}`}
              className='rounded-lg border border-gray-200/60 dark:border-gray-700/60 bg-white/40 dark:bg-gray-900/40 p-4 hover:border-green-500/40 transition-colors'
            >
              <div className='font-medium text-gray-900 dark:text-gray-100 truncate'>
                {it.title || `${it.source}_${it.id}`} {it.year ? `(${it.year})` : ''}
              </div>
              <div className='mt-1 text-xs text-gray-600 dark:text-gray-300 flex flex-wrap gap-2'>
                <span className='border border-gray-500/40 rounded px-2 py-0.5'>
                  {it.source}
                </span>
                {typeof it.downloaded_episodes === 'number' && (
                  <span>已下载 {it.downloaded_episodes} 集</span>
                )}
              </div>
              <div className='mt-1 text-xs text-gray-500 dark:text-gray-400 truncate'>
                {it.local_path}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

