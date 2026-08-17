import {
  aggregateTaskProgress,
  calculateEpisodeProgress,
  DownloadSpeedWindow,
} from '../download-progress';
import type { EpisodeDownloadState } from '../download-types';

const episode = (
  overrides: Partial<EpisodeDownloadState> = {}
): EpisodeDownloadState => ({
  episode: 1,
  generationId: 'generation-1',
  stage: 'downloading',
  totalSegments: 4,
  completedSegmentIndices: [0, 1],
  failedSegmentIndices: [],
  activeItems: [],
  keyTotal: 0,
  keyCompleted: 0,
  mapTotal: 0,
  mapCompleted: 0,
  completedBytes: 50,
  estimatedBytes: 100,
  progress: 52.5,
  progressEstimated: false,
  speedBytesPerSecond: 0,
  etaSeconds: null,
  failures: [],
  oldEntryRetained: false,
  recoverable: true,
  refreshCount: 0,
  updatedAt: 0,
  ...overrides,
});

describe('download progress', () => {
  test('weights known bytes inside the downloading media range', () => {
    expect(calculateEpisodeProgress(episode())).toEqual({
      progress: 52.5,
      estimated: false,
    });
  });

  test('falls back to segment counts when total bytes are unknown', () => {
    expect(
      calculateEpisodeProgress(
        episode({ estimatedBytes: null, completedBytes: 0 })
      )
    ).toEqual({ progress: 52.5, estimated: true });
  });

  test('keeps calculated progress finite and clamps invalid byte and segment data', () => {
    expect(
      calculateEpisodeProgress(
        episode({ completedBytes: Number.NaN, estimatedBytes: 100 })
      )
    ).toEqual({ progress: 10, estimated: false });
    expect(
      calculateEpisodeProgress(
        episode({
          completedBytes: Number.POSITIVE_INFINITY,
          estimatedBytes: null,
          totalSegments: Number.NaN,
          completedSegmentIndices: [
            0,
            -1,
            Number.NaN,
            Number.POSITIVE_INFINITY,
          ],
        })
      )
    ).toEqual({ progress: 10, estimated: true });
    expect(
      calculateEpisodeProgress(
        episode({ completedBytes: 200, estimatedBytes: 100 })
      )
    ).toEqual({ progress: 95, estimated: false });
  });

  test('keeps recorded non-downloading progress finite and clamped', () => {
    expect(
      calculateEpisodeProgress(
        episode({ stage: 'paused', progress: Number.NaN })
      )
    ).toEqual({ progress: 0, estimated: false });
    expect(
      calculateEpisodeProgress(
        episode({ stage: 'paused', progress: Number.POSITIVE_INFINITY })
      )
    ).toEqual({ progress: 0, estimated: false });
    expect(
      calculateEpisodeProgress(episode({ stage: 'paused', progress: -10 }))
    ).toEqual({ progress: 0, estimated: false });
  });

  test('computes a ten second speed window and ETA', () => {
    const window = new DownloadSpeedWindow();
    window.addSample(0, 0);
    window.addSample(10_000, 10 * 1024 * 1024);

    expect(window.getEstimate(10 * 1024 * 1024)).toEqual({
      bytesPerSecond: 1024 * 1024,
      etaSeconds: 10,
    });
  });

  test('returns a null ETA without samples', () => {
    expect(new DownloadSpeedWindow().getEstimate(1_000)).toEqual({
      bytesPerSecond: 0,
      etaSeconds: null,
    });
  });

  test('returns a null ETA when the measured speed is not positive', () => {
    const window = new DownloadSpeedWindow();
    window.addSample(0, 10);
    window.addSample(10_000, 5);

    expect(window.getEstimate(1_000)).toEqual({
      bytesPerSecond: 0,
      etaSeconds: null,
    });
  });

  test('returns a null ETA for invalid or non-positive remaining bytes', () => {
    const window = new DownloadSpeedWindow();
    window.addSample(0, 0);
    window.addSample(10_000, 10 * 1024 * 1024);

    expect(window.getEstimate(0).etaSeconds).toBeNull();
    expect(window.getEstimate(-1).etaSeconds).toBeNull();
    expect(window.getEstimate(Number.NaN).etaSeconds).toBeNull();
    expect(window.getEstimate(Number.POSITIVE_INFINITY).etaSeconds).toBeNull();
  });

  test('sorts samples by timestamp and replaces samples at the same timestamp', () => {
    const window = new DownloadSpeedWindow();
    window.addSample(10_000, 10 * 1024 * 1024);
    window.addSample(0, 0);
    window.addSample(0, 5 * 1024 * 1024);
    window.addSample(10_000, 15 * 1024 * 1024);

    expect(window.getEstimate(10 * 1024 * 1024)).toEqual({
      bytesPerSecond: 1024 * 1024,
      etaSeconds: 10,
    });
  });

  test('resets after cumulative bytes roll back and recovers on later samples', () => {
    const window = new DownloadSpeedWindow();
    window.addSample(0, 0);
    window.addSample(5_000, 5 * 1024 * 1024);
    window.addSample(6_000, 4 * 1024 * 1024);

    expect(window.getEstimate(1_000)).toEqual({
      bytesPerSecond: 0,
      etaSeconds: null,
    });

    window.addSample(16_000, 14 * 1024 * 1024);
    expect(window.getEstimate(10 * 1024 * 1024)).toEqual({
      bytesPerSecond: 1024 * 1024,
      etaSeconds: 10,
    });
  });

  test('ignores non-finite speed samples', () => {
    const window = new DownloadSpeedWindow();
    window.addSample(Number.NaN, 0);
    window.addSample(0, Number.POSITIVE_INFINITY);
    window.addSample(0, 0);
    window.addSample(10_000, 10 * 1024 * 1024);

    expect(window.getEstimate(10 * 1024 * 1024)).toEqual({
      bytesPerSecond: 1024 * 1024,
      etaSeconds: 10,
    });
  });

  test('drops samples older than the ten second window', () => {
    const window = new DownloadSpeedWindow();
    window.addSample(0, 0);
    window.addSample(5_000, 5_000);
    window.addSample(16_000, 6_000);

    expect(window.getEstimate(1_000)).toEqual({
      bytesPerSecond: 0,
      etaSeconds: null,
    });
  });

  test('aggregates known episode sizes by weighted episode progress', () => {
    expect(
      aggregateTaskProgress([
        episode({
          episode: 1,
          stage: 'completed',
          completedBytes: 100,
          estimatedBytes: 100,
          progress: 100,
        }),
        episode({
          episode: 2,
          stage: 'paused',
          completedBytes: 150,
          estimatedBytes: 300,
          progress: 50,
        }),
      ])
    ).toEqual({ progress: 62.5, estimated: false });
  });

  test('uses equal weighting when any episode size is unknown', () => {
    expect(
      aggregateTaskProgress([
        episode({ episode: 1, stage: 'completed', progress: 100 }),
        episode({ episode: 2, estimatedBytes: null }),
      ])
    ).toEqual({ progress: 76.25, estimated: true });
  });

  test('uses equal weighting for zero, negative, and non-finite sizes', () => {
    const valid = episode({ episode: 1, stage: 'completed', progress: 100 });
    const invalid = episode({
      episode: 2,
      stage: 'paused',
      progress: 50,
      estimatedBytes: 0,
    });
    expect(aggregateTaskProgress([valid, invalid])).toEqual({
      progress: 75,
      estimated: true,
    });
    expect(
      aggregateTaskProgress([
        valid,
        { ...invalid, estimatedBytes: -1 },
        { ...invalid, estimatedBytes: Number.POSITIVE_INFINITY },
      ])
    ).toEqual({ progress: 66.66666666666667, estimated: true });
  });

  test.each([
    ['validating', 95],
    ['committing', 97.5],
    ['completed', 100],
  ] as const)('%s has its fixed progress', (stage, progress) => {
    expect(calculateEpisodeProgress(episode({ stage }))).toEqual({
      progress,
      estimated: false,
    });
  });

  test.each([
    'pausing',
    'paused',
    'partial_failed',
    'cancelled_resumable',
    'recovery_wait',
  ] as const)('%s keeps its recorded progress', (stage) => {
    expect(
      calculateEpisodeProgress(
        episode({ stage, progress: 41.25, progressEstimated: true })
      )
    ).toEqual({ progress: 41.25, estimated: true });
  });
});
