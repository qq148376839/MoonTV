import {
  aggregateTaskProgress,
  calculateEpisodeProgress,
  DownloadSpeedWindow,
} from '../download-progress';
import type { EpisodeDownloadState } from '../download-types';

const episode = (
  overrides: Partial<EpisodeDownloadState> = {}
): EpisodeDownloadState => ({
  taskId: 'task-1',
  episodeId: 'episode-1',
  generation: 1,
  stage: 'downloading',
  totalSegments: 2,
  completedSegments: 1,
  failedSegments: 0,
  activeSegments: 1,
  totalKeys: 0,
  completedKeys: 0,
  totalMaps: 0,
  completedMaps: 0,
  expectedBytes: 100,
  completedBytes: 50,
  failures: [],
  legacyEntry: false,
  resumable: true,
  refreshCount: 0,
  createdAt: 0,
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
        episode({ expectedBytes: null, completedBytes: null })
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

  test('returns a null ETA without enough samples', () => {
    const window = new DownloadSpeedWindow();
    window.addSample(1_000, 100);

    expect(window.getEstimate(1_000)).toEqual({
      bytesPerSecond: 0,
      etaSeconds: null,
    });
  });

  test('aggregates known episode sizes by byte weight', () => {
    expect(
      aggregateTaskProgress([
        episode({
          episodeId: 'a',
          expectedBytes: 100,
          completedBytes: 100,
          stage: 'completed',
        }),
        episode({ episodeId: 'b', expectedBytes: 300, completedBytes: 150 }),
      ])
    ).toEqual({ progress: 62.5, estimated: false });
  });
});
