import type { DownloadCommandAction } from '@/hooks/useDownloadTasks';

import type { DownloadEpisodeDetail } from './DownloadTaskDetails';

const rangeLabel = (range: [number, number]) =>
  range[0] === range[1] ? String(range[0]) : `${range[0]}–${range[1]}`;
const redactSignedUrls = (value: string) =>
  value.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
    try {
      const url = new URL(candidate);
      return `${url.origin}${url.pathname}`;
    } catch {
      return '[已脱敏地址]';
    }
  });

export default function SegmentDiagnostics({
  taskId,
  episodes,
  schedulerSlots,
  onCommand,
  commandBusy = false,
}: {
  taskId: string;
  episodes: DownloadEpisodeDetail[];
  schedulerSlots?: {
    task_active: number;
    global_active: number;
    global_total: number;
  };
  onCommand: (
    taskId: string,
    action: DownloadCommandAction
  ) => Promise<void> | void;
  commandBusy?: boolean;
}) {
  const totals = episodes.reduce(
    (r, e) => ({
      total: r.total + e.segments.total,
      completed: r.completed + e.segments.completed,
      active: r.active + e.segments.active,
      failed: r.failed + e.segments.failed,
    }),
    { total: 0, completed: 0, active: 0, failed: 0 }
  );
  const queued = Math.max(
    0,
    totals.total - totals.completed - totals.active - totals.failed
  );
  const failures = episodes.flatMap((e) =>
    e.failures.map((failure) => ({ episode: e.episode, ...failure }))
  );
  const active = episodes.flatMap((episode) => episode.active_items);
  return (
    <section aria-labelledby={`segments-${taskId}`} className='space-y-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h4
          id={`segments-${taskId}`}
          className='font-medium text-gray-900 dark:text-gray-100'
        >
          分片诊断
        </h4>
        <span className='text-xs text-gray-500'>
          本任务占用 {schedulerSlots?.task_active ?? active.length} · 全局占用{' '}
          {schedulerSlots?.global_active ?? '—'} / 总槽位{' '}
          {schedulerSlots?.global_total ?? '—'}
        </span>
      </div>
      <div className='grid grid-cols-2 gap-2 text-xs sm:grid-cols-5'>
        <span className='rounded bg-green-500/10 p-2 text-green-700'>
          成功 {totals.completed}
        </span>
        <span className='rounded bg-blue-500/10 p-2 text-blue-700'>
          活动 {totals.active}
        </span>
        <span className='rounded bg-gray-500/10 p-2'>等待 {queued}</span>
        <span className='rounded bg-yellow-500/10 p-2 text-yellow-700'>
          重试 {failures.filter((x) => x.attempts > 1).length}
        </span>
        <span className='rounded bg-red-500/10 p-2 text-red-700'>
          失败 {totals.failed}
        </span>
      </div>
      <div className='hidden space-y-2 sm:block' aria-label='分片状态区间'>
        {episodes.map((e) => (
          <div
            key={e.episode}
            className='text-xs text-gray-600 dark:text-gray-300'
          >
            第 {e.episode} 集 · 成功区间{' '}
            {e.segment_ranges.completed.map(rangeLabel).join(', ') || '—'} ·
            失败区间 {e.segment_ranges.failed.map(rangeLabel).join(', ') || '—'}
          </div>
        ))}
      </div>
      {active.length > 0 && (
        <div className='hidden overflow-x-auto sm:block'>
          <table className='w-full text-left text-xs'>
            <caption className='sr-only'>当前并发槽位</caption>
            <thead>
              <tr>
                <th className='py-1'>剧集</th>
                <th>类型</th>
                <th>分片</th>
                <th>尝试</th>
                <th>当前速度</th>
              </tr>
            </thead>
            <tbody>
              {active.map((item, index) => (
                <tr
                  key={`${item.episode}-${item.kind}-${item.index}-${index}`}
                  className='border-t'
                >
                  <td className='py-1'>第 {item.episode} 集</td>
                  <td>{item.kind.toUpperCase()}</td>
                  <td>{item.index}</td>
                  <td>{item.attempt}</td>
                  <td>{formatSpeed(item.speed_bytes_per_second)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {failures.length > 0 && (
        <div className='space-y-2'>
          <div className='flex items-center justify-between gap-2'>
            <h5 className='text-sm font-medium text-red-700'>失败项</h5>
            <button
              disabled={commandBusy}
              onClick={() => void onCommand(taskId, 'retry_failed')}
              className='min-h-10 rounded-md bg-red-600 px-3 py-2 text-xs font-medium text-white'
            >
              仅重试失败项
            </button>
          </div>
          <ul className='space-y-2'>
            {failures.map((f) => (
              <li
                key={`${f.episode}-${f.kind}-${f.index}`}
                className='rounded-md border border-red-200 p-2 text-xs'
              >
                <div className='font-medium text-red-700'>
                  第 {f.episode} 集 · {f.kind.toUpperCase()} {f.index} ·{' '}
                  {f.category} · {f.attempts} 次
                </div>
                <div className='mt-1 break-all'>{redactSignedUrls(f.path)}</div>
                <div className='mt-1 text-gray-500'>
                  {redactSignedUrls(f.message)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function formatSpeed(value: number | undefined): string {
  if (!Number.isFinite(value) || !value || value <= 0) return '—';
  const megabytes = value / 1024 / 1024;
  return `${
    megabytes >= 10 ? megabytes.toFixed(0) : megabytes.toFixed(1)
  } MB/s`;
}
