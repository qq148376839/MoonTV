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
});
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Writable } from 'stream';
