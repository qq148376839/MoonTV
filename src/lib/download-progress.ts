import type { EpisodeDownloadState } from './download-types';

export interface DownloadProgress {
  progress: number;
  estimated: boolean;
}

const isFiniteNumber = (value: number | null): value is number =>
  value !== null && Number.isFinite(value);

const finiteOrZero = (value: number): number =>
  isFiniteNumber(value) ? Math.max(0, value) : 0;

const clampProgress = (value: number): number => {
  if (!isFiniteNumber(value)) return 0;
  return Math.min(100, Math.max(0, value));
};

const clampRatio = (value: number): number => {
  if (!isFiniteNumber(value)) return 0;
  return Math.min(1, Math.max(0, value));
};

const validEstimatedBytes = (value: number | null): value is number =>
  isFiniteNumber(value) && value > 0;

const completedSegmentCount = (episode: EpisodeDownloadState): number =>
  new Set(
    episode.completedSegmentIndices.filter(
      (index) => isFiniteNumber(index) && index >= 0
    )
  ).size;

const downloadingProgress = (
  episode: EpisodeDownloadState
): DownloadProgress => {
  if (validEstimatedBytes(episode.estimatedBytes)) {
    return {
      progress: clampProgress(
        10 +
          clampRatio(
            finiteOrZero(episode.completedBytes) / episode.estimatedBytes
          ) *
            85
      ),
      estimated: false,
    };
  }

  const totalSegments = finiteOrZero(episode.totalSegments);
  const ratio =
    totalSegments > 0 ? completedSegmentCount(episode) / totalSegments : 0;
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
        estimated: Boolean(episode.progressEstimated),
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
    if (!isFiniteNumber(timestamp) || !isFiniteNumber(completedBytes)) return;

    const sample = { timestamp, bytes: Math.max(0, completedBytes) };
    const existingIndex = this.samples.findIndex(
      (current) => current.timestamp === timestamp
    );
    if (existingIndex >= 0) {
      this.samples[existingIndex] = sample;
    } else {
      this.samples.push(sample);
    }
    this.samples.sort((left, right) => left.timestamp - right.timestamp);

    for (let index = 1; index < this.samples.length; index += 1) {
      if (this.samples[index].bytes < this.samples[index - 1].bytes) {
        this.samples = this.samples.slice(index);
        break;
      }
    }

    const latestTimestamp = this.samples[this.samples.length - 1]?.timestamp;
    if (latestTimestamp === undefined) return;
    const cutoff = latestTimestamp - this.windowMs;
    this.samples = this.samples.filter(
      (current) => current.timestamp >= cutoff
    );
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

    if (
      elapsedSeconds <= 0 ||
      !isFiniteNumber(bytesPerSecond) ||
      bytesPerSecond <= 0
    ) {
      return { bytesPerSecond: 0, etaSeconds: null };
    }

    const etaSeconds =
      isFiniteNumber(remainingBytes) && remainingBytes > 0
        ? remainingBytes / bytesPerSecond
        : null;
    return {
      bytesPerSecond: isFiniteNumber(bytesPerSecond) ? bytesPerSecond : 0,
      etaSeconds:
        etaSeconds !== null && isFiniteNumber(etaSeconds) ? etaSeconds : null,
    };
  }
}

export function aggregateTaskProgress(
  episodes: readonly EpisodeDownloadState[]
): DownloadProgress {
  if (episodes.length === 0) return { progress: 0, estimated: false };

  const hasUnknownSize = episodes.some(
    (episode) => !validEstimatedBytes(episode.estimatedBytes)
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

  const maximumBytes = Math.max(
    ...episodes.map((episode) => episode.estimatedBytes ?? 0)
  );
  const totalBytes = episodes.reduce(
    (sum, episode) => sum + (episode.estimatedBytes ?? 0) / maximumBytes,
    0
  );
  const weightedProgress = episodes.reduce((sum, episode, index) => {
    return (
      sum +
      progresses[index].progress *
        ((episode.estimatedBytes ?? 0) / maximumBytes)
    );
  }, 0);

  return {
    progress: clampProgress(weightedProgress / totalBytes),
    estimated: false,
  };
}
