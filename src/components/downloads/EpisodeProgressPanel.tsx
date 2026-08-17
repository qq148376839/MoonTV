import type { DownloadEpisodeDetail } from './DownloadTaskDetails';

const stages = ['准备', 'KEY/MAP', '媒体', '校验', '提交'];
const stageOrder: Record<string, number> = {
  queued: -1,
  preparing: 0,
  downloading: 2,
  validating: 3,
  committing: 4,
  completed: 5,
  pausing: 2,
  paused: 2,
  partial_failed: 2,
  cancelled_resumable: 2,
  recovery_wait: 0,
};

const addressSourceNames: Record<string, string> = {
  direct: '直接获取',
  parsed: '解析获取',
  refreshed: '刷新后获取',
  client_fallback: '客户端回退获取',
  historical_fallback: '历史记录回退获取',
};

export default function EpisodeProgressPanel({
  episode,
}: {
  episode: DownloadEpisodeDetail;
}) {
  const current = stageOrder[episode.stage] ?? -1;
  return (
    <section
      aria-labelledby={`episode-${episode.episode}`}
      className='rounded-lg border border-gray-200 p-3 dark:border-gray-700'
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h4
          id={`episode-${episode.episode}`}
          className='font-medium text-gray-900 dark:text-gray-100'
        >
          第 {episode.episode} 集
        </h4>
        <span className='text-xs text-gray-500'>
          {episode.progress_estimated ? '约 ' : ''}
          {Math.max(0, Math.min(100, episode.progress)).toFixed(1)}%
        </span>
      </div>
      <ol
        className='mt-3 grid grid-cols-5 gap-1 text-center text-[11px]'
        aria-label='下载阶段'
      >
        {stages.map((label, index) => (
          <li
            key={label}
            className={`rounded px-1 py-1.5 ${
              index <= current
                ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
            }`}
          >
            {label}
          </li>
        ))}
      </ol>
      <div className='mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300'>
        <span>
          KEY {episode.key.completed} / {episode.key.total}
        </span>
        <span>
          MAP {episode.map.completed} / {episode.map.total}
        </span>
        <span>{episode.recoverable ? '可恢复' : '不可恢复'}</span>
        <span>
          地址来源：
          {episode.address_source
            ? addressSourceNames[episode.address_source] ?? '未知来源'
            : '未知来源'}
        </span>
        <span>
          {episode.old_entry_retained
            ? '旧播放入口已保留'
            : episode.stage === 'completed'
            ? '新版本已安全提交'
            : '无旧播放入口'}
        </span>
      </div>
      <div className='mt-3 rounded-md bg-gray-100 p-2 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300'>
        {episode.ad_filter ? (
          <>
            广告过滤：从 {episode.ad_filter.original_segments} 个分片中过滤{' '}
            {episode.ad_filter.removed_segments} 个分片，保留{' '}
            {episode.ad_filter.final_segments} 个
            {episode.ad_filter.removed_duration_seconds > 0
              ? `（约 ${episode.ad_filter.removed_duration_seconds.toFixed(
                  1
                )} 秒）`
              : ''}{' '}
            · {episode.ad_filter.validation_passed ? '校验通过' : '校验未通过'}
          </>
        ) : (
          '广告过滤：暂无可信摘要'
        )}
      </div>
    </section>
  );
}
