import { NextRequest } from 'next/server';

import { DownloadEventBus } from '@/lib/download-event-bus';
import { DownloadTaskSnapshot } from '@/lib/download-types';

const service = {
  getSnapshot: jest.fn(),
  getTask: jest.fn(),
  getAllTasks: jest.fn<Array<Record<string, unknown>>, []>(() => []),
  getRecoverableTaskIds: jest.fn<string[], []>(() => []),
  getSchedulerDiagnostics: jest.fn(() => ({
    concurrency: 8,
    active: 3,
    queued: 4,
    tasks: 2,
    pausedTasks: 0,
  })),
  pauseTask: jest.fn(),
  resumeTask: jest.fn(),
  cancelTask: jest.fn(),
  retryFailed: jest.fn(),
  prioritizeTask: jest.fn(),
  isEnabled: jest.fn(() => true),
};

const storage = {
  getResourcePath: jest.fn(() => '/storage/resource'),
  readMetadata: jest.fn(() => ({
    episode_audits: {
      '1': {
        generation_id: 'generation',
        address_method: 'client_fallback',
        original_segments: 23,
        removed_segments: 2,
        final_segments: 21,
        removed_duration_sec: 30.5,
        filter_version: 'm3u8-ad-filter-v2',
        filter_reason: 'removed matching ad group',
        filter_reasons: ['keyword', 'discontinuity'],
        validation_passed: true,
        source_url: 'https://source.invalid/watch?token=private',
        media_playlist_url: 'https://cdn.invalid/index.m3u8?token=private',
      },
    },
  })),
};

jest.mock('@/lib/download-service', () => ({
  getDownloadService: () => service,
}));

jest.mock('@/lib/local-storage', () => ({
  getStorageManager: () => storage,
}));

import { POST as POST_COMMAND } from '../[taskId]/command/route';
import { GET as GET_DETAIL } from '../[taskId]/detail/route';
import { createDownloadEventResponse } from '../events/route';
import { GET as GET_DOWNLOADS } from '../route';

function request(
  url: string,
  options: { body?: unknown; headers?: Record<string, string> } = {}
): NextRequest {
  const headers = new Map(
    Object.entries(options.headers ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ])
  );
  return {
    url,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    signal: new AbortController().signal,
    json: async () => options.body,
  } as unknown as NextRequest;
}

function snapshot(): DownloadTaskSnapshot {
  return {
    schemaVersion: 1,
    taskId: 'task-1',
    source: 'source',
    resourceId: 'resource',
    title: '最佳损友',
    year: '1988',
    poster: 'https://images.invalid/poster.jpg?token=poster-secret',
    episodeNumbers: [1],
    status: 'downloading',
    priority: 'normal',
    currentEpisode: 1,
    progress: 52,
    progressEstimated: false,
    speedBytesPerSecond: 1024,
    etaSeconds: 30,
    completedBytes: 1234,
    createdAt: 1,
    updatedAt: 2,
    episodes: {
      '1': {
        episode: 1,
        generationId: 'generation',
        stage: 'downloading',
        totalSegments: 21,
        completedSegmentIndices: [
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18, 19, 20,
        ],
        failedSegmentIndices: [13],
        activeItems: [
          {
            taskId: 'task-1',
            episode: 1,
            generationId: 'generation',
            kind: 'segment',
            index: 14,
            attempt: 2,
            speedBytesPerSecond: 4096,
          },
        ],
        keyTotal: 1,
        keyCompleted: 1,
        mapTotal: 0,
        mapCompleted: 0,
        completedBytes: 1234,
        estimatedBytes: 2000,
        progress: 52,
        progressEstimated: false,
        speedBytesPerSecond: 1024,
        etaSeconds: 30,
        failures: [
          {
            kind: 'segment',
            index: 13,
            category: 'http_auth',
            attempts: 3,
            path: 'https://cdn.invalid/a.ts?token=secret#fragment',
            message: 'failed https://cdn.invalid/a.ts?token=secret#fragment',
          },
        ],
        oldEntryRetained: true,
        recoverable: true,
        refreshCount: 1,
        updatedAt: 2,
      },
    },
  };
}

