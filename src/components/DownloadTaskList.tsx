/* eslint-disable no-console */

'use client';

import React, { useEffect, useRef, useState } from 'react';

import DownloadStatusBadge from './DownloadStatusBadge';

type DownloadTask = {
  task_id: string;
  source: string;
  id: string;
  title?: string;
  year?: string;
  poster?: string;
  episode_numbers?: number[];
  status: string;
  progress: number;
  error?: string;
  created_at: number;
  updated_at: number;
};

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export default function DownloadTaskList() {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const failuresRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const getPollingMs = () => {
    if (typeof document !== 'undefined' && document.hidden) return 8000;
    if (failuresRef.current >= 3) return 6000;
    return 2000;
  };

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/download', { cache: 'no-store' });
      if (!res.ok) {
        const data = await safeJson(res);
        throw new Error(data?.error || `请求失败: ${res.status}`);
      }
      const data = await res.json();
      setTasks(Array.isArray(data?.tasks) ? data.tasks : []);
      failuresRef.current = 0;
      setError(null);
    } catch (e) {
      failuresRef.current += 1;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const schedule = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(async () => {
      await fetchTasks();
      schedule();
    }, getPollingMs());
  };

  useEffect(() => {
    fetchTasks().then(schedule);
    const onVis = () => {
      fetchTasks().then(schedule);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mutate = async (fn: () => Promise<Response>) => {
    try {
      const res = await fn();
      if (!res.ok) {
        const data = await safeJson(res);
        throw new Error(data?.error || `操作失败: ${res.status}`);
      }
      await fetchTasks();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const onCancel = (taskId: string) =>
    mutate(() =>
      fetch(`/api/download?task_id=${encodeURIComponent(taskId)}`, {
        method: 'DELETE',
      })
    );

  const onPause = (taskId: string) =>
    mutate(() =>
      fetch('/api/download', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId, action: 'pause' }),
      })
    );

  const onResume = (taskId: string) =>
    mutate(() =>
      fetch('/api/download', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId, action: 'resume' }),
      })
    );

  if (loading) {
    return (
      <div className='text-sm text-gray-600 dark:text-gray-300'>加载中...</div>
    );
  }

  return (
    <div className='space-y-3'>
      {error && (
        <div className='text-sm text-red-600 dark:text-red-400'>
          网络异常：{error}（将自动重试）
        </div>
      )}

      {tasks.length === 0 ? (
        <div className='text-sm text-gray-600 dark:text-gray-300'>
          暂无下载任务
        </div>
      ) : (
        <div className='space-y-3'>
          {tasks
            .slice()
            .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
            .map((t) => (
              <div
                key={t.task_id}
                className='rounded-lg border border-gray-200/60 dark:border-gray-700/60 bg-white/40 dark:bg-gray-900/40 p-4'
              >
                <div className='flex items-start justify-between gap-3'>
                  <div className='min-w-0'>
                    <div className='font-medium text-gray-900 dark:text-gray-100 truncate'>
                      {t.title || `${t.source}_${t.id}`}
                      {t.year ? ` (${t.year})` : ''}
                    </div>
                    <div className='mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300'>
                      <DownloadStatusBadge status={t.status} />
                      <span>
                        进度 {Math.max(0, Math.min(100, t.progress || 0))}%
                      </span>
                      {Array.isArray(t.episode_numbers) &&
                        t.episode_numbers.length > 0 && (
                          <span>
                            集数 {t.episode_numbers.slice(0, 6).join(',')}
                            {t.episode_numbers.length > 6 ? '…' : ''}
                          </span>
                        )}
                    </div>
                    {t.error && (
                      <div className='mt-2 text-xs text-red-600 dark:text-red-400'>
                        {t.error}
                      </div>
                    )}
                  </div>

                  <div className='flex flex-col gap-2 flex-shrink-0'>
                    {(t.status === 'pending' || t.status === 'downloading') && (
                      <button
                        onClick={() => onPause(t.task_id)}
                        className='px-3 py-1 rounded bg-yellow-500/90 hover:bg-yellow-500 text-white text-xs'
                      >
                        暂停
                      </button>
                    )}
                    {t.status === 'paused' && (
                      <button
                        onClick={() => onResume(t.task_id)}
                        className='px-3 py-1 rounded bg-blue-500/90 hover:bg-blue-500 text-white text-xs'
                      >
                        恢复
                      </button>
                    )}
                    {(t.status === 'pending' ||
                      t.status === 'downloading' ||
                      t.status === 'paused') && (
                      <button
                        onClick={() => onCancel(t.task_id)}
                        className='px-3 py-1 rounded bg-gray-600/90 hover:bg-gray-600 text-white text-xs'
                      >
                        取消
                      </button>
                    )}
                  </div>
                </div>

                <div className='mt-3 h-2 w-full bg-gray-200/70 dark:bg-gray-800 rounded overflow-hidden'>
                  <div
                    className='h-full bg-green-500 transition-all'
                    style={{
                      width: `${Math.max(0, Math.min(100, t.progress || 0))}%`,
                    }}
                  />
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
