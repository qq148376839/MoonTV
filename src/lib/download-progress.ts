import type { EpisodeDownloadState } from './download-types';

export interface DownloadProgress {
  progress: number;
  estimated: boolean;
}

const clampProgress = (value: number): number =>
  Math.min(100, Math.max(0, value));

const clampRatio = (value: number): number => Math.min(1, Math.max(0, value));

const downloadingProgress = (
  episode: EpisodeDownloadState
): DownloadProgress => {
  if (episode.estimatedBytes !== null && episode.estimatedBytes > 0) {
    return {
      progress: clampProgress(
        10 + clampRatio(episode.completedBytes / episode.estimatedBytes) * 85
      ),
      estimated: false,
    };
  }

  const ratio =
    episode.totalSegments > 0
      ? episode.completedSegmentIndices.length / episode.totalSegments
      : 0;
  return {
    progress: clampProgress(10 + clampRatio(ratio) * 85),
    estimated: true,
  };
};

export function calculateEpisodeProgress(
  episode: EpisodeDownloadState
): DownloadProgress {
  switch (episode.stage) {
    case 'queued':
      return { progress: 0, estimated: false };
    case 'preparing':
      return { progress: 2.5, estimated: false };
    case 'downloading':
      return downloadingProgress(episode);
    case 'validating':
      return { progress: 95, estimated: false };
    case 'committing':
      return { progress: 97.5, estimated: false };
    case 'completed':
      return { progress: 100, estimated: false };
    default:
      return {
        progress: clampProgress(episode.progress),
        estimated: episode.progressEstimated,
      };
  }
}

export class DownloadSpeedWindow {
  private readonly windowMs: number;
  private samples: Array<{ timestamp: number; bytes: number }> = [];

  public constructor(windowSeconds = 10) {
    this.windowMs = windowSeconds * 1000;
  }

  public addSample(timestamp: number, completedBytes: number): void {
    this.samples.push({ timestamp, bytes: completedBytes });
    const cutoff = timestamp - this.windowMs;
    this.samples = this.samples.filter((sample) => sample.timestamp >= cutoff);
  }

  public getEstimate(remainingBytes: number): {
    bytesPerSecond: number;
    etaSeconds: number | null;
  } {
    if (this.samples.length < 2) {
      return { bytesPerSecond: 0, etaSeconds: null };
    }

    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const elapsedSeconds = (last.timestamp - first.timestamp) / 1000;
    const bytesPerSecond = (last.bytes - first.bytes) / elapsedSeconds;

    if (elapsedSeconds <= 0 || bytesPerSecond <= 0) {
      return { bytesPerSecond: 0, etaSeconds: null };
    }

    return {
      bytesPerSecond,
      etaSeconds: remainingBytes > 0 ? remainingBytes / bytesPerSecond : 0,
    };
  }
}

export function aggregateTaskProgress(
  episodes: readonly EpisodeDownloadState[]
): DownloadProgress {
  if (episodes.length === 0) return { progress: 0, estimated: false };

  const hasUnknownSize = episodes.some(
    (episode) => episode.estimatedBytes === null
  );
  const progresses = episodes.map(calculateEpisodeProgress);

  if (hasUnknownSize) {
    return {
      progress: clampProgress(
        progresses.reduce((sum, current) => sum + current.progress, 0) /
          progresses.length
      ),
      estimated: true,
    };
  }

  const totalBytes = episodes.reduce(
    (sum, episode) => sum + (episode.estimatedBytes ?? 0),
    0
  );
  if (totalBytes <= 0) {
    return {
      progress: clampProgress(
        progresses.reduce((sum, current) => sum + current.progress, 0) /
          progresses.length
      ),
      estimated: true,
    };
  }

  const weightedProgress = episodes.reduce((sum, episode, index) => {
    return sum + progresses[index].progress * (episode.estimatedBytes ?? 0);
  }, 0);

  return {
    progress: clampProgress(weightedProgress / totalBytes),
    estimated: false,
  };
}