describe('download routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    service.getSnapshot.mockReturnValue(snapshot());
    service.getTask.mockReturnValue(null);
    service.getAllTasks.mockReturnValue([]);
    service.getRecoverableTaskIds.mockReturnValue(['task-1']);
  });

  test('detail returns aggregate ranges and redacted failures', async () => {
    const response = await GET_DETAIL(
      request('http://localhost/api/download/task-1/detail'),
      { params: { taskId: 'task-1' } }
    );
    const body = await response.json();
    expect(body.episodes[0].segment_ranges.completed).toEqual([
      [0, 12],
      [15, 20],
    ]);
    expect(body.episodes[0].active_items[0]).not.toHaveProperty('taskId');
    expect(JSON.stringify(body)).not.toContain('token=secret');
    expect(JSON.stringify(body)).not.toContain('#fragment');
    expect(JSON.stringify(body)).not.toContain('poster-secret');
    expect(body.episodes[0].ad_filter).toEqual({
      original_segments: 23,
      removed_segments: 2,
      final_segments: 21,
      removed_duration_seconds: 30.5,
      filter_version: 'm3u8-ad-filter-v2',
      reason: 'removed matching ad group',
      matched_reasons: ['keyword', 'discontinuity'],
      validation_passed: true,
    });
    expect(JSON.stringify(body.episodes[0].ad_filter)).not.toContain(
      'source.invalid'
    );
    expect(body.scheduler_slots).toEqual({
      task_active: 1,
      global_active: 3,
      global_total: 8,
    });
    expect(body.episodes[0].active_items[0]).toMatchObject({
      kind: 'segment',
      index: 14,
      attempt: 2,
      speed_bytes_per_second: 4096,
    });
    expect(body.episodes[0].address_source).toBe('client_fallback');
    expect(JSON.stringify(body.episodes[0].address_source)).not.toContain(
      'http'
    );
  });

  test('returns 404 for missing detail', async () => {
    service.getSnapshot.mockReturnValue(null);
    const response = await GET_DETAIL(
      request('http://localhost/api/download/missing/detail'),
      { params: { taskId: 'missing' } }
    );
    expect(response.status).toBe(404);
  });

  test('rejects commands that conflict with current state', async () => {
    service.pauseTask.mockReturnValue({ ok: false, status: 'conflict' });
    const response = await POST_COMMAND(
      request('http://localhost/api/download/task-1/command', {
        body: { action: 'pause' },
      }),
      { params: { taskId: 'task-1' } }
    );
    expect(response.status).toBe(409);
  });

  test.each([null, 'pause', [], 1])(
    'rejects valid JSON non-object command body %#',
    async (body) => {
      const response = await POST_COMMAND(
        request('http://localhost/api/download/task-1/command', { body }),
        { params: { taskId: 'task-1' } }
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: '请求体必须是 JSON 对象',
      });
    }
  );

  test.each([
    ['resume', 'resumeTask'],
    ['cancel', 'cancelTask'],
    ['cancel_and_clean', 'cancelTask'],
    ['retry_failed', 'retryFailed'],
    ['prioritize', 'prioritizeTask'],
  ] as const)('dispatches %s to the service', async (action, method) => {
    if (method === 'prioritizeTask') {
      service[method].mockReturnValue({ ok: true, status: 'downloading' });
    } else {
      service[method].mockResolvedValue({ ok: true, status: 'downloading' });
    }
    const response = await POST_COMMAND(
      request('http://localhost/api/download/task-1/command', {
        body: { action },
      }),
      { params: Promise.resolve({ taskId: 'task-1' }) }
    );
    expect(response.status).toBe(200);
    expect(service[method]).toHaveBeenCalled();
    if (action === 'cancel_and_clean') {
      expect(service.cancelTask).toHaveBeenCalledWith('task-1', true);
    }
  });

  test('list includes recovered snapshots without full episodes', async () => {
    const response = await GET_DOWNLOADS(
      request('http://localhost/api/download')
    );
    const body = await response.json();
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]).toMatchObject({
      task_id: 'task-1',
      current_stage: 'downloading',
    });
    expect(body.tasks[0]).not.toHaveProperty('episodes');
  });

  test('redacts poster URL on the legacy in-memory summary path', async () => {
    service.getSnapshot.mockReturnValue(null);
    service.getRecoverableTaskIds.mockReturnValue([]);
    service.getAllTasks.mockReturnValue([
      {
        id: 'legacy-1',
        source: 'legacy',
        resourceId: 'movie',
        resource: {
          title: 'Legacy',
          year: '1988',
          poster:
            'https://images.invalid/poster.jpg?token=legacy-secret#private',
        },
        episodeNumbers: [1],
        status: 'downloading',
        progress: 10,
        error:
          'failed https://cdn.invalid/segment.ts?token=list-secret#private',
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
    const response = await GET_DOWNLOADS(
      request('http://localhost/api/download')
    );
    const serialized = JSON.stringify(await response.json());
    expect(serialized).toContain('https://images.invalid/poster.jpg');
    expect(serialized).not.toContain('legacy-secret');
    expect(serialized).not.toContain('list-secret');
    expect(serialized).not.toContain('#private');
  });

  test('redacts legacy error URL on the single-task summary path', async () => {
    service.getSnapshot.mockReturnValue(null);
    service.getTask.mockReturnValue({
      id: 'legacy-1',
      status: 'failed',
      progress: 10,
      error:
        'failed https://cdn.invalid/segment.ts?token=single-secret#fragment',
      createdAt: 1,
      updatedAt: 2,
    });
    const response = await GET_DOWNLOADS(
      request('http://localhost/api/download?task_id=legacy-1')
    );
    const serialized = JSON.stringify(await response.json());
    expect(serialized).toContain('https://cdn.invalid/segment.ts');
    expect(serialized).not.toContain('single-secret');
    expect(serialized).not.toContain('#fragment');
  });

  test('SSE requests an initial snapshot, replays in order, and redacts data', async () => {
    const bus = new DownloadEventBus(10);
    const first = bus.publish('task.updated', { taskId: 'task-1' });
    bus.publish('episode.updated', {
      taskId: 'task-1',
      message: 'https://cdn.invalid/segment.ts?token=secret#x',
    });

    const initial = createDownloadEventResponse(
      request('http://localhost/api/download/events'),
      bus
    );
    const initialStream = initial.body as unknown as {
      _underlyingSource: {
        start(controller: {
          enqueue(value: Uint8Array): void;
          close(): void;
        }): void;
        cancel(): void;
      };
    };
    const initialChunks: Uint8Array[] = [];
    initialStream._underlyingSource.start({
      enqueue: (value) => initialChunks.push(value),
      close: () => undefined,
    });
    expect(new TextDecoder().decode(initialChunks[0])).toContain(
      'event: snapshot.required'
    );
    initialStream._underlyingSource.cancel();

    const replay = createDownloadEventResponse(
      request('http://localhost/api/download/events', {
        headers: { 'Last-Event-ID': String(first.id) },
      }),
      bus
    );
    const replayStream = replay.body as unknown as typeof initialStream;
    const replayChunks: Uint8Array[] = [];
    replayStream._underlyingSource.start({
      enqueue: (value) => replayChunks.push(value),
      close: () => undefined,
    });
    const text = new TextDecoder().decode(replayChunks[0]);
    expect(text).toContain(`id: ${first.id + 1}`);
    expect(text).not.toContain('token=secret');
    expect(replay.headers.get('x-accel-buffering')).toBe('no');
    replayStream._underlyingSource.cancel();
  });

  test('SSE closes and cleans up a saturated slow consumer', () => {
    jest.useFakeTimers();
    try {
      const bus = new DownloadEventBus(10);
      const response = createDownloadEventResponse(
        request('http://localhost/api/download/events'),
        bus
      );
      const stream = response.body as unknown as {
        _underlyingSource: {
          start(controller: {
            desiredSize: number;
            enqueue(value: Uint8Array): void;
            close(): void;
          }): void;
          cancel(): void;
        };
      };
      const chunks: Uint8Array[] = [];
      const close = jest.fn();
      let desiredSize = 1;
      stream._underlyingSource.start({
        get desiredSize() {
          return desiredSize;
        },
        enqueue(value) {
          chunks.push(value);
          desiredSize = 0;
        },
        close,
      });
      expect(chunks).toHaveLength(1);

      bus.publish('task.updated', { taskId: 'task-1' });
      expect(close).toHaveBeenCalledTimes(1);
      expect(chunks).toHaveLength(1);

      desiredSize = 1;
      bus.publish('task.updated', { taskId: 'task-2' });
      jest.advanceTimersByTime(30_000);
      expect(chunks).toHaveLength(1);
      expect(close).toHaveBeenCalledTimes(1);

      stream._underlyingSource.cancel();
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
