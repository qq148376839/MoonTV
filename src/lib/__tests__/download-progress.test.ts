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
