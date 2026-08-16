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
    speed_bytes_per_second?: number;
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
  address_source?:
    | 'direct'
    | 'parsed'
    | 'refreshed'
    | 'client_fallback'
    | 'historical_fallback'
    | null;
  updated_at: number;
}
export interface DownloadTaskDetail extends DownloadTaskSummary {
  scheduler_slots?: {
    task_active: number;
    global_active: number;
    global_total: number;
  };
  episodes: DownloadEpisodeDetail[];
}
export default function DownloadTaskDetails({
  detail,
  onCommand,
  commandBusy = false,
}: {
  detail: DownloadTaskDetail;
  onCommand: (
    taskId: string,
    action: DownloadCommandAction
  ) => Promise<void> | void;
  commandBusy?: boolean;
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
        schedulerSlots={detail.scheduler_slots}
        onCommand={onCommand}
        commandBusy={commandBusy}
      />
    </div>
  );
}
export type { DownloadTaskSummary } from './DownloadTaskCard';
