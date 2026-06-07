/* eslint-disable no-console */

'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';

type DetailResponse = {
  source: string;
  id: string;
  local_path: string;
  metadata: {
    title?: string;
    year?: string;
    poster?: string;
    episodes?: string[];
    episode_count?: number;
    desc?: string;
    source_name?: string;
  };
  stats: {
    downloaded_episodes: number;
    total_episodes: number;
  };
  episode_status: Array<{
    episode: number;
    downloaded: boolean;
    file_path: string;
  }>;
};

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export default function LocalResourceDetail({
  source,
  id,
}: {
  source: string;
  id: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = async () => {
    try {
      const res = await fetch(
        `/api/local-library/detail?source=${encodeURIComponent(
          source
        )}&id=${encodeURIComponent(id)}`,
        { cache: 'no-store' }
      );
      if (!res.ok) {
        const j = await safeJson(res);
        throw new Error(j?.error || `请求失败: ${res.status}`);
      }
      const j = (await res.json()) as DetailResponse;
      setData(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, id]);

  const deleteEpisode = async (episode: number) => {
    if (!confirm(`确认删除第 ${episode} 集？`)) return;
    try {
      const res = await fetch(
        `/api/local-library/episode?source=${encodeURIComponent(
          source
        )}&id=${encodeURIComponent(id)}&episode=${episode}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const j = await safeJson(res);
        throw new Error(j?.error || `删除失败: ${res.status}`);
      }
      await fetchDetail();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteResource = async () => {
    if (!confirm('确认删除整部资源？此操作不可恢复。')) return;
    try {
      const res = await fetch(
        `/api/local-library?source=${encodeURIComponent(
          source
        )}&id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const j = await safeJson(res);
        throw new Error(j?.error || `删除失败: ${res.status}`);
      }
      router.push('/offline');
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading) {
    return (
      <div className='text-sm text-gray-600 dark:text-gray-300'>加载中...</div>
    );
  }

  if (error || !data) {
    return (
      <div className='text-sm text-red-600 dark:text-red-400'>
        {error || '加载失败'}
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='text-xl font-bold text-gray-900 dark:text-gray-100 truncate'>
            {data.metadata.title || `${source}_${id}`}{' '}
            {data.metadata.year ? `(${data.metadata.year})` : ''}
          </div>
          <div className='mt-1 text-sm text-gray-600 dark:text-gray-300'>
            已下载 {data.stats.downloaded_episodes} /{' '}
            {data.stats.total_episodes} 集
          </div>
          <div className='mt-1 text-xs text-gray-500 dark:text-gray-400 truncate'>
            {data.local_path}
          </div>
        </div>

        <div className='flex gap-2 flex-shrink-0'>
          <button
            onClick={fetchDetail}
            className='px-3 py-2 rounded bg-gray-700/90 hover:bg-gray-700 text-white text-sm'
          >
            刷新
          </button>
          <button
            onClick={deleteResource}
            className='px-3 py-2 rounded bg-red-600/90 hover:bg-red-600 text-white text-sm'
          >
            删除整部
          </button>
        </div>
      </div>

      <div className='rounded-lg border border-gray-200/60 dark:border-gray-700/60 bg-white/40 dark:bg-gray-900/40 p-4'>
        <div className='font-medium text-gray-900 dark:text-gray-100 mb-3'>
          剧集列表
        </div>
        <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2'>
          {data.episode_status.map((ep) => (
            <div
              key={ep.episode}
              className={`rounded border px-2 py-2 text-sm flex items-center justify-between gap-2 ${
                ep.downloaded
                  ? 'border-green-500/40 bg-green-500/10'
                  : 'border-gray-300/60 dark:border-gray-700/60 bg-transparent'
              }`}
            >
              <span className='text-gray-900 dark:text-gray-100'>
                第 {ep.episode} 集
              </span>
              {ep.downloaded ? (
                <button
                  onClick={() => deleteEpisode(ep.episode)}
                  className='px-2 py-1 rounded bg-red-600/90 hover:bg-red-600 text-white text-xs'
                >
                  删除
                </button>
              ) : (
                <span className='text-xs text-gray-500 dark:text-gray-400'>
                  未下载
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
