const storageMock = {
  isEnabled: () => true,
  isEpisodeDownloaded: jest.fn(() => true),
};

jest.mock('../local-storage', () => ({
  getStorageManager: () => storageMock,
}));
jest.mock('p-limit', () => ({
  __esModule: true,
  default: () => (operation: () => unknown) => operation(),
}));

import { DownloadScheduler } from '../download-scheduler';
import { DownloadService, DownloadStatus } from '../download-service';

const resource = {
  id: 'movie-1',
  title: '测试影片',
  poster: '',
  episodes: ['https://media.example/movie.m3u8'],
  source: 'source-a',
  source_name: '测试源',
  year: '2026',
};

describe('DownloadService force redownload', () => {
  const responseFor = (body: string, contentLength: number) => ({
    ok: true,
    status: 200,
    headers: { get: () => String(contentLength) },
    body: {
      getReader: () => {
        let sent = false;
        return {
          read: async () => {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: Buffer.from(body) };
          },
        };
      },
    },
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete (global as { fetch?: unknown }).fetch;
  });

  test('keeps normal skip behavior but queues a forced task', () => {
    const normalService = new DownloadService();
    (normalService as unknown as { processQueue: () => void }).processQueue =
      jest.fn();
    const normal = normalService.createTask(resource, resource.episodes, [1]);
    expect(normal.status).toBe(DownloadStatus.COMPLETED);

    const forcedService = new DownloadService();
    (forcedService as unknown as { processQueue: () => void }).processQueue =
      jest.fn();
    const forced = forcedService.createTask(resource, resource.episodes, [1], {
      forceRedownload: true,
    });
    expect(forced.status).toBe(DownloadStatus.PENDING);
    expect(forced.forceRedownload).toBe(true);
  });

  test('waits for the writable stream to finish before resolving', async () => {
    const chunks: Buffer[] = [];
    jest.spyOn(fs, 'createWriteStream').mockReturnValue(
      new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.from(chunk));
          callback();
        },
        final(callback) {
          setTimeout(callback, 30);
        },
      }) as fs.WriteStream
    );
    global.fetch = jest.fn().mockResolvedValue(responseFor('complete', 8));
    const service = new DownloadService();
    const started = Date.now();
    const size = await (
      service as unknown as {
        downloadFile: (url: string, file: string) => Promise<number>;
      }
    ).downloadFile('https://media.example/segment.ts', '/tmp/unused');

    expect(size).toBe(8);
    expect(Buffer.concat(chunks).toString()).toBe('complete');
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  test('does not complete an empty response when length is unknown', async () => {
    jest.spyOn(fs, 'createWriteStream').mockReturnValue(
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }) as fs.WriteStream
    );
    global.fetch = jest.fn().mockResolvedValue(responseFor('', 0));
    const service = new DownloadService();

    await expect(
      (
        service as unknown as {
          downloadFile: (url: string, file: string) => Promise<number>;
        }
      ).downloadFile('https://media.example/empty.ts', '/tmp/unused-empty')
    ).rejects.toThrow(/empty|为空/);
  });

  test('keeps the old direct file when the replacement is incomplete', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-direct-'));
    const active = path.join(root, 'episode_01.mp4');
    fs.writeFileSync(active, 'old-version');
    global.fetch = jest.fn().mockResolvedValue(responseFor('short', 10));
    const service = new DownloadService();

    await expect(
      (
        service as unknown as {
          downloadDirectFile: (
            url: string,
            rootPath: string,
            episode: number
          ) => Promise<unknown>;
        }
      ).downloadDirectFile('https://media.example/video.mp4', root, 1)
    ).rejects.toThrow(/长度不匹配/);
    expect(fs.readFileSync(active, 'utf-8')).toBe('old-version');
    expect(fs.readdirSync(root)).toEqual(['episode_01.mp4']);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('restores persisted work as recovery_wait without fetching', () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;
    const snapshot = {
      schemaVersion: 1 as const,
      taskId: 'task-1',
      source: 'source-a',
      resourceId: 'movie-1',
      title: 'movie',
      year: '2026',
      episodeNumbers: [1],
      status: 'recovery_wait' as const,
      priority: 'normal' as const,
      currentEpisode: 1,
      progress: 10,
      progressEstimated: true,
      speedBytesPerSecond: 0,
      etaSeconds: null,
      completedBytes: 0,
      createdAt: 1,
      updatedAt: 1,
      episodes: {},
    };
    const service = new DownloadService({
      storageManager: storageMock as never,
      stateStore: {
        loadRecoverableTasks: () => [snapshot],
        saveTask: jest.fn(),
        deleteTaskState: jest.fn(),
      },
      scheduler: new DownloadScheduler({ concurrency: 1 }),
      publishProgress: jest.fn(),
      timer: async () => undefined,
      random: () => 0,
    });

    expect(service.getSnapshot('task-1')?.status).toBe('recovery_wait');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('retries an item at most three times with exponential jittered delays', async () => {
    const delays: number[] = [];
    const service = new DownloadService({
      storageManager: storageMock as never,
      stateStore: {
        loadRecoverableTasks: () => [],
        saveTask: jest.fn(),
        deleteTaskState: jest.fn(),
      },
      scheduler: new DownloadScheduler({ concurrency: 1 }),
      publishProgress: jest.fn(),
      timer: async (milliseconds) => {
        delays.push(milliseconds);
      },
      random: () => 0.4,
    });
    const operation = jest
      .fn<Promise<number>, []>()
      .mockRejectedValueOnce(
        Object.assign(new Error('timeout'), { name: 'AbortError' })
      )
      .mockRejectedValueOnce(new Error('socket reset'))
      .mockResolvedValue(7);

    await expect(
      (
        service as unknown as {
          runWithRetry: (operation: () => Promise<number>) => Promise<number>;
        }
      ).runWithRetry(operation)
    ).resolves.toBe(7);
    expect(operation).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([600, 1100]);
  });

  test('refreshes at most once when repeated attempts return 401 or 403', async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    const service = new DownloadService({
      storageManager: storageMock as never,
      stateStore: {
        loadRecoverableTasks: () => [],
        saveTask: jest.fn(),
        deleteTaskState: jest.fn(),
      },
      scheduler: new DownloadScheduler({ concurrency: 1 }),
      publishProgress: jest.fn(),
      timer: async () => undefined,
      random: () => 0,
    });
    const operation = jest
      .fn<Promise<number>, []>()
      .mockRejectedValue(new Error('download failed: 403'));

    await expect(
      (
        service as unknown as {
          runWithRetry: (
            operation: () => Promise<number>,
            refresh: () => Promise<void>
          ) => Promise<number>;
        }
      ).runWithRetry(operation, refresh)
    ).rejects.toThrow(/403/);
    expect(operation).toHaveBeenCalledTimes(3);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('recovery reacquires and remaps current URLs without redownloading valid files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-recovery-'));
    const generation = path.join(
      root,
      'episode_01_generations',
      'generation-a'
    );
    fs.mkdirSync(path.join(generation, 'segments'), { recursive: true });
    fs.writeFileSync(path.join(generation, 'segments', 'segment_000.ts'), 'ok');
    fs.writeFileSync(
      path.join(generation, 'source.cleaned.m3u8'),
      '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:10\n#EXTINF:1,\nold-10.ts?token=old\n#EXTINF:1,\nold-11.ts?token=old'
    );
    const active = path.join(root, 'episode_01.m3u8');
    fs.writeFileSync(active, '#EXTM3U\nold-entry.ts');
    const snapshot = recoverySnapshot('generation-a');
    const reacquireEpisode = jest.fn().mockResolvedValue({
      playlistUrl: 'https://fresh.example/list.m3u8?token=fresh',
      content:
        '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:10\n#EXTINF:1,\nfresh-10.ts?token=fresh\n#EXTINF:1,\nfresh-11.ts?token=fresh',
    });
    const service = new DownloadService({
      storageManager: {
        ...storageMock,
        getResourcePath: () => root,
      } as never,
      stateStore: {
        loadRecoverableTasks: () => [snapshot],
        saveTask: jest.fn(),
        deleteTaskState: jest.fn(),
      },
      scheduler: new DownloadScheduler({ concurrency: 1 }),
      publishProgress: jest.fn(),
      timer: async () => undefined,
      random: () => 0,
      reacquireEpisode,
    });

    await expect(service.resumeTask('task-1')).resolves.toMatchObject({
      ok: true,
      status: 'downloading',
    });
    expect(reacquireEpisode).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot('task-1')?.episodes['1']).toMatchObject({
      completedSegmentIndices: [0],
      failedSegmentIndices: [1],
      refreshCount: 1,
      oldEntryRetained: true,
    });
    const recoveryPlans = (
      service as unknown as {
        recoveryPlans: Map<string, { pendingSegments: unknown[] }>;
      }
    ).recoveryPlans;
    expect(recoveryPlans.get('task-1:1')?.pendingSegments).toEqual([
      expect.objectContaining({ index: 1, sequence: 11 }),
    ]);
    expect(fs.readFileSync(active, 'utf8')).toContain('old-entry.ts');
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('recovery structure mismatch becomes partial_failed and preserves the old entry', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-mismatch-'));
    const generation = path.join(
      root,
      'episode_01_generations',
      'generation-a'
    );
    fs.mkdirSync(generation, { recursive: true });
    fs.writeFileSync(
      path.join(generation, 'source.cleaned.m3u8'),
      '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:10\n#EXTINF:1,\n10.ts\n#EXTINF:1,\n11.ts'
    );
    const active = path.join(root, 'episode_01.m3u8');
    fs.writeFileSync(active, '#EXTM3U\nold-entry.ts');
    const service = new DownloadService({
      storageManager: {
        ...storageMock,
        getResourcePath: () => root,
      } as never,
      stateStore: {
        loadRecoverableTasks: () => [recoverySnapshot('generation-a')],
        saveTask: jest.fn(),
        deleteTaskState: jest.fn(),
      },
      scheduler: new DownloadScheduler({ concurrency: 1 }),
      publishProgress: jest.fn(),
      timer: async () => undefined,
      random: () => 0,
      reacquireEpisode: jest.fn().mockResolvedValue({
        playlistUrl: 'https://fresh.example/list.m3u8',
        content:
          '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:11\n#EXTINF:1,\n11.ts\n#EXTINF:1,\n12.ts',
      }),
    });

    await expect(service.resumeTask('task-1')).resolves.toMatchObject({
      ok: false,
      status: 'failed',
    });
    expect(service.getSnapshot('task-1')?.episodes['1']).toMatchObject({
      stage: 'partial_failed',
      oldEntryRetained: true,
      refreshCount: 1,
    });
    expect(fs.readFileSync(active, 'utf8')).toContain('old-entry.ts');
    fs.rmSync(root, { recursive: true, force: true });
  });
});

function recoverySnapshot(generationId: string) {
  return {
    schemaVersion: 1 as const,
    taskId: 'task-1',
    source: 'source-a',
    resourceId: 'movie-1',
    title: 'movie',
    year: '2026',
    episodeNumbers: [1],
    status: 'recovery_wait' as const,
    priority: 'normal' as const,
    currentEpisode: 1,
    progress: 10,
    progressEstimated: true,
    speedBytesPerSecond: 0,
    etaSeconds: null,
    completedBytes: 2,
    createdAt: 1,
    updatedAt: 1,
    episodes: {
      '1': {
        episode: 1,
        generationId,
        stage: 'recovery_wait' as const,
        totalSegments: 2,
        completedSegmentIndices: [0],
        failedSegmentIndices: [1],
        activeItems: [],
        keyTotal: 0,
        keyCompleted: 0,
        mapTotal: 0,
        mapCompleted: 0,
        completedBytes: 2,
        estimatedBytes: null,
        progress: 10,
        progressEstimated: true,
        speedBytesPerSecond: 0,
        etaSeconds: null,
        failures: [],
        oldEntryRetained: true,
        recoverable: true,
        refreshCount: 0,
        updatedAt: 1,
      },
    },
  };
}
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Writable } from 'stream';
