import {
  redactDownloadUrl,
  redactUrlsInText,
} from '@/lib/download-transaction';
import { DownloadTaskSnapshot } from '@/lib/download-types';

export interface PublicAdFilterSummary {
  original_segments: number;
  removed_segments: number;
  final_segments: number;
  removed_duration_seconds: number;
  filter_version: string;
  reason?: string;
  matched_reasons?: string[];
  validation_passed: boolean;
}

function ranges(indices: number[]): Array<[number, number]> {
  const sorted = Array.from(new Set(indices))
    .filter((index) => Number.isInteger(index) && index >= 0)
    .sort((left, right) => left - right);
  const result: Array<[number, number]> = [];
  for (const index of sorted) {
    const current = result[result.length - 1];
    if (current && index === current[1] + 1) current[1] = index;
    else result.push([index, index]);
  }
  return result;
}

function publicPath(value: string): string {
  if (/^https?:\/\//i.test(value)) return redactDownloadUrl(value);
  return value.split(/[\\/]/).filter(Boolean).pop() ?? '';
}

export function summarizeDownloadTask(snapshot: DownloadTaskSnapshot) {
  const episodes = Object.values(snapshot.episodes);
  const current =
    (snapshot.currentEpisode !== null
      ? snapshot.episodes[String(snapshot.currentEpisode)]
      : undefined) ?? episodes.find((episode) => episode.stage !== 'completed');
  const totalSegments = episodes.reduce(
    (total, episode) => total + episode.totalSegments,
    0
  );
  const completedSegments = episodes.reduce(
    (total, episode) => total + episode.completedSegmentIndices.length,
    0
  );
  const activeItems = episodes.reduce(
    (total, episode) => total + episode.activeItems.length,
    0
  );
  const failures = episodes.flatMap((episode) => episode.failures);
  return {
    task_id: snapshot.taskId,
    source: snapshot.source,
    id: snapshot.resourceId,
    title: snapshot.title,
    year: snapshot.year,
    poster: snapshot.poster ? redactDownloadUrl(snapshot.poster) : undefined,
    episode_numbers: snapshot.episodeNumbers,
    status: snapshot.status,
    priority: snapshot.priority,
    current_episode: snapshot.currentEpisode,
    current_stage: current?.stage ?? null,
    progress: snapshot.progress,
    progress_estimated: snapshot.progressEstimated,
    speed_bytes_per_second: snapshot.speedBytesPerSecond,
    eta_seconds: snapshot.etaSeconds,
    completed_bytes: snapshot.completedBytes,
    segments: {
      total: totalSegments,
      completed: completedSegments,
      active: activeItems,
      retries: failures.reduce(
        (total, failure) => total + Math.max(0, failure.attempts - 1),
        0
      ),
      failed: failures.length,
    },
    recoverable: episodes.some((episode) => episode.recoverable),
    polling_fallback: false,
    created_at: snapshot.createdAt,
    updated_at: snapshot.updatedAt,
  };
}

export function detailDownloadTask(
  snapshot: DownloadTaskSnapshot,
  adFilterByEpisode: Record<string, PublicAdFilterSummary> = {}
) {
  return {
    ...summarizeDownloadTask(snapshot),
    episodes: Object.values(snapshot.episodes).map((episode) => ({
      episode: episode.episode,
      stage: episode.stage,
      generation_id: episode.generationId,
      segment_ranges: {
        completed: ranges(episode.completedSegmentIndices),
        failed: ranges(episode.failedSegmentIndices),
      },
      segments: {
        total: episode.totalSegments,
        completed: episode.completedSegmentIndices.length,
        active: episode.activeItems.length,
        failed: episode.failedSegmentIndices.length,
      },
      key: { total: episode.keyTotal, completed: episode.keyCompleted },
      map: { total: episode.mapTotal, completed: episode.mapCompleted },
      active_items: episode.activeItems.map(
        ({ taskId: _taskId, ...item }) => item
      ),
      failures: episode.failures.map((failure) => ({
        ...failure,
        path: publicPath(failure.path),
        message: redactUrlsInText(failure.message),
      })),
      completed_bytes: episode.completedBytes,
      estimated_bytes: episode.estimatedBytes,
      progress: episode.progress,
      progress_estimated: episode.progressEstimated,
      speed_bytes_per_second: episode.speedBytesPerSecond,
      eta_seconds: episode.etaSeconds,
      old_entry_retained: episode.oldEntryRetained,
      recoverable: episode.recoverable,
      refresh_count: episode.refreshCount,
      ad_filter: adFilterByEpisode[String(episode.episode)] ?? null,
      updated_at: episode.updatedAt,
    })),
  };
}
