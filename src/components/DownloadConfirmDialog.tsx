/* eslint-disable no-console */

'use client';

import React, { useMemo, useState } from 'react';

import { SearchResult } from '@/lib/types';

type Mode = 'current' | 'select' | 'range' | 'all' | 'next';

function parseEpisodeSpec(spec: string): number[] {
  const s = spec.trim();
  if (!s) return [];
  const parts = s
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  const out: number[] = [];
  for (const part of parts) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      for (let i = start; i <= end; i++) out.push(i);
    } else {
      const n = Number(part);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return Array.from(new Set(out.filter((n) => n >= 1))).sort((a, b) => a - b);
}

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export default function DownloadConfirmDialog({
  open,
  onClose,
  detail,
  currentEpisodeIndex,
}: {
  open: boolean;
  onClose: () => void;
  detail: SearchResult;
  currentEpisodeIndex: number; // 0-based
}) {
  const totalEpisodes = Array.isArray(detail.episodes)
    ? detail.episodes.length
    : 0;
  const currentEpisodeNumber = currentEpisodeIndex + 1;

  const [mode, setMode] = useState<Mode>('current');
  const [rangeStart, setRangeStart] = useState(String(currentEpisodeNumber));
  const [rangeEnd, setRangeEnd] = useState(String(currentEpisodeNumber));
  const [spec, setSpec] = useState(String(currentEpisodeNumber));
  const [submitting, setSubmitting] = useState(false);
  const [forceRedownload, setForceRedownload] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);
  const [resultType, setResultType] = useState<'ok' | 'warn' | 'error'>('ok');

  const parsedSpec = useMemo(() => parseEpisodeSpec(spec), [spec]);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setResultText(null);

    try {
      const body: {
        source: string;
        id: string;
        // 由前端传入完整详情，避免服务端依赖 config.json / 特殊源导致的详情拉取失败
        resource?: SearchResult;
        episode_numbers?: number[];
        episode_range?: { start: number; end: number };
        auto_download_next?: boolean;
        current_episode?: number;
        force_redownload?: boolean;
      } = {
        source: detail.source,
        id: detail.id,
        resource: detail,
      };
      if (forceRedownload) body.force_redownload = true;

      if (mode === 'current') {
        body.episode_numbers = [currentEpisodeNumber];
      } else if (mode === 'select') {
        const nums = parsedSpec.filter((n) => n <= totalEpisodes);
        if (nums.length === 0) throw new Error('请选择有效集数');
        body.episode_numbers = nums;
      } else if (mode === 'range') {
        const start = Math.max(1, Number(rangeStart || 1));
        const end = Math.max(1, Number(rangeEnd || start));
        body.episode_range = { start, end };
      } else if (mode === 'all') {
        body.episode_range = { start: 1, end: totalEpisodes || 1 };
      } else if (mode === 'next') {
        body.auto_download_next = true;
        body.current_episode = currentEpisodeNumber;
      }

      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await safeJson(res);
      if (!res.ok) {
        throw new Error(data?.error || `请求失败: ${res.status}`);
      }

      const msg =
        data?.message ||
        (data?.is_already_downloaded
          ? '已下载，无需重复下载'
          : data?.is_existing
          ? '下载任务进行中，可在「离线」查看进度'
          : '下载任务已创建');

      setResultType(
        data?.is_already_downloaded || data?.is_existing ? 'warn' : 'ok'
      );
      setResultText(msg);
    } catch (e) {
      setResultType('error');
      setResultText(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className='fixed inset-0 z-[800] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4'
      onClick={onClose}
    >
      <div
        className='w-full max-w-lg rounded-xl bg-white dark:bg-gray-900 shadow-xl border border-gray-200/60 dark:border-gray-700/60'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='p-5 border-b border-gray-200/60 dark:border-gray-700/60 flex items-center justify-between'>
          <div className='font-semibold text-gray-900 dark:text-gray-100'>
            下载确认
          </div>
          <button
            onClick={onClose}
            className='text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          >
            关闭
          </button>
        </div>

        <div className='p-5 space-y-4'>
          <div className='text-sm text-gray-700 dark:text-gray-300'>
            {detail.title} {detail.year ? `(${detail.year})` : ''}
          </div>

          <div className='grid grid-cols-2 gap-2'>
            <button
              onClick={() => setMode('current')}
              className={`px-3 py-2 rounded text-sm border ${
                mode === 'current'
                  ? 'bg-green-500 text-white border-green-500'
                  : 'border-gray-200/60 dark:border-gray-700/60 text-gray-800 dark:text-gray-200'
              }`}
            >
              下载当前集
            </button>
            <button
              onClick={() => setMode('select')}
              className={`px-3 py-2 rounded text-sm border ${
                mode === 'select'
                  ? 'bg-green-500 text-white border-green-500'
                  : 'border-gray-200/60 dark:border-gray-700/60 text-gray-800 dark:text-gray-200'
              }`}
            >
              选择集数
            </button>
            <button
              onClick={() => setMode('range')}
              className={`px-3 py-2 rounded text-sm border ${
                mode === 'range'
                  ? 'bg-green-500 text-white border-green-500'
                  : 'border-gray-200/60 dark:border-gray-700/60 text-gray-800 dark:text-gray-200'
              }`}
            >
              按范围下载
            </button>
            <button
              onClick={() => setMode('all')}
              className={`px-3 py-2 rounded text-sm border ${
                mode === 'all'
                  ? 'bg-green-500 text-white border-green-500'
                  : 'border-gray-200/60 dark:border-gray-700/60 text-gray-800 dark:text-gray-200'
              }`}
            >
              下载全部
            </button>
            <button
              onClick={() => setMode('next')}
              className={`px-3 py-2 rounded text-sm border col-span-2 ${
                mode === 'next'
                  ? 'bg-green-500 text-white border-green-500'
                  : 'border-gray-200/60 dark:border-gray-700/60 text-gray-800 dark:text-gray-200'
              }`}
            >
              自动下载后续 N 集
            </button>
          </div>

          {mode === 'select' && (
            <div className='space-y-1'>
              <div className='text-xs text-gray-600 dark:text-gray-400'>
                例：`1,2,10-12`
              </div>
              <input
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
                className='w-full px-3 py-2 rounded border border-gray-200/60 dark:border-gray-700/60 bg-white/60 dark:bg-gray-900/40 text-sm'
              />
              <div className='text-xs text-gray-600 dark:text-gray-400'>
                将下载：{parsedSpec.slice(0, 20).join(',')}
                {parsedSpec.length > 20 ? '…' : ''}
              </div>
            </div>
          )}

          {mode === 'range' && (
            <div className='flex items-center gap-2'>
              <input
                value={rangeStart}
                onChange={(e) => setRangeStart(e.target.value)}
                className='w-24 px-3 py-2 rounded border border-gray-200/60 dark:border-gray-700/60 bg-white/60 dark:bg-gray-900/40 text-sm'
              />
              <span className='text-sm text-gray-600 dark:text-gray-400'>
                到
              </span>
              <input
                value={rangeEnd}
                onChange={(e) => setRangeEnd(e.target.value)}
                className='w-24 px-3 py-2 rounded border border-gray-200/60 dark:border-gray-700/60 bg-white/60 dark:bg-gray-900/40 text-sm'
              />
              <span className='text-xs text-gray-600 dark:text-gray-400'>
                （共 {totalEpisodes} 集）
              </span>
            </div>
          )}

          <label className='flex items-start gap-3 rounded border border-amber-300/60 bg-amber-500/10 px-3 py-3 text-sm text-amber-900 dark:text-amber-200'>
            <input
              type='checkbox'
              checked={forceRedownload}
              onChange={(event) => setForceRedownload(event.target.checked)}
              className='mt-0.5'
            />
            <span>
              <span className='block font-medium'>重新抓取源并安全替换</span>
              <span className='mt-1 block text-xs opacity-80'>
                旧版本会保留到新版本完整验证通过；重下期间需要额外临时空间。
              </span>
            </span>
          </label>

          {resultText && (
            <div
              className={`text-sm rounded px-3 py-2 ${
                resultType === 'ok'
                  ? 'bg-green-500/10 text-green-700 dark:text-green-300'
                  : resultType === 'warn'
                  ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300'
                  : 'bg-red-500/10 text-red-700 dark:text-red-300'
              }`}
            >
              {resultText}
            </div>
          )}
        </div>

        <div className='p-5 border-t border-gray-200/60 dark:border-gray-700/60 flex items-center justify-end gap-2'>
          <button
            onClick={onClose}
            className='px-4 py-2 rounded bg-gray-200/80 hover:bg-gray-200 text-gray-800 text-sm dark:bg-white/10 dark:hover:bg-white/20 dark:text-gray-200'
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className='px-4 py-2 rounded bg-green-600 hover:bg-green-700 text-white text-sm disabled:opacity-60'
          >
            {submitting ? '提交中...' : '开始下载'}
          </button>
        </div>
      </div>
    </div>
  );
}
