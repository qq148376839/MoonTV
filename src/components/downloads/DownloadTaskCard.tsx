'use client';

import { useEffect, useState } from 'react';

import type { DownloadCommandAction } from '@/hooks/useDownloadTasks';

import DownloadTaskDetails, { DownloadTaskDetail } from './DownloadTaskDetails';

export interface DownloadTaskSummary {
  task_id: string;
  source?: string;
  id?: string;
  title?: string;
  year?: string;
  poster?: string;
  episode_numbers?: number[];
  status: string;
  priority?: 'normal' | 'high';
  current_episode?: number | null;
  current_stage?: string | null;
  progress: number;
  progress_estimated?: boolean;
  speed_bytes_per_second?: number;
  eta_seconds?: number | null;
  completed_bytes?: number;
  segments?: {
    total: number;
    completed: number;
    active: number;
    retries: number;
    failed: number;
  };
  recoverable?: boolean;
  polling_fallback?: boolean;
  error?: string;
  created_at: number;
  updated_at: number;
}

type Props = {
  task: DownloadTaskSummary;
  loadDetails?: (taskId: string) => Promise<DownloadTaskDetail>;
  onCommand: (
    taskId: string,
    action: DownloadCommandAction
  ) => Promise<void> | void;
};

const stageNames: Record<string, string> = {
  queued: '等待调度',
  preparing: '准备与过滤广告',
  downloading: '下载分片',
  validating: '完整性校验',
  committing: '安全提交',
  completed: '已完成',
  pausing: '正在暂停',
  paused: '已暂停',
  partial_failed: '部分失败',
  cancelled_resumable: '已取消，可恢复',
  recovery_wait: '等待恢复',
};
const statusNames: Record<string, string> = {
  pending: '排队中',
  downloading: '下载中',
  paused: '已暂停',
  recovery_wait: '等待手动恢复',
  partial_completed: '部分完成',
  completed: '已完成',
  failed: '下载失败',
  cancelled_resumable: '已取消，可恢复',
};

function formatBytes(value = 0): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4);
  const amount = value / 1024 ** index;
  return `${
    amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)
  } ${units[index]}`;
}

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return '—';
  const seconds = Math.max(0, Math.round(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(
        2,
        '0'
      )}:${String(rest).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function redactSignedUrls(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
    try {
      const url = new URL(candidate);
      return `${url.origin}${url.pathname}`;
    } catch {
      return '[已脱敏地址]';
    }
  });
}

