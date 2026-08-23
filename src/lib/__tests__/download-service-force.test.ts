const storageMock = {
  isEnabled: () => true,
  isEpisodeDownloaded: jest.fn(() => true),
  generateMetadata: jest.fn().mockResolvedValue(undefined),
  updateIndex: jest.fn(),
};

jest.mock('../local-storage', () => ({
  getStorageManager: () => storageMock,
}));
jest.mock('p-limit', () => ({
  __esModule: true,
  default: () => (operation: () => unknown) => operation(),
}));

import { DownloadScheduler } from '../download-scheduler';
import {
  DownloadService,
  DownloadStatus,
  readDownloadConcurrency,
} from '../download-service';
import type { DownloadTaskSnapshot } from '../download-types';

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
  const responseFor = (body: string, contentLength: number) =>
    ({
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
    } as unknown as Response);

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete (global as { fetch?: unknown }).fetch;
  });

  test.each([
    ['1', 2],
    ['8', 8],
    ['99', 16],
    ['invalid', 8],
  ])('normalizes concurrency %s to %i', (raw, expected) => {
    expect(readDownloadConcurrency(raw)).toBe(expected);
  });

  test('shows in-memory legacy tasks as estimated without persisting or migrating media', () => {
    const saveTask = jest.fn();
    const service = new DownloadService({
      storageManager: storageMock as never,
      stateStore: {
        loadRecoverableTasks: () => [],
        saveTask,
        deleteTaskState: jest.fn(),
        cleanupHistory: jest.fn(() => ({ removed: [] })),
      },
      scheduler: new DownloadScheduler({ concurrency: 1 }),
      publishProgress: jest.fn(),
      timer: async () => undefined,
      random: () => 0,
    });
    (service as unknown as { tasks: Map<string, unknown> }).tasks.set(
      'legacy',
      {
        id: 'legacy',
        source: 'source-a',
        resourceId: 'movie-1',
        resource,
        episodes: resource.episodes,
        episodeNumbers: [1],
        forceRedownload: false,
        addressMethod: 'direct',
        status: DownloadStatus.DOWNLOADING,
        progress: 25,
        createdAt: 1,
        updatedAt: 1,
      }
    );

    expect(service.getTaskSummary('legacy')).toMatchObject({
      taskId: 'legacy',
      progressEstimated: true,
    });
    expect(saveTask).not.toHaveBeenCalled();
  });

  test('persists a private recovery recipe when a task is created', () => {
    const saveTask = jest.fn();
    const service = new DownloadService({
      storageManager: {
        ...storageMock,
        isEpisodeDownloaded: jest.fn(() => false),
      } as never,
      stateStore: {
        loadRecoverableTasks: () => [],
        saveTask,
        deleteTaskState: jest.fn(),
      },
      scheduler: new DownloadScheduler({ concurrency: 1 }),
      publishProgress: jest.fn(),
      timer: async () => undefined,
      random: () => 0,
    });
    (service as unknown as { processQueue: () => Promise<void> }).processQueue =
      jest.fn().mockResolvedValue(undefined);

    const task = service.createTask(resource, resource.episodes, [1]);
    const persisted = saveTask.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(task.id).toMatch(/^download_/);
    expect(persisted).toMatchObject({
      recovery: {
        source: 'source-a',
        resourceId: 'movie-1',
        episodeEntries: { '1': 'https://media.example/movie.m3u8' },
      },
    });
  });

  test('cleans history on startup and only once per day while listing tasks', () => {
    const cleanupHistory = jest.fn(() => ({ removed: [] }));
    const now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const service = new DownloadService({
      storageManager: storageMock as never,
      stateStore: {
        loadRecoverableTasks: () => [],
        saveTask: jest.fn(),
        deleteTaskState: jest.fn(),
        cleanupHistory,
      },
      scheduler: new DownloadScheduler({ concurrency: 1 }),
      publishProgress: jest.fn(),
      timer: async () => undefined,
      random: () => 0,
    });

    expect(cleanupHistory).toHaveBeenCalledTimes(1);
    service.getAllTasks();
    service.getAllTasks();
    expect(cleanupHistory).toHaveBeenCalledTimes(1);

    jest.spyOn(Date, 'now').mockReturnValue(now + 24 * 60 * 60 * 1000);
    service.getAllTasks();
    expect(cleanupHistory).toHaveBeenCalledTimes(2);
  });

  test('daily cleanup evicts removed snapshots and prevents pending work from recreating state', () => {
    jest.useFakeTimers();
    const now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const removed = {
      schemaVersion: 1 as const,
      taskId: 'expired',
      source: 'source-a',
      resourceId: 'movie-1',
      title: 'Expired',
      year: '2026',
      episodeNumbers: [],
      status: 'completed' as const,
      priority: 'normal' as const,
      currentEpisode: null,
      progress: 100,
      progressEstimated: false,
      speedBytesPerSecond: 0,
      etaSeconds: null,
      completedBytes: 1,
      createdAt: 1,
      updatedAt: 1,
      episodes: {},
    };
    const retained = { ...removed, taskId: 'retained', title: 'Retained' };
    const saveTask = jest.fn();
    const cleanupHistory = jest
      .fn()
      .mockReturnValueOnce({ removed: [] })
      .mockReturnValueOnce({ removed: ['expired'] });
    const scheduler = new DownloadScheduler({ concurrency: 1 });
    const service = new DownloadService({
      storageManager: storageMock as never,
      stateStore: {
        loadRecoverableTasks: () => [],
        saveTask,
        deleteTaskState: jest.fn(),
        cleanupHistory,
      },
      scheduler,
      publishProgress: jest.fn(),
      timer: async () => undefined,
      random: () => 0,
    });

    const runtime = service as unknown as {
      activeDownloads: Set<string>;
      failedWork: Map<string, { item: { taskId: string } }>;
      queueSnapshotFlush(taskId: string): void;
      recoveryPlans: Map<string, unknown>;
      snapshots: Map<string, DownloadTaskSnapshot>;
      tasks: Map<string, unknown>;
    };
    runtime.snapshots.set('expired', removed);
    runtime.snapshots.set('retained', retained);

    expect(service.getRecoverableTaskIds()).toEqual(['expired', 'retained']);
    expect(service.prioritizeTask('expired').ok).toBe(true);
    saveTask.mockClear();
    runtime.tasks.set('expired', {
      id: 'expired',
      status: DownloadStatus.COMPLETED,
    });
    runtime.activeDownloads.add('expired');
    runtime.failedWork.set('expired:work', {
      item: { taskId: 'expired' },
    });
    runtime.recoveryPlans.set('expired:1', {});
    runtime.queueSnapshotFlush('expired');

    jest.spyOn(Date, 'now').mockReturnValue(now + 24 * 60 * 60 * 1000);
    service.getAllTasks();

    expect(service.getSnapshot('expired')).toBeNull();
    expect(service.getRecoverableTaskIds()).toEqual(['retained']);
    expect(service.getSnapshot('retained')).not.toBeNull();
    expect(service.getAllTasks()).toEqual([]);
    expect(runtime.activeDownloads).not.toContain('expired');
    expect(runtime.failedWork.has('expired:work')).toBe(false);
    expect(runtime.recoveryPlans.has('expired:1')).toBe(false);
    expect(service.prioritizeTask('expired')).toEqual({
      ok: false,
      status: 'not_found',
    });
    expect(
      (scheduler as unknown as { highPriorityTasks: Set<string> })
        .highPriorityTasks
    ).not.toContain('expired');

    jest.advanceTimersByTime(250);
    expect(saveTask).not.toHaveBeenCalled();
    jest.useRealTimers();
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

  test('scheduled segment network failures make at most three total requests', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-attempts-'));
    const snapshot = activeSnapshot();
    const { service } = serviceForSnapshot(snapshot);
    const fetchSpy = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('network timeout'), { name: 'AbortError' })
      );
    global.fetch = fetchSpy;
    const segmentPath = path.join(root, 'segment.ts');
    const executable = service as unknown as {
      executeScheduled: (
        episode: DownloadTaskSnapshot['episodes'][string],
        item: ReturnType<typeof workItem>,
        filePath: string,
        operation: () => Promise<number>
      ) => Promise<number>;
      downloadFile: (url: string, filePath: string) => Promise<number>;
    };

    await expect(
      executable.executeScheduled(
        snapshot.episodes['1'],
        workItem(0),
        segmentPath,
        () =>
          executable.downloadFile(
            'https://media.example/segment.ts',
            segmentPath
          )
      )
    ).rejects.toThrow(/timeout/);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(snapshot.episodes['1'].failures).toEqual([
      expect.objectContaining({ kind: 'segment', index: 0, attempts: 3 }),
    ]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('scheduled KEY network failures make at most three total requests', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-key-attempts-'));
    fs.writeFileSync(path.join(root, 'episode_01.m3u8'), 'old-entry');
    const playlist =
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:1,\nsegment.ts';
    let keyRequests = 0;
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('list.m3u8')) return playlistResponse(playlist);
      if (url.endsWith('key.bin')) {
        keyRequests += 1;
        throw Object.assign(new Error('network timeout'), {
          name: 'AbortError',
        });
      }
      return responseFor('segment', 7);
    });
    const service = serviceForSnapshot(activeSnapshot()).service;

    await expect(invokeDownloadM3U8(service, 'task-1', root)).rejects.toThrow(
      /timeout/
    );
    expect(keyRequests).toBe(3);
    expect(service.getSnapshot('task-1')?.episodes['1'].failures).toEqual([
      expect.objectContaining({ kind: 'key', index: 0, attempts: 3 }),
    ]);
    expect(service.getSnapshot('task-1')?.episodes['1'].addressSource).toBe(
      'direct'
    );
    expect(fs.readFileSync(path.join(root, 'episode_01.m3u8'), 'utf8')).toBe(
      'old-entry'
    );
    fs.rmSync(root, { recursive: true, force: true });
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
    global.fetch = jest.fn().mockResolvedValue(responseFor('new', 3));
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
      status: 'completed',
    });
    expect(reacquireEpisode).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot('task-1')?.episodes['1']).toMatchObject({
      completedSegmentIndices: [0, 1],
      failedSegmentIndices: [],
      refreshCount: 1,
      addressSource: 'refreshed',
      oldEntryRetained: false,
    });
    const recoveryPlans = (
      service as unknown as {
        recoveryPlans: Map<string, { pendingSegments: unknown[] }>;
      }
    ).recoveryPlans;
    expect(recoveryPlans.get('task-1:1')?.pendingSegments).toEqual([
      expect.objectContaining({ index: 1, sequence: 11 }),
    ]);
    expect(fs.readFileSync(active, 'utf8')).toContain(
      'generation-a/segments/segment_001.ts'
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('recovery resolves the existing indexed path when the persisted title is encoded', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-indexed-path-'));
    const wrongRoot = path.join(root, '%E6%BD%9C%E8%A1%8C%E7%8B%99%E5%87%BB');
    const indexedRoot = path.join(root, '潜行狙击_2011', 'source-a_movie-1');
    const generation = path.join(
      indexedRoot,
      'episode_01_generations',
      'generation-a'
    );
    fs.mkdirSync(path.join(generation, 'segments'), { recursive: true });
    fs.writeFileSync(path.join(generation, 'segments', 'segment_000.ts'), 'ok');
    fs.writeFileSync(
      path.join(generation, 'segments', 'segment_001.ts'),
      'unflushed'
    );
    fs.writeFileSync(
      path.join(generation, 'source.cleaned.m3u8'),
      '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:10\n#EXTINF:1,\nhttps://saved.example/10.ts\n#EXTINF:1,\nhttps://saved.example/11.ts\n#EXTINF:1,\nhttps://saved.example/12.ts'
    );
    const snapshot = recoverySnapshot('generation-a');
    snapshot.title = '%E6%BD%9C%E8%A1%8C%E7%8B%99%E5%87%BB';
    global.fetch = jest.fn().mockResolvedValue(responseFor('saved', 5));
    const service = new DownloadService({
      storageManager: {
        ...storageMock,
        getResourcePath: () => wrongRoot,
        resolveExistingResourcePath: () => indexedRoot,
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
      reacquireEpisode: jest.fn().mockRejectedValue(new Error('offline')),
    });

    await expect(service.resumeTask('task-1')).resolves.toMatchObject({
      ok: true,
      status: 'completed',
    });
    expect(service.getSnapshot('task-1')?.episodes['1']).toMatchObject({
      completedSegmentIndices: [0, 1, 2],
      failedSegmentIndices: [],
    });
    expect(
      fs.readFileSync(path.join(generation, 'segments', 'segment_000.ts'))
    ).toEqual(Buffer.from('ok'));
    expect(
      fs.readFileSync(path.join(generation, 'segments', 'segment_001.ts'))
    ).toEqual(Buffer.from('unflushed'));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(wrongRoot)).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('recovery uses the persisted episode entry before refreshing the source', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-recipe-'));
    const generation = path.join(
      root,
      'episode_01_generations',
      'generation-a'
    );
    fs.mkdirSync(path.join(generation, 'segments'), { recursive: true });
    fs.writeFileSync(path.join(generation, 'segments', 'segment_000.ts'), 'ok');
    fs.writeFileSync(
      path.join(generation, 'source.cleaned.m3u8'),
      '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:10\n#EXTINF:1,\nold-10.ts\n#EXTINF:1,\nold-11.ts'
    );
    fs.writeFileSync(path.join(root, 'episode_01.m3u8'), 'old-entry');
    const persisted = recoverySnapshot('generation-a') as DownloadTaskSnapshot &
      Record<string, unknown>;
    persisted.recovery = {
      source: 'source-a',
      resourceId: 'movie-1',
      episodeEntries: { '1': 'https://persisted.example/list.m3u8' },
    };
    const reacquireEpisode = jest
      .fn()
      .mockRejectedValue(new Error('source refresh must not run'));
    const fetchSpy = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('list.m3u8')) {
        return playlistResponse(
          '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:10\n#EXTINF:1,\nfresh-10.ts\n#EXTINF:1,\nfresh-11.ts'
        );
      }
      return responseFor('fresh', 5);
    });
    global.fetch = fetchSpy;
    const service = new DownloadService({
      storageManager: {
        ...storageMock,
        getResourcePath: () => root,
      } as never,
      stateStore: {
        loadRecoverableTasks: () => [persisted],
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
      status: 'completed',
    });
    expect(reacquireEpisode).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(
      fs.readFileSync(path.join(generation, 'segments', 'segment_000.ts'))
    ).toEqual(Buffer.from('ok'));
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('recovery refreshes the source when the persisted entry has expired', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-refresh-'));
    const generation = path.join(
      root,
      'episode_01_generations',
      'generation-a'
    );
    fs.mkdirSync(path.join(generation, 'segments'), { recursive: true });
    fs.writeFileSync(path.join(generation, 'segments', 'segment_000.ts'), 'ok');
    fs.writeFileSync(
      path.join(generation, 'source.cleaned.m3u8'),
      '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:10\n#EXTINF:1,\nold-10.ts\n#EXTINF:1,\nold-11.ts'
    );
    fs.writeFileSync(path.join(root, 'episode_01.m3u8'), 'old-entry');
    const persisted = recoverySnapshot('generation-a') as DownloadTaskSnapshot &
      Record<string, unknown>;
    persisted.recovery = {
      source: 'source-a',
      resourceId: 'movie-1',
      episodeEntries: { '1': 'https://expired.example/list.m3u8' },
    };
    const reacquireEpisode = jest.fn().mockResolvedValue({
      playlistUrl: 'https://fresh.example/list.m3u8',
      content:
        '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:10\n#EXTINF:1,\nfresh-10.ts\n#EXTINF:1,\nfresh-11.ts',
    });
    const fetchSpy = jest.fn(async (input: string | URL | Request) => {
      if (String(input).includes('expired.example')) {
        return { ok: false, status: 403 } as Response;
      }
      return responseFor('fresh', 5);
    });
    global.fetch = fetchSpy;
    const service = new DownloadService({
      storageManager: {
        ...storageMock,
        getResourcePath: () => root,
      } as never,
      stateStore: {
        loadRecoverableTasks: () => [persisted],
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
      status: 'completed',
    });
    expect(reacquireEpisode).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1' }),
      1
    );
    expect(
      fetchSpy.mock.calls.some(([input]) =>
        String(input).includes('expired.example')
      )
    ).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('legacy recovery without a recipe reports that the source must be selected again', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-legacy-'));
    const generation = path.join(
      root,
      'episode_01_generations',
      'generation-a'
    );
    fs.mkdirSync(generation, { recursive: true });
    fs.writeFileSync(
      path.join(generation, 'source.cleaned.m3u8'),
      '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:10\n#EXTINF:1,\nold-10.ts'
    );
    fs.writeFileSync(path.join(root, 'episode_01.m3u8'), 'old-entry');
    const snapshot = recoverySnapshot('generation-a');
    const saveTask = jest.fn();
    const service = new DownloadService({
      storageManager: {
        ...storageMock,
        getResourcePath: () => root,
      } as never,
      stateStore: {
        loadRecoverableTasks: () => [snapshot],
        saveTask,
        deleteTaskState: jest.fn(),
      },
      scheduler: new DownloadScheduler({ concurrency: 1 }),
      publishProgress: jest.fn(),
      timer: async () => undefined,
      random: () => 0,
      reacquireEpisode: jest
        .fn()
        .mockRejectedValue(new Error('configured source unavailable')),
    });

    await expect(service.resumeTask('task-1')).resolves.toMatchObject({
      ok: false,
      status: 'failed',
    });
    expect(
      service.getSnapshot('task-1')?.episodes['1'].failures.at(-1)?.message
    ).toBe('旧任务缺少恢复入口，请重新选择来源');
    expect(fs.readFileSync(path.join(root, 'episode_01.m3u8'), 'utf8')).toBe(
      'old-entry'
    );
    expect(saveTask).toHaveBeenCalled();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('legacy recovery falls back to absolute URLs in the saved media manifest', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-manifest-'));
    const generation = path.join(
      root,
      'episode_01_generations',
      'generation-a'
    );
    fs.mkdirSync(path.join(generation, 'segments'), { recursive: true });
    fs.writeFileSync(path.join(generation, 'segments', 'segment_000.ts'), 'ok');
    fs.writeFileSync(
      path.join(generation, 'source.cleaned.m3u8'),
      '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:10\n#EXTINF:1,\nhttps://saved.example/10.ts?token=old\n#EXTINF:1,\nhttps://saved.example/11.ts?token=old'
    );
    fs.writeFileSync(path.join(root, 'episode_01.m3u8'), 'old-entry');
    const snapshot = recoverySnapshot('generation-a');
    const fetchSpy = jest.fn().mockResolvedValue(responseFor('saved', 5));
    global.fetch = fetchSpy;
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
      reacquireEpisode: jest
        .fn()
        .mockRejectedValue(new Error('configured source unavailable')),
    });

    await expect(service.resumeTask('task-1')).resolves.toMatchObject({
      ok: true,
      status: 'completed',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('/11.ts?token=old');
    expect(
      fs.readFileSync(path.join(generation, 'segments', 'segment_000.ts'))
    ).toEqual(Buffer.from('ok'));
    expect(
      fs.readFileSync(path.join(generation, 'segments', 'segment_001.ts'))
    ).toEqual(Buffer.from('saved'));
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('recovered snapshots execute missing work and advance the episode to completed', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-recovery-run-'));
    const generation = path.join(
      root,
      'episode_01_generations',
      'generation-a'
    );
    fs.mkdirSync(path.join(generation, 'segments'), { recursive: true });
    fs.writeFileSync(path.join(generation, 'segments', 'segment_000.ts'), 'ok');
    fs.writeFileSync(
      path.join(generation, 'source.cleaned.m3u8'),
      '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:10\n#EXT-X-KEY:METHOD=AES-128,URI="old.key"\n#EXT-X-MAP:URI="old.mp4"\n#EXTINF:1,\nold-10.ts\n#EXTINF:1,\nold-11.ts'
    );
    fs.writeFileSync(path.join(root, 'episode_01.m3u8'), 'old-entry');
    const fetchSpy = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('fresh.key')) return bufferResponse('key!', 4);
      if (url.endsWith('fresh.mp4')) return bufferResponse('map!', 4);
      return responseFor('fresh', 5);
    });
    global.fetch = fetchSpy;
    const persisted = recoverySnapshot('generation-a');
    persisted.status = 'partial_completed';
    const generateMetadata = jest.fn().mockResolvedValue(undefined);
    const updateIndex = jest.fn();
    const reacquireEpisode = jest
      .fn()
      .mockRejectedValue(new Error('configured source unavailable'));
    const service = new DownloadService({
      storageManager: {
        ...storageMock,
        getResourcePath: () => root,
        generateMetadata,
        updateIndex,
      } as never,
      stateStore: {
        loadRecoverableTasks: () => [persisted],
        saveTask: jest.fn(),
        deleteTaskState: jest.fn(),
      },
      scheduler: new DownloadScheduler({ concurrency: 1 }),
      publishProgress: jest.fn(),
      timer: async () => undefined,
      random: () => 0,
      reacquireEpisode,
    });

    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('list.m3u8')) {
        return playlistResponse(
          '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:10\n#EXT-X-KEY:METHOD=AES-128,URI="fresh.key"\n#EXT-X-MAP:URI="fresh.mp4"\n#EXTINF:1,\nfresh-10.ts\n#EXTINF:1,\nfresh-11.ts'
        );
      }
      if (url.endsWith('fresh.key')) return bufferResponse('key!', 4);
      if (url.endsWith('fresh.mp4')) return bufferResponse('map!', 4);
      return responseFor('fresh', 5);
    });
    await expect(
      (
        service.resumeTask as unknown as (
          taskId: string,
          currentResource: typeof resource
        ) => Promise<unknown>
      )('task-1', {
        ...resource,
        episodes: ['https://fresh.example/list.m3u8'],
      })
    ).resolves.toMatchObject({
      ok: true,
      status: 'completed',
    });
    expect(reacquireEpisode).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(
      fs.readFileSync(path.join(generation, 'segments', 'segment_000.ts'))
    ).toEqual(Buffer.from('ok'));
    expect(
      fs.readFileSync(path.join(generation, 'segments', 'segment_001.ts'))
    ).toEqual(Buffer.from('fresh'));
    expect(
      fs.readFileSync(path.join(generation, 'keys', 'key_000.key'))
    ).toEqual(Buffer.from('key!'));
    expect(
      fs.readFileSync(path.join(generation, 'maps', 'map_000.mp4'))
    ).toEqual(Buffer.from('map!'));
    expect(service.getSnapshot('task-1')?.episodes['1']).toMatchObject({
      stage: 'completed',
      completedSegmentIndices: [0, 1],
      failedSegmentIndices: [],
      oldEntryRetained: false,
      recoverable: false,
    });
    expect(
      fs.readFileSync(path.join(root, 'episode_01.m3u8'), 'utf8')
    ).toContain('generation-a/segments/segment_001.ts');
    expect(generateMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'movie-1', source: 'source-a' }),
      root,
      [path.join(root, 'episode_01.m3u8')],
      expect.any(Number),
      expect.any(Object)
    );
    expect(updateIndex).toHaveBeenCalled();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test.each([
    {
      kind: 'KEY',
      tag: '#EXT-X-KEY:METHOD=AES-128,URI="resource.bin"',
    },
    { kind: 'MAP', tag: '#EXT-X-MAP:URI="resource.bin"' },
  ])(
    '$kind Content-Length mismatch fails without completion and preserves the old entry',
    async ({ kind, tag }) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-length-'));
      const active = path.join(root, 'episode_01.m3u8');
      fs.writeFileSync(active, 'old-entry');
      const playlist = `#EXTM3U\n${tag}\n#EXTINF:1,\nsegment.ts`;
      global.fetch = jest.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('list.m3u8')) return playlistResponse(playlist);
        if (url.endsWith('resource.bin')) return bufferResponse('bad', 4);
        return responseFor('segment', 7);
      });
      const service = serviceForSnapshot(activeSnapshot()).service;

      await expect(invokeDownloadM3U8(service, 'task-1', root)).rejects.toThrow(
        /长度不匹配|length mismatch/
      );
      expect(service.getSnapshot('task-1')?.episodes['1']).toMatchObject({
        stage: 'partial_failed',
        oldEntryRetained: true,
        ...(kind === 'KEY' ? { keyCompleted: 0 } : { mapCompleted: 0 }),
      });
      expect(fs.readFileSync(active, 'utf8')).toBe('old-entry');
      fs.rmSync(root, { recursive: true, force: true });
    }
  );

  test('first segment failure cancels queued work and waits for active work before returning partial_failed', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-settle-'));
    fs.writeFileSync(path.join(root, 'episode_01.m3u8'), 'old-entry');
    const playlist =
      '#EXTM3U\n#EXTINF:1,\nfail.ts\n#EXTINF:1,\nactive.ts\n#EXTINF:1,\nqueued.ts';
    let releaseActive!: () => void;
    const activeGate = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    let activeStarted!: () => void;
    const activeStart = new Promise<void>((resolve) => {
      activeStarted = resolve;
    });
    let queuedRequests = 0;
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('list.m3u8')) return playlistResponse(playlist);
      if (url.endsWith('fail.ts')) {
        return { ok: false, status: 404 } as Response;
      }
      if (url.endsWith('active.ts')) {
        activeStarted();
        await activeGate;
        return responseFor('active', 6);
      }
      queuedRequests += 1;
      return responseFor('queued', 6);
    });
    const snapshot = activeSnapshot();
    const service = serviceForSnapshot(snapshot, {
      scheduler: new DownloadScheduler({ concurrency: 2 }),
    }).service;
    let settled = false;
    const download = invokeDownloadM3U8(service, 'task-1', root).finally(() => {
      settled = true;
    });

    await activeStart;
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(queuedRequests).toBe(0);
    releaseActive();
    await expect(download).rejects.toThrow(/404/);
    expect(queuedRequests).toBe(0);
    expect(service.getSnapshot('task-1')?.episodes['1'].stage).toBe(
      'partial_failed'
    );
    const generationName = fs
      .readdirSync(path.join(root, 'episode_01_generations'))
      .find((name) => name !== 'failures') as string;
    const segmentsDir = path.join(
      root,
      'episode_01_generations',
      generationName,
      'segments'
    );
    const filesAfterReturn = fs.readdirSync(segmentsDir);
    await Promise.resolve();
    expect(fs.readdirSync(segmentsDir)).toEqual(filesAfterReturn);
    expect(fs.readFileSync(path.join(root, 'episode_01.m3u8'), 'utf8')).toBe(
      'old-entry'
    );
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

  test('pause enters pausing immediately, stops dispatch, and waits for active work to finish', async () => {
    const snapshot = activeSnapshot();
    const scheduler = new DownloadScheduler({ concurrency: 1 });
    let finishActive!: () => void;
    const activeGate = new Promise<void>((resolve) => {
      finishActive = resolve;
    });
    const second = jest.fn().mockResolvedValue(undefined);
    const firstPromise = scheduler.enqueue(workItem(0), () => activeGate);
    const secondPromise = scheduler
      .enqueue(workItem(1), second)
      .catch(() => undefined);
    await Promise.resolve();
    const { service } = serviceForSnapshot(snapshot, { scheduler });

    expect(service.pauseTask('task-1')).toMatchObject({ ok: true });
    expect(service.getSnapshot('task-1')?.episodes['1'].stage).toBe('pausing');
    expect(service.getSnapshot('task-1')?.status).toBe('downloading');
    expect(second).not.toHaveBeenCalled();

    finishActive();
    await firstPromise;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(second).not.toHaveBeenCalled();
    expect(service.getSnapshot('task-1')).toMatchObject({ status: 'paused' });
    expect(service.getSnapshot('task-1')?.episodes['1'].stage).toBe('paused');
    scheduler.cancelQueued('task-1');
    await secondPromise;
  });

  test('pause then resume keeps one generation owner and downloads each segment once', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-pause-resume-'));
    const scheduler = new DownloadScheduler({ concurrency: 1 });
    const snapshot = activeSnapshot();
    const { service, publishProgress } = serviceForSnapshot(snapshot, {
      scheduler,
      resourcePath: root,
    });
    const renameSpy = jest.spyOn(fs, 'renameSync');
    const requests = new Map<string, number>();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const firstStart = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const playlist = '#EXTM3U\n#EXTINF:1,\nfirst.ts\n#EXTINF:1,\nsecond.ts';
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requests.set(url, (requests.get(url) ?? 0) + 1);
      if (url.endsWith('list.m3u8')) return playlistResponse(playlist);
      if (url.endsWith('first.ts')) {
        firstStarted();
        await firstGate;
        return responseFor('first', 5);
      }
      return responseFor('second', 6);
    });
    const download = invokeDownloadM3U8(service, 'task-1', root);

    await firstStart;
    expect(service.pauseTask('task-1')).toMatchObject({ ok: true });
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(service.getSnapshot('task-1')?.status).toBe('paused');

    await expect(service.resumeTask('task-1')).resolves.toMatchObject({
      ok: true,
      status: 'downloading',
    });
    await expect(download).resolves.toBeDefined();

    expect(requests.get('https://media.example/first.ts')).toBe(1);
    expect(requests.get('https://media.example/second.ts')).toBe(1);
    expect(service.getSnapshot('task-1')?.episodes['1'].stage).toBe(
      'completed'
    );
    expect(
      renameSpy.mock.calls.filter(
        ([, destination]) =>
          String(destination) === path.join(root, 'episode_01.m3u8')
      )
    ).toHaveLength(1);
    expect(
      publishProgress.mock.calls.filter(
        ([, payload]) => payload.status === 'completed'
      )
    ).toHaveLength(1);
    renameSpy.mockRestore();
    expect(
      fs.readFileSync(path.join(root, 'episode_01.m3u8'), 'utf8')
    ).toContain('segments/segment_001.ts');
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('applies post-download bitrate filtering without shifting surviving segment paths', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-post-filter-'));
    const snapshot = activeSnapshot();
    const { service } = serviceForSnapshot(snapshot, {
      scheduler: new DownloadScheduler({ concurrency: 8 }),
      resourcePath: root,
    });
    const lines = ['#EXTM3U', '#EXT-X-TARGETDURATION:5'];
    for (let group = 0; group < 30; group += 1) {
      if (group > 0) lines.push('#EXT-X-DISCONTINUITY');
      for (let segment = 0; segment < 6; segment += 1) {
        const index = group * 6 + segment;
        lines.push('#EXTINF:4,', `segment-${index}.ts`);
      }
    }
    lines.push('#EXT-X-ENDLIST');
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('list.m3u8')) return playlistResponse(lines.join('\n'));
      const match = url.match(/segment-(\d+)\.ts$/);
      const index = Number(match?.[1]);
      const size = index >= 72 && index <= 77 ? 65 : 300;
      return responseFor('x'.repeat(size), size);
    });

    await expect(
      invokeDownloadM3U8(service, 'task-1', root)
    ).resolves.toBeDefined();

    const committed = fs.readFileSync(
      path.join(root, 'episode_01.m3u8'),
      'utf8'
    );
    expect(committed).toContain('segments/segment_071.ts');
    expect(committed).toContain('segments/segment_078.ts');
    expect(committed).not.toContain('segments/segment_072.ts');
    expect(committed).not.toContain('segments/segment_077.ts');
    const reportPath = fs
      .readdirSync(path.join(root, 'episode_01_generations'))
      .map((generation) =>
        path.join(root, 'episode_01_generations', generation, 'report.json')
      )[0];
    expect(JSON.parse(fs.readFileSync(reportPath, 'utf8'))).toMatchObject({
      removed_segments: 6,
      final_segments: 174,
      filter_reasons: ['isolated-bitrate-outlier'],
    });
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('default cancel retains generation and state while clean cancel removes only uncommitted data', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-cancel-'));
    const generationRoot = path.join(
      root,
      'episode_01_generations',
      'generation-a'
    );
    fs.mkdirSync(generationRoot, { recursive: true });
    fs.writeFileSync(path.join(generationRoot, 'segment.ts'), 'partial');
    const committedGeneration = path.join(
      root,
      'episode_02_generations',
      'generation-b'
    );
    fs.mkdirSync(committedGeneration, { recursive: true });
    fs.writeFileSync(path.join(committedGeneration, 'segment.ts'), 'committed');
    const active = path.join(root, 'episode_01.m3u8');
    fs.writeFileSync(active, '#EXTM3U\nold-entry.ts');
    const snapshot = activeSnapshot();
    snapshot.episodeNumbers.push(2);
    snapshot.episodes['2'] = {
      ...snapshot.episodes['1'],
      episode: 2,
      generationId: 'generation-b',
      stage: 'completed',
      completedSegmentIndices: [0],
      recoverable: false,
    };
    const stateStore = {
      loadRecoverableTasks: () => [snapshot],
      saveTask: jest.fn(),
      deleteTaskState: jest.fn(),
    };
    const service = new DownloadService({
      storageManager: {
        ...storageMock,
        getResourcePath: () => root,
      } as never,
      stateStore,
      scheduler: new DownloadScheduler({ concurrency: 1 }),
      publishProgress: jest.fn(),
      timer: async () => undefined,
      random: () => 0,
    });

    await expect(service.cancelTask('task-1')).resolves.toMatchObject({
      ok: true,
      status: 'cancelled_resumable',
    });
    expect(fs.existsSync(generationRoot)).toBe(true);
    expect(fs.readFileSync(active, 'utf8')).toContain('old-entry.ts');
    expect(stateStore.deleteTaskState).not.toHaveBeenCalled();
    expect(stateStore.saveTask).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled_resumable' })
    );

    await expect(service.cancelTask('task-1', true)).resolves.toMatchObject({
      ok: true,
    });
    expect(fs.existsSync(generationRoot)).toBe(false);
    expect(fs.existsSync(committedGeneration)).toBe(true);
    expect(fs.readFileSync(active, 'utf8')).toContain('old-entry.ts');
    expect(stateStore.deleteTaskState).toHaveBeenCalledWith('task-1');
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('clean cancel waits for active task work before deleting generation and state', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-clean-wait-'));
    const generationRoot = path.join(
      root,
      'episode_01_generations',
      'generation-a'
    );
    fs.mkdirSync(generationRoot, { recursive: true });
    const scheduler = new DownloadScheduler({ concurrency: 1 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = scheduler.enqueue(workItem(0), async () => {
      await gate;
      fs.writeFileSync(path.join(generationRoot, 'late-write.ts'), 'done');
    });
    await Promise.resolve();
    const snapshot = activeSnapshot();
    const { service, stateStore } = serviceForSnapshot(snapshot, {
      scheduler,
      resourcePath: root,
    });
    let cancelled = false;
    const cancellation = service.cancelTask('task-1', true).then((result) => {
      cancelled = true;
      return result;
    });

    await Promise.resolve();
    expect(cancelled).toBe(false);
    expect(fs.existsSync(generationRoot)).toBe(true);
    expect(stateStore.deleteTaskState).not.toHaveBeenCalled();
    release();
    await active;
    await expect(cancellation).resolves.toMatchObject({ ok: true });
    expect(fs.existsSync(generationRoot)).toBe(false);
    expect(stateStore.deleteTaskState).toHaveBeenCalledWith('task-1');
    expect(service.getSnapshot('task-1')).toBeNull();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('clean cancel rejects an unsafe generationId without touching an outside sentinel', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-clean-safe-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-outside-'));
    const sentinel = path.join(outside, 'sentinel');
    fs.writeFileSync(sentinel, 'keep');
    const snapshot = activeSnapshot();
    snapshot.episodes['1'].generationId = path.relative(
      path.join(root, 'episode_01_generations'),
      outside
    );
    const { service, stateStore } = serviceForSnapshot(snapshot, {
      resourcePath: root,
    });

    await expect(service.cancelTask('task-1', true)).rejects.toThrow(
      /generationId|generation path/i
    );
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('keep');
    expect(stateStore.deleteTaskState).not.toHaveBeenCalled();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  test('clean cancel rejects a symlinked generations directory without touching its external target', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-clean-link-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-external-'));
    const externalGeneration = path.join(outside, 'generation-a');
    const sentinel = path.join(externalGeneration, 'sentinel');
    fs.mkdirSync(externalGeneration);
    fs.writeFileSync(sentinel, 'keep');
    fs.symlinkSync(outside, path.join(root, 'episode_01_generations'), 'dir');
    const { service, stateStore } = serviceForSnapshot(activeSnapshot(), {
      resourcePath: root,
    });

    await expect(service.cancelTask('task-1', true)).rejects.toThrow(
      /symbolic link|generation path/i
    );
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('keep');
    expect(fs.existsSync(externalGeneration)).toBe(true);
    expect(stateStore.deleteTaskState).not.toHaveBeenCalled();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  test('clean cancel invalidates a pending pause settle callback', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-pause-cancel-'));
    const generationRoot = path.join(
      root,
      'episode_01_generations',
      'generation-a'
    );
    fs.mkdirSync(generationRoot, { recursive: true });
    const scheduler = new DownloadScheduler({ concurrency: 1 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = scheduler.enqueue(workItem(0), () => gate);
    await Promise.resolve();
    const snapshot = activeSnapshot();
    const { service, stateStore } = serviceForSnapshot(snapshot, {
      scheduler,
      resourcePath: root,
    });
    service.pauseTask('task-1');
    stateStore.saveTask.mockClear();
    const cancellation = service.cancelTask('task-1', true);

    release();
    await active;
    await cancellation;
    stateStore.saveTask.mockClear();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(service.getSnapshot('task-1')).toBeNull();
    expect(stateStore.saveTask).not.toHaveBeenCalled();
    expect(stateStore.deleteTaskState).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(generationRoot)).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('retryFailed runs only recorded failed work and never completed work', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-retry-only-'));
    const generation = recoveryGeneration(root, 'generation-a');
    fs.writeFileSync(
      path.join(generation, 'segments', 'segment_000.ts'),
      'done'
    );
    fs.writeFileSync(
      path.join(generation, 'source.cleaned.m3u8'),
      '#EXTM3U\n#EXTINF:1,\nfirst.ts\n#EXTINF:1,\nsecond.ts'
    );
    fs.writeFileSync(path.join(root, 'episode_01.m3u8'), 'old-entry');
    const snapshot = activeSnapshot();
    snapshot.status = 'failed';
    snapshot.episodes['1'].stage = 'partial_failed';
    snapshot.episodes['1'].completedSegmentIndices = [0];
    snapshot.episodes['1'].failedSegmentIndices = [1];
    const { service } = serviceForSnapshot(snapshot, { resourcePath: root });
    const completedOperation = jest.fn().mockResolvedValue(4);
    const failedOperation = jest.fn().mockResolvedValue(5);
    installFailedSegmentWork(service, async (filePath) => {
      await failedOperation();
      fs.writeFileSync(filePath, 'retry');
      return 5;
    });

    await expect(service.retryFailed('task-1')).resolves.toMatchObject({
      ok: true,
    });
    expect(failedOperation).toHaveBeenCalledTimes(1);
    expect(completedOperation).not.toHaveBeenCalled();
    expect(service.getSnapshot('task-1')?.episodes['1']).toMatchObject({
      completedSegmentIndices: [0, 1],
      failedSegmentIndices: [],
    });
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('retryFailed rebuilds validates and atomically commits a completed episode', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-retry-commit-'));
    const generation = recoveryGeneration(root, 'generation-a');
    fs.writeFileSync(path.join(generation, 'segments', 'segment_000.ts'), 'ok');
    fs.writeFileSync(
      path.join(generation, 'source.cleaned.m3u8'),
      '#EXTM3U\n#EXTINF:1,\nfirst.ts\n#EXTINF:1,\nsecond.ts'
    );
    const active = path.join(root, 'episode_01.m3u8');
    fs.writeFileSync(active, 'old-entry');
    const snapshot = recoverySnapshot('generation-a');
    snapshot.status = 'failed';
    snapshot.episodes['1'].stage = 'partial_failed';
    const { service } = serviceForSnapshot(snapshot, { resourcePath: root });
    installFailedSegmentWork(service, async (filePath) => {
      fs.writeFileSync(filePath, 'retried');
      return 7;
    });

    await expect(service.retryFailed('task-1')).resolves.toMatchObject({
      ok: true,
      status: 'completed',
    });
    expect(service.getSnapshot('task-1')?.episodes['1']).toMatchObject({
      stage: 'completed',
      oldEntryRetained: false,
      recoverable: false,
      failedSegmentIndices: [],
    });
    expect(fs.readFileSync(active, 'utf8')).toContain(
      'generation-a/segments/segment_001.ts'
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('retryFailed commit failure keeps the old entry and partial_failed state', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-retry-fail-'));
    const generation = recoveryGeneration(root, 'generation-a');
    fs.writeFileSync(path.join(generation, 'segments', 'segment_000.ts'), 'ok');
    fs.writeFileSync(
      path.join(generation, 'source.cleaned.m3u8'),
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="missing.key"\n#EXTINF:1,\nfirst.ts\n#EXTINF:1,\nsecond.ts'
    );
    const active = path.join(root, 'episode_01.m3u8');
    fs.writeFileSync(active, 'old-entry');
    const snapshot = recoverySnapshot('generation-a');
    snapshot.status = 'failed';
    snapshot.episodes['1'].stage = 'partial_failed';
    const { service } = serviceForSnapshot(snapshot, { resourcePath: root });
    installFailedSegmentWork(service, async (filePath) => {
      fs.writeFileSync(filePath, 'retried');
      return 7;
    });

    await expect(service.retryFailed('task-1')).resolves.toMatchObject({
      ok: false,
      status: 'failed',
    });
    expect(service.getSnapshot('task-1')?.episodes['1']).toMatchObject({
      stage: 'partial_failed',
      oldEntryRetained: true,
      recoverable: true,
    });
    expect(fs.readFileSync(active, 'utf8')).toBe('old-entry');
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('batches segment persistence at 250ms or 20 changes and flushes terminals immediately', () => {
    jest.useFakeTimers();
    try {
      const snapshot = activeSnapshot();
      const { service, stateStore, publishProgress } =
        serviceForSnapshot(snapshot);
      const queue = (
        service as unknown as { queueSnapshotFlush: (taskId: string) => void }
      ).queueSnapshotFlush.bind(service);
      const flush = (
        service as unknown as {
          flushSnapshotForTask: (taskId: string, type: 'task.updated') => void;
        }
      ).flushSnapshotForTask.bind(service);

      for (let index = 0; index < 19; index += 1) queue('task-1');
      expect(stateStore.saveTask).not.toHaveBeenCalled();
      jest.advanceTimersByTime(249);
      expect(stateStore.saveTask).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(stateStore.saveTask).toHaveBeenCalledTimes(1);
      expect(publishProgress).toHaveBeenLastCalledWith(
        'segment.batch',
        expect.objectContaining({ taskId: 'task-1' })
      );

      stateStore.saveTask.mockClear();
      publishProgress.mockClear();
      for (let index = 0; index < 20; index += 1) queue('task-1');
      expect(stateStore.saveTask).toHaveBeenCalledTimes(1);

      snapshot.episodes['1'].stage = 'partial_failed';
      flush('task-1', 'task.updated');
      expect(stateStore.saveTask).toHaveBeenCalledTimes(2);
      expect(publishProgress).toHaveBeenLastCalledWith(
        'task.updated',
        expect.objectContaining({ status: 'failed' })
      );

      snapshot.episodes['1'].stage = 'completed';
      snapshot.episodes['1'].progress = 95;
      snapshot.status = 'downloading';
      flush('task-1', 'task.updated');
      expect(snapshot.episodes['1'].progress).toBe(100);
      expect(snapshot.progress).toBe(100);
      expect(snapshot.status).toBe('completed');
    } finally {
      jest.useRealTimers();
    }
  });

  test('records completion once and only after a validated writer finish', async () => {
    let finishValidatedWrite!: (bytes: number) => void;
    const validatedWrite = new Promise<number>((resolve) => {
      finishValidatedWrite = resolve;
    });
    const snapshot = activeSnapshot();
    const { service } = serviceForSnapshot(snapshot);
    const episode = snapshot.episodes['1'];
    const execute = service as unknown as {
      executeScheduled: (
        episodeState: typeof episode,
        item: ReturnType<typeof workItem>,
        filePath: string,
        operation: () => Promise<number>
      ) => Promise<number>;
      markUnitCompleted: (
        episodeState: typeof episode,
        item: ReturnType<typeof workItem>,
        bytes: number
      ) => void;
    };
    await expect(
      execute.executeScheduled(
        episode,
        workItem(1),
        '/tmp/invalid-segment.ts',
        async () => {
          throw new Error('download length mismatch');
        }
      )
    ).rejects.toThrow(/length mismatch/);
    expect(episode.completedSegmentIndices).toEqual([]);

    const completion = execute.executeScheduled(
      episode,
      workItem(0),
      '/tmp/validated-segment.ts',
      () => validatedWrite
    );
    await Promise.resolve();
    expect(episode.completedSegmentIndices).toEqual([]);

    finishValidatedWrite(5);
    await expect(completion).resolves.toBe(5);
    expect(episode.completedSegmentIndices).toEqual([0]);
    expect(episode.completedBytes).toBe(5);
    execute.markUnitCompleted(episode, workItem(0), 5);
    expect(episode.completedSegmentIndices).toEqual([0]);
    expect(episode.completedBytes).toBe(5);
  });

  test('reports truthful per-active-slot speed and scheduler concurrency', async () => {
    const snapshot = activeSnapshot();
    const scheduler = new DownloadScheduler({ concurrency: 5 });
    const { service } = serviceForSnapshot(snapshot, { scheduler });
    const episode = snapshot.episodes['1'];
    let now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const execute = service as unknown as {
      executeScheduled: (
        episodeState: typeof episode,
        item: ReturnType<typeof workItem>,
        filePath: string,
        operation: (
          reportWrittenBytes?: (bytes: number) => void
        ) => Promise<number>
      ) => Promise<number>;
    };
    const completion = execute.executeScheduled(
      episode,
      workItem(0),
      '/tmp/active-speed.ts',
      async (reportWrittenBytes) => {
        now = 1000;
        reportWrittenBytes?.(2000);
        await gate;
        return 2000;
      }
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(service.getSchedulerDiagnostics().concurrency).toBe(5);
    expect(episode.activeItems).toHaveLength(1);
    expect(episode.activeItems[0]).toMatchObject({
      index: 0,
      attempt: 1,
      speedBytesPerSecond: 2000,
    });

    const flush = (
      service as unknown as {
        flushSnapshotForTask: (taskId: string, type: 'segment.batch') => void;
      }
    ).flushSnapshotForTask.bind(service);
    flush('task-1', 'segment.batch');
    expect(episode.speedBytesPerSecond).toBe(2000);
    expect(snapshot.speedBytesPerSecond).toBe(2000);

    finish();
    await expect(completion).resolves.toBe(2000);
    expect(episode.activeItems).toEqual([]);
  });
});

function recoverySnapshot(generationId: string): DownloadTaskSnapshot {
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

function activeSnapshot() {
  const snapshot = recoverySnapshot('generation-a');
  snapshot.status = 'downloading';
  snapshot.episodes['1'].stage = 'downloading';
  snapshot.episodes['1'].completedSegmentIndices = [];
  snapshot.episodes['1'].failedSegmentIndices = [];
  snapshot.episodes['1'].completedBytes = 0;
  return snapshot;
}

function workItem(index: number) {
  return {
    taskId: 'task-1',
    episode: 1,
    generationId: 'g',
    kind: 'segment' as const,
    index,
    attempt: 1,
  };
}

function serviceForSnapshot(
  snapshot: ReturnType<typeof activeSnapshot>,
  overrides: { scheduler?: DownloadScheduler; resourcePath?: string } = {}
) {
  const stateStore = {
    loadRecoverableTasks: () => [snapshot],
    saveTask: jest.fn(),
    deleteTaskState: jest.fn(),
  };
  const publishProgress = jest.fn();
  const service = new DownloadService({
    storageManager: {
      ...storageMock,
      ...(overrides.resourcePath
        ? { getResourcePath: () => overrides.resourcePath }
        : {}),
    } as never,
    stateStore,
    scheduler: overrides.scheduler ?? new DownloadScheduler({ concurrency: 1 }),
    publishProgress,
    timer: async () => undefined,
    random: () => 0,
  });
  return { service, stateStore, publishProgress };
}

function recoveryGeneration(root: string, generationId: string) {
  const generation = path.join(root, 'episode_01_generations', generationId);
  fs.mkdirSync(path.join(generation, 'segments'), { recursive: true });
  fs.mkdirSync(path.join(generation, 'keys'), { recursive: true });
  fs.mkdirSync(path.join(generation, 'maps'), { recursive: true });
  return generation;
}

function installFailedSegmentWork(
  service: DownloadService,
  operation: (filePath: string) => Promise<number>
) {
  const snapshot = service.getSnapshot('task-1') as DownloadTaskSnapshot;
  const resourcePath = (
    service as unknown as {
      storageManager: { getResourcePath: (...args: string[]) => string };
    }
  ).storageManager.getResourcePath(
    snapshot.title,
    snapshot.year,
    snapshot.source,
    snapshot.resourceId
  );
  const failedPath = path.join(
    resourcePath,
    'episode_01_generations',
    snapshot.episodes['1'].generationId,
    'segments',
    'segment_001.ts'
  );
  (
    service as unknown as {
      failedWork: Map<
        string,
        {
          item: ReturnType<typeof workItem>;
          operation: () => Promise<number>;
          path: string;
        }
      >;
    }
  ).failedWork.set(
    `task-1:1:${snapshot.episodes['1'].generationId}:segment:1`,
    {
      item: {
        ...workItem(1),
        generationId: snapshot.episodes['1'].generationId,
      },
      operation: () => operation(failedPath),
      path: failedPath,
    }
  );
}

function playlistResponse(content: string) {
  return {
    ok: true,
    status: 200,
    text: async () => content,
  } as Response;
}

function bufferResponse(content: string, contentLength: number) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => String(contentLength) },
    arrayBuffer: async () => Buffer.from(content),
  } as unknown as Response;
}

function invokeDownloadM3U8(
  service: DownloadService,
  taskId: string,
  root: string
) {
  return (
    service as unknown as {
      downloadM3U8: (
        url: string,
        root: string,
        episode: number,
        progress: undefined,
        audit: {
          taskId: string;
          sourceUrl: string;
          addressMethod: 'direct';
        }
      ) => Promise<unknown>;
    }
  ).downloadM3U8('https://media.example/list.m3u8', root, 1, undefined, {
    taskId,
    sourceUrl: 'https://media.example/list.m3u8',
    addressMethod: 'direct',
  });
}
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Writable } from 'stream';
