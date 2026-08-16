import type { DownloadCommandAction } from '@/hooks/useDownloadTasks';

import type { DownloadTaskSummary } from './DownloadTaskCard';
import EpisodeProgressPanel from './EpisodeProgressPanel';
import SegmentDiagnostics from './SegmentDiagnostics';

export interface DownloadEpisodeDetail {
  episode: number;
  stage: string;
  generation_id: string;
  segment_ranges: {
    completed: Array<[number, number]>;
    failed: Array<[number, number]>;
  };
  segments: {
    total: number;
    completed: number;
    active: number;
    failed: number;
  };
  key: { total: number; completed: number };
  map: { total: number; completed: number };
  active_items: Array<{
    episode: number;
    generationId: string;
    kind: 'segment' | 'key' | 'map';
    index: number;
    attempt: number;
  }>;
  failures: Array<{
    kind: 'segment' | 'key' | 'map';
    index: number;
    category: string;
    attempts: number;
    path: string;
    message: string;
  }>;
  completed_bytes: number;
  estimated_bytes: number | null;
  progress: number;
  progress_estimated: boolean;
  speed_bytes_per_second: number;
  eta_seconds: number | null;
  old_entry_retained: boolean;
  recoverable: boolean;
  refresh_count: number;
  ad_filter: null | {
    original_segments: number;
    removed_segments: number;
    final_segments: number;
    removed_duration_seconds: number;
    filter_version: string;
    reason?: string;
    matched_reasons?: string[];
    validation_passed: boolean;
  };
  updated_at: number;
}
export interface DownloadTaskDetail extends DownloadTaskSummary {
  episodes: DownloadEpisodeDetail[];
}
export default function DownloadTaskDetails({
  detail,
  onCommand,
}: {
  detail: DownloadTaskDetail;
  onCommand: (
    taskId: string,
    action: DownloadCommandAction
  ) => Promise<void> | void;
}) {
  return (
    <div className='space-y-4'>
      <div className='grid gap-3 lg:grid-cols-2'>
        {detail.episodes.map((episode) => (
          <EpisodeProgressPanel key={episode.episode} episode={episode} />
        ))}
      </div>
      <SegmentDiagnostics
        taskId={detail.task_id}
        episodes={detail.episodes}
        onCommand={onCommand}
      />
    </div>
  );
}
export type { DownloadTaskSummary } from './DownloadTaskCard';