export default function DownloadTaskCard({
  task,
  loadDetails,
  onCommand,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<DownloadTaskDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClean, setConfirmClean] = useState(false);
  const progress = Math.max(0, Math.min(100, Number(task.progress) || 0));
  const speed = task.speed_bytes_per_second ?? 0;
  const current = task.current_episode
    ? `第 ${task.current_episode} 集 · ${
        stageNames[task.current_stage ?? ''] ?? task.current_stage ?? '等待状态'
      }`
    : stageNames[task.current_stage ?? ''] ?? '等待状态';

  const run = async (action: DownloadCommandAction) => {
    setBusy(true);
    setActionError(null);
    try {
      await onCommand(task.task_id, action);
      setDetail(null);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const runDetailCommand = (_taskId: string, action: DownloadCommandAction) =>
    run(action);
  useEffect(() => {
    if (!expanded || !loadDetails) return;
    let active = true;
    setDetailError(null);
    void loadDetails(task.task_id)
      .then((next) => {
        if (active) setDetail(next);
      })
      .catch((reason) => {
        if (active)
          setDetailError(
            reason instanceof Error ? reason.message : String(reason)
          );
      });
    return () => {
      active = false;
    };
  }, [expanded, loadDetails, task.task_id, task.updated_at]);

  const active = ['pending', 'downloading'].includes(task.status);
  const resumable =
    ['paused', 'recovery_wait', 'cancelled_resumable'].includes(task.status) ||
    (task.recoverable === true &&
      ['partial_completed', 'failed'].includes(task.status));
  const cancellable =
    active || ['paused', 'recovery_wait'].includes(task.status);
  const cleanable = [
    'paused',
    'recovery_wait',
    'cancelled_resumable',
    'failed',
    'partial_completed',
  ].includes(task.status);

  return (
    <article className='overflow-hidden rounded-xl border border-gray-200/70 bg-white/60 shadow-sm dark:border-gray-700/70 dark:bg-gray-900/50'>
      <div className='p-4 sm:p-5'>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
          <div className='min-w-0'>
            <h3 className='truncate font-medium text-gray-900 dark:text-gray-100'>
              {task.title || `${task.source}_${task.id}`}
              {task.year ? ` (${task.year})` : ''}
            </h3>
            <div className='mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300'>
              <span className='inline-flex rounded bg-blue-500/10 px-2 py-1 text-blue-700 dark:text-blue-300'>
                {statusNames[task.status] ?? task.status}
              </span>
              {task.priority === 'high' && <span>优先任务</span>}
              <span>{current}</span>
            </div>
          </div>
          <div className='flex flex-wrap gap-2' aria-label='任务操作'>
            {active && (
              <button
                disabled={busy}
                onClick={() => void run('pause')}
                className='min-h-10 rounded-md border border-gray-300 px-3 py-2 text-xs font-medium dark:border-gray-600'
              >
                暂停
              </button>
            )}
            {resumable && (
              <button
                disabled={busy}
                onClick={() => void run('resume')}
                className='min-h-10 rounded-md border border-gray-300 px-3 py-2 text-xs font-medium dark:border-gray-600'
              >
                {['partial_completed', 'failed'].includes(task.status)
                  ? '恢复下载'
                  : '恢复'}
              </button>
            )}
            {cancellable && (
              <button
                disabled={busy}
                onClick={() => void run('cancel')}
                className='min-h-10 rounded-md border border-gray-300 px-3 py-2 text-xs font-medium dark:border-gray-600'
              >
                取消
              </button>
            )}
            {task.priority !== 'high' && active && (
              <button
                disabled={busy}
                onClick={() => void run('prioritize')}
                className='min-h-10 rounded-md border border-gray-300 px-3 py-2 text-xs font-medium dark:border-gray-600'
              >
                设为优先
              </button>
            )}
            {cleanable && (
              <button
                disabled={busy}
                onClick={() => setConfirmClean(true)}
                className='min-h-10 rounded-md bg-red-600 px-3 py-2 text-xs font-medium text-white'
              >
                删除临时数据
              </button>
            )}
          </div>
        </div>

        <div className='mt-4 flex items-baseline justify-between text-sm'>
          <span className='font-medium text-gray-800 dark:text-gray-100'>
            {task.progress_estimated ? '约 ' : ''}
            {progress.toFixed(1)}%
          </span>
          <span className='text-xs text-gray-500 dark:text-gray-400'>
            已写入 {formatBytes(task.completed_bytes)}
          </span>
        </div>
        <div
          role='progressbar'
          aria-label='总下载进度'
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className='mt-2 h-2.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800'
        >
          <div
            className='h-full rounded-full bg-green-500 transition-[width]'
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className='mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300 sm:grid-cols-4'>
          <span>
            {task.segments
              ? `${task.segments.completed} / ${task.segments.total} 分片`
              : '分片 —'}
          </span>
          <span>{speed > 0 ? `${formatBytes(speed)}/s` : '速度 —'}</span>
          <span>剩余 {formatDuration(task.eta_seconds)}</span>
          <span>
            {task.segments
              ? `活动 ${task.segments.active} · 排队 ${Math.max(
                  0,
                  task.segments.total -
                    task.segments.completed -
                    task.segments.active -
                    task.segments.failed
                )}`
              : '并发 —'}
          </span>
        </div>
        {task.error && (
          <p
            role='alert'
            className='mt-3 text-sm text-red-600 dark:text-red-400'
          >
            {redactSignedUrls(task.error)}
          </p>
        )}
        {actionError && (
          <p
            role='alert'
            className='mt-3 text-sm text-red-600 dark:text-red-400'
          >
            {actionError}
          </p>
        )}
        <button
          type='button'
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className='mt-4 min-h-10 text-sm font-medium text-blue-600 dark:text-blue-300'
        >
          {expanded ? '收起详情' : '展开详情'}
        </button>
      </div>

      {expanded && (
        <div className='border-t border-gray-200/70 bg-gray-50/60 p-4 dark:border-gray-700/70 dark:bg-gray-950/30'>
          {detail ? (
            <>
              {detailError && (
                <p role='alert' className='mb-3 text-sm text-amber-700'>
                  详情刷新失败，当前显示上次数据：
                  {redactSignedUrls(detailError)}
                </p>
              )}
              <DownloadTaskDetails
                detail={detail}
                onCommand={runDetailCommand}
                commandBusy={busy}
              />
            </>
          ) : detailError ? (
            <p role='alert' className='text-sm text-red-600'>
              {redactSignedUrls(detailError)}
            </p>
          ) : (
            <p role='status' className='text-sm text-gray-500'>
              正在加载详情…
            </p>
          )}
        </div>
      )}

      {confirmClean && (
        <div
          role='dialog'
          aria-modal='true'
          aria-labelledby={`clean-${task.task_id}`}
          className='border-t border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/20'
        >
          <h4
            id={`clean-${task.task_id}`}
            className='font-medium text-red-800 dark:text-red-200'
          >
            删除未提交的临时数据？
          </h4>
          <p className='mt-1 text-sm text-red-700 dark:text-red-300'>
            正式影片和旧播放入口不会删除，此操作无法撤销。
          </p>
          <div className='mt-3 flex gap-2'>
            <button
              onClick={() => setConfirmClean(false)}
              className='min-h-10 rounded-md border border-gray-300 px-3 py-2 text-xs font-medium dark:border-gray-600'
            >
              返回
            </button>
            <button
              onClick={() => {
                setConfirmClean(false);
                void run('cancel_and_clean');
              }}
              className='min-h-10 rounded-md bg-red-600 px-3 py-2 text-xs font-medium text-white'
            >
              确认删除临时数据
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
