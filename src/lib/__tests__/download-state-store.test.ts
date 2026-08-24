import fs from 'fs';
import os from 'os';
import path from 'path';

import { DownloadStateStore } from '../download-state-store';
import type {
  DownloadTaskSnapshot,
  EpisodeDownloadState,
} from '../download-types';

const DAY = 24 * 60 * 60 * 1000;

function episode(
  number: number,
  overrides: Partial<EpisodeDownloadState> = {}
): EpisodeDownloadState {
  return {
    episode: number,
    generationId: `generation-${number}`,
    stage: 'downloading',
    totalSegments: 4,
    completedSegmentIndices: [0, 1],
    failedSegmentIndices: [2],
    activeItems: [
      {
        taskId: 'task-1',
        episode: number,
        generationId: `generation-${number}`,
        kind: 'segment',
        index: 3,
        attempt: 1,
      },
    ],
    keyTotal: 1,
    keyCompleted: 1,
    mapTotal: 1,
    mapCompleted: 1,
    completedBytes: 200,
    estimatedBytes: 400,
    progress: 50,
    progressEstimated: false,
    speedBytesPerSecond: 20,
    etaSeconds: 10,
    failures: [
      {
        kind: 'segment',
        index: 2,
        category: 'http_auth',
        attempts: 2,
        path: 'segments/segment_002.ts',
        message: 'segment download failed',
      },
    ],
    oldEntryRetained: true,
    recoverable: true,
    refreshCount: 1,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function snapshot(
  taskId = 'task-1',
  overrides: Partial<DownloadTaskSnapshot> = {}
): DownloadTaskSnapshot {
  return {
    schemaVersion: 1,
    taskId,
    source: 'provider',
    resourceId: 'resource-1',
    title: 'A title',
    year: '2024',
    poster: '/poster.jpg',
    episodeNumbers: [1, 2],
    status: 'downloading',
    priority: 'normal',
    currentEpisode: 1,
    progress: 50,
    progressEstimated: false,
    speedBytesPerSecond: 20,
    etaSeconds: 10,
    completedBytes: 200,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    episodes: { '1': episode(1), '2': episode(2, { stage: 'paused' }) },
    ...overrides,
  };
}

function createSymlinkOrSkip(
  target: string,
  linkPath: string,
  type: 'dir' | 'file'
): boolean {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    if (
      process.platform === 'win32' &&
      (error as NodeJS.ErrnoException).code === 'EPERM'
    ) {
      return false;
    }
    throw error;
  }
}

describe('DownloadStateStore', () => {
  let root: string;
  let store: DownloadStateStore;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-state-'));
    store = new DownloadStateStore(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('saves task summaries and full episode files, then loads the original state', () => {
    const state = snapshot();
    store.saveTask(state);

    const taskDir = path.join(root, 'download-tasks', state.taskId);
    expect(fs.existsSync(path.join(taskDir, 'task.json'))).toBe(true);
    expect(fs.existsSync(path.join(taskDir, 'episodes', '01.json'))).toBe(true);
    expect(fs.existsSync(path.join(taskDir, 'episodes', '02.json'))).toBe(true);
    expect(store.loadTask(state.taskId)).toEqual(state);
  });

  test('stores only episode summaries in task.json, without indices, active work, or failures', () => {
    const state = snapshot();
    state.episodes['1'].completedSegmentIndices = Array.from(
      { length: 1000 },
      (_, index) => index
    );
    store.saveTask(state);

    const persisted = JSON.parse(
      fs.readFileSync(
        path.join(root, 'download-tasks', state.taskId, 'task.json'),
        'utf8'
      )
    );
    const summary = persisted.episodes['1'];
    expect(summary).toMatchObject({ episode: 1, stage: 'downloading' });
    expect(summary).not.toHaveProperty('completedSegmentIndices');
    expect(summary).not.toHaveProperty('failedSegmentIndices');
    expect(summary).not.toHaveProperty('activeItems');
    expect(summary).not.toHaveProperty('failures');
    expect(JSON.stringify(persisted)).not.toContain('999');
  });

  test('redacts URL query strings and fragments from all persisted failure text', () => {
    const state = snapshot();
    state.episodes['1'].failures[0].path =
      'https://cdn.example/segment.ts?signature=secret#part';
    state.episodes['1'].failures[0].message =
      'failed https://cdn.example/segment.ts?signature=secret#part';
    store.saveTask(state);

    const taskDir = path.join(root, 'download-tasks', 'task-1');
    const persisted = [
      fs.readFileSync(path.join(taskDir, 'task.json'), 'utf8'),
      fs.readFileSync(path.join(taskDir, 'episodes', '01.json'), 'utf8'),
    ].join('\n');
    expect(persisted).not.toContain('signature=secret');
    expect(persisted).not.toContain('#part');
    expect(persisted).toContain('https://cdn.example/segment.ts');
  });

  test('keeps signed recovery entries private while still redacting diagnostic text', () => {
    const state = snapshot() as DownloadTaskSnapshot & Record<string, unknown>;
    state.recovery = {
      source: 'provider',
      resourceId: 'resource-1',
      episodeEntries: {
        '1': 'https://media.example/list.m3u8?signature=resume-secret',
      },
    };
    state.episodes['1'].failures[0].message =
      'failed https://media.example/list.m3u8?signature=resume-secret';

    store.saveTask(state);

    const taskDir = path.join(root, 'download-tasks', state.taskId);
    const taskJson = fs.readFileSync(path.join(taskDir, 'task.json'), 'utf8');
    const episodeJson = fs.readFileSync(
      path.join(taskDir, 'episodes', '01.json'),
      'utf8'
    );
    expect(taskJson).toContain('signature=resume-secret');
    expect(episodeJson).not.toContain('signature=resume-secret');
    const loaded = store.loadTask(state.taskId) as DownloadTaskSnapshot &
      Record<string, unknown>;
    expect(loaded.recovery).toEqual(state.recovery);
    expect(loaded.episodes['1'].failures[0].message).toBe(
      'failed https://media.example/list.m3u8'
    );
  });

  test('rejects a recovery recipe that does not match the task identity', () => {
    const state = snapshot() as DownloadTaskSnapshot & Record<string, unknown>;
    state.recovery = {
      source: 'different-provider',
      resourceId: 'resource-1',
      episodeEntries: { '1': 'https://media.example/list.m3u8' },
    };
    store.saveTask(state);

    expect(() => store.loadTask(state.taskId)).toThrow(
      /recovery source mismatch/i
    );
  });

  test('recursively redacts signed URLs and path-like sensitive tails before persistence', () => {
    const state = snapshot();
    state.poster = 'https://images.example/poster.jpg?signature=secret#preview';
    state.episodes['1'].failures[0].path =
      'segments/a.ts?signature=secret#part';
    state.episodes['1'].failures[0].message =
      'failed segments/a.ts?signature=secret#part';
    Object.assign(
      state.episodes['1'].failures[0] as unknown as Record<string, unknown>,
      {
        nested: {
          path: 'keys/key.bin?token=secret#fragment',
          message: 'nested https://cdn.example/key.bin?token=secret#fragment',
          note: '普通中文问号？必须保留',
        },
        manifestUrl: 'https://cdn.example/manifest.m3u8?token=secret#part',
      }
    );

    store.saveTask(state);

    const taskDir = path.join(root, 'download-tasks', state.taskId);
    const persisted = [
      fs.readFileSync(path.join(taskDir, 'task.json'), 'utf8'),
      fs.readFileSync(path.join(taskDir, 'episodes', '01.json'), 'utf8'),
    ].join('\n');
    expect(persisted).not.toContain('signature=secret');
    expect(persisted).not.toContain('token=secret');
    expect(persisted).not.toContain('#part');
    expect(persisted).not.toContain('#fragment');
    expect(persisted).toContain('segments/a.ts');
    expect(persisted).toContain('普通中文问号？必须保留');
  });

  test('unconditionally removes query and fragments from Chinese relative failure paths', () => {
    const state = snapshot();
    state.episodes['1'].failures[0].path = '目录/片段.ts?signature=secret#part';
    store.saveTask(state);

    const persisted = fs.readFileSync(
      path.join(root, 'download-tasks', state.taskId, 'episodes', '01.json'),
      'utf8'
    );
    expect(persisted).toContain('目录/片段.ts');
    expect(persisted).not.toContain('signature=secret');
    expect(persisted).not.toContain('#part');
  });

  test('redacts Chinese relative paths embedded in messages without truncating Chinese questions', () => {
    const state = snapshot();
    state.episodes['1'].failures[0].message =
      '下载失败：目录/片段.ts?signature=secret#part';
    Object.assign(
      state.episodes['1'].failures[0] as unknown as Record<string, unknown>,
      { nested: { message: '为什么失败？' } }
    );
    store.saveTask(state);

    const persisted = fs.readFileSync(
      path.join(root, 'download-tasks', state.taskId, 'episodes', '01.json'),
      'utf8'
    );
    expect(persisted).toContain('下载失败：目录/片段.ts');
    expect(persisted).not.toContain('signature=secret');
    expect(persisted).not.toContain('#part');
    expect(persisted).toContain('为什么失败？');
  });

  test.each([
    ['task', 'rename'],
    ['episode', 'rename'],
    ['task', 'write'],
    ['episode', 'write'],
  ] as const)(
    'keeps old %s JSON readable and removes temporary files when its atomic %s fails',
    (target, operation) => {
      const first = snapshot();
      store.saveTask(first);
      const taskPath = path.join(
        root,
        'download-tasks',
        first.taskId,
        'task.json'
      );
      const episodePath = path.join(
        root,
        'download-tasks',
        first.taskId,
        'episodes',
        '01.json'
      );
      const targetPath = target === 'task' ? taskPath : episodePath;
      const original = fs.readFileSync(targetPath, 'utf8');
      const originalRename = fs.renameSync;
      const originalWrite = fs.writeFileSync;
      const spy =
        operation === 'rename'
          ? jest.spyOn(fs, 'renameSync').mockImplementation(((
              source: fs.PathLike,
              destination: fs.PathLike
            ) => {
              if (String(destination) === targetPath) {
                throw new Error('rename failed');
              }
              return originalRename(source, destination);
            }) as typeof fs.renameSync)
          : jest.spyOn(fs, 'writeFileSync').mockImplementation(((
              ...args: Parameters<typeof fs.writeFileSync>
            ) => {
              if (String(args[0]).startsWith(`${targetPath}.`)) {
                throw new Error('write failed');
              }
              return originalWrite(...args);
            }) as typeof fs.writeFileSync);

      try {
        expect(() =>
          store.saveTask(
            snapshot('task-1', {
              title: 'new title',
              episodes: {
                '1': episode(1, { progress: 75 }),
                '2': episode(2, { stage: 'paused' }),
              },
            })
          )
        ).toThrow(operation === 'rename' ? 'rename failed' : 'write failed');
      } finally {
        spy.mockRestore();
      }

      expect(fs.readFileSync(targetPath, 'utf8')).toBe(original);
      expect(fs.readdirSync(path.dirname(targetPath))).not.toContainEqual(
        expect.stringContaining('.tmp')
      );
    }
  );

  test('loads incomplete tasks as recovery_wait without fetching', () => {
    store.saveTask(snapshot());
    const fetch = jest.fn();
    Object.assign(global, { fetch });

    const recovered = store.loadRecoverableTasks();

    expect(recovered).toHaveLength(1);
    expect(recovered[0].status).toBe('recovery_wait');
    expect(recovered[0].episodes['1'].stage).toBe('recovery_wait');
    expect(recovered[0].episodes['2'].stage).toBe('recovery_wait');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('preserves an unstarted pending task for queue rehydration', () => {
    const pending = snapshot('pending-task', {
      status: 'pending',
      progress: 0,
      completedBytes: 0,
      episodes: {},
      recovery: {
        source: 'provider',
        resourceId: 'resource-1',
        episodeEntries: { '1': 'https://media.example/episode-1.m3u8' },
      },
    });
    store.saveTask(pending);

    expect(store.loadRecoverableTasks()).toEqual([pending]);
  });

  test('normalizes a started-without-episode snapshot back to pending', () => {
    const started = snapshot('started-without-episode', {
      status: 'downloading',
      progress: 0,
      completedBytes: 0,
      episodes: {},
      recovery: {
        source: 'provider',
        resourceId: 'resource-1',
        episodeEntries: { '1': 'https://media.example/episode-1.m3u8' },
      },
    });
    store.saveTask(started);

    expect(store.loadRecoverableTasks()).toEqual([
      { ...started, status: 'pending' },
    ]);
  });

  test('loads recoverable failed and partially completed tasks after restart', () => {
    for (const status of ['failed', 'partial_completed'] as const) {
      store.saveTask(
        snapshot(`recoverable-${status}`, {
          status,
          episodes: {
            '1': episode(1, { stage: 'completed', recoverable: false }),
            '2': episode(2, { stage: 'partial_failed', recoverable: true }),
          },
        })
      );
    }

    expect(store.loadRecoverableTasks()).toEqual([
      expect.objectContaining({
        taskId: 'recoverable-failed',
        status: 'recovery_wait',
      }),
      expect.objectContaining({
        taskId: 'recoverable-partial_completed',
        status: 'recovery_wait',
      }),
    ]);
  });

  test('never recovers completed or cancelled tasks', () => {
    for (const status of ['completed', 'cancelled_resumable'] as const) {
      store.saveTask(snapshot(`terminal-${status}`, { status }));
    }

    expect(store.loadRecoverableTasks()).toEqual([]);
  });

  test('cleans completed after seven days and historical terminal tasks after thirty days, retaining active tasks', () => {
    const now = 1_800_000_000_000;
    store.saveTask(
      snapshot('completed-at-boundary', {
        status: 'completed',
        updatedAt: now - 7 * DAY,
      })
    );
    store.saveTask(
      snapshot('completed-recent', {
        status: 'completed',
        updatedAt: now - 7 * DAY + 1,
      })
    );
    store.saveTask(
      snapshot('failed-at-boundary', {
        status: 'failed',
        updatedAt: now - 30 * DAY,
      })
    );
    store.saveTask(
      snapshot('partial-at-boundary', {
        status: 'partial_completed',
        updatedAt: now - 30 * DAY,
      })
    );
    store.saveTask(
      snapshot('cancelled-at-boundary', {
        status: 'cancelled_resumable',
        updatedAt: now - 30 * DAY,
      })
    );
    store.saveTask(
      snapshot('paused-old', { status: 'paused', updatedAt: now - 365 * DAY })
    );

    expect(store.cleanupHistory(now).removed.sort()).toEqual([
      'cancelled-at-boundary',
      'completed-at-boundary',
      'failed-at-boundary',
      'partial-at-boundary',
    ]);
    expect(store.loadTask('completed-recent').taskId).toBe('completed-recent');
    expect(store.loadTask('paused-old').taskId).toBe('paused-old');
  });

  test('only cleans task state, leaving sibling video resources untouched', () => {
    const videoDir = path.join(root, 'resource-1');
    fs.mkdirSync(videoDir);
    fs.writeFileSync(path.join(videoDir, 'episode_01.m3u8'), 'video');
    store.saveTask(snapshot('done', { status: 'completed', updatedAt: 0 }));

    store.cleanupHistory(8 * DAY);

    expect(
      fs.readFileSync(path.join(videoDir, 'episode_01.m3u8'), 'utf8')
    ).toBe('video');
  });

  test('requires a finite cleanup timestamp', () => {
    expect(() => store.cleanupHistory(Number.NaN)).toThrow(TypeError);
    expect(() => store.cleanupHistory(Number.POSITIVE_INFINITY)).toThrow(
      TypeError
    );
  });

  test('explicitly fails for malformed task JSON and missing episode state', () => {
    store.saveTask(snapshot());
    const taskDir = path.join(root, 'download-tasks', 'task-1');
    fs.writeFileSync(path.join(taskDir, 'task.json'), '{bad json');
    expect(() => store.loadTask('task-1')).toThrow(/task\.json/);

    store.saveTask(snapshot());
    fs.rmSync(path.join(taskDir, 'episodes', '02.json'));
    expect(() => store.loadTask('task-1')).toThrow(/episode.*02\.json/i);
  });

  test('forces schema version one on save and rejects invalid task or episode structures', () => {
    const state = snapshot();
    (state as unknown as { schemaVersion: number }).schemaVersion = 99;
    store.saveTask(state);
    const taskDir = path.join(root, 'download-tasks', 'task-1');
    const taskPath = path.join(taskDir, 'task.json');
    const episodePath = path.join(taskDir, 'episodes', '01.json');
    expect(JSON.parse(fs.readFileSync(taskPath, 'utf8')).schemaVersion).toBe(1);

    const invalidTask = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
    invalidTask.status = 'invalid';
    fs.writeFileSync(taskPath, JSON.stringify(invalidTask));
    expect(() => store.loadTask('task-1')).toThrow(/status/i);

    store.saveTask(snapshot());
    const missingTaskField = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
    delete missingTaskField.title;
    fs.writeFileSync(taskPath, JSON.stringify(missingTaskField));
    expect(() => store.loadTask('task-1')).toThrow(/title/i);

    store.saveTask(snapshot());
    const invalidEpisode = JSON.parse(fs.readFileSync(episodePath, 'utf8'));
    invalidEpisode.stage = 'invalid';
    fs.writeFileSync(episodePath, JSON.stringify(invalidEpisode));
    expect(() => store.loadTask('task-1')).toThrow(/stage/i);

    store.saveTask(snapshot());
    const missingEpisodeField = JSON.parse(
      fs.readFileSync(episodePath, 'utf8')
    );
    delete missingEpisodeField.activeItems;
    fs.writeFileSync(episodePath, JSON.stringify(missingEpisodeField));
    expect(() => store.loadTask('task-1')).toThrow(/activeItems/i);
  });

  test('rejects traversal task IDs', () => {
    expect(() => store.saveTask(snapshot('../escape'))).toThrow(/taskId/i);
    expect(() => store.loadTask('../task-1')).toThrow(/taskId/i);
    expect(() => store.deleteTaskState('nested/task')).toThrow(/taskId/i);
  });

  test.each([
    '../outside',
    '..',
    '.',
    '/absolute',
    'nested/generation',
    'nested\\generation',
    'generation with spaces',
  ])('rejects unsafe persisted generationId %p', (generationId) => {
    store.saveTask(snapshot());
    const taskDir = path.join(root, 'download-tasks', 'task-1');
    const taskPath = path.join(taskDir, 'task.json');
    const episodePath = path.join(taskDir, 'episodes', '01.json');
    const taskState = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
    const episodeState = JSON.parse(fs.readFileSync(episodePath, 'utf8'));
    taskState.episodes['1'].generationId = generationId;
    episodeState.generationId = generationId;
    fs.writeFileSync(taskPath, JSON.stringify(taskState));
    fs.writeFileSync(episodePath, JSON.stringify(episodeState));

    expect(() => store.loadTask('task-1')).toThrow(/generationId/i);
  });

  test('rejects unsafe generationId in persisted active work', () => {
    store.saveTask(snapshot());
    const episodePath = path.join(
      root,
      'download-tasks',
      'task-1',
      'episodes',
      '01.json'
    );
    const episodeState = JSON.parse(fs.readFileSync(episodePath, 'utf8'));
    episodeState.activeItems[0].generationId = '../../outside';
    fs.writeFileSync(episodePath, JSON.stringify(episodeState));

    expect(() => store.loadTask('task-1')).toThrow(/generationId/i);
  });

  test('rejects a symbolic-link task directory before saving or listing', () => {
    const stateRoot = path.join(root, 'download-tasks');
    const outside = path.join(root, 'outside-task');
    fs.mkdirSync(stateRoot);
    fs.mkdirSync(outside);
    if (
      !createSymlinkOrSkip(outside, path.join(stateRoot, 'task-link'), 'dir')
    ) {
      return;
    }

    expect(() => store.saveTask(snapshot('task-link'))).toThrow(
      /symbolic link/i
    );
    expect(() => store.listTasks()).toThrow(/symbolic link/i);
  });

  test('rejects a symbolic-link episodes directory before saving or loading', () => {
    const stateRoot = path.join(root, 'download-tasks');
    const taskDir = path.join(stateRoot, 'task-1');
    const outside = path.join(root, 'outside-episodes');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.mkdirSync(outside);
    if (!createSymlinkOrSkip(outside, path.join(taskDir, 'episodes'), 'dir')) {
      return;
    }

    expect(() => store.saveTask(snapshot())).toThrow(/symbolic link/i);
    expect(() => store.loadTask('task-1')).toThrow(/symbolic link/i);
  });

  test('rejects a symbolic-link task JSON before reading, writing, or deleting', () => {
    store.saveTask(snapshot());
    const taskPath = path.join(root, 'download-tasks', 'task-1', 'task.json');
    const outside = path.join(root, 'outside-task.json');
    fs.renameSync(taskPath, outside);
    if (!createSymlinkOrSkip(outside, taskPath, 'file')) return;

    expect(() => store.loadTask('task-1')).toThrow(/symbolic link/i);
    expect(() => store.saveTask(snapshot())).toThrow(/symbolic link/i);
    expect(() => store.deleteTaskState('task-1')).toThrow(/symbolic link/i);
    expect(fs.existsSync(outside)).toBe(true);
  });

  test('cleanup rejects symbolic task directories without deleting their external target', () => {
    const stateRoot = path.join(root, 'download-tasks');
    const outside = path.join(root, 'outside-cleanup');
    fs.mkdirSync(stateRoot);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'sentinel'), 'keep');
    if (!createSymlinkOrSkip(outside, path.join(stateRoot, 'done'), 'dir')) {
      return;
    }

    expect(() => store.cleanupHistory(Date.now())).toThrow(/symbolic link/i);
    expect(fs.readFileSync(path.join(outside, 'sentinel'), 'utf8')).toBe(
      'keep'
    );
  });

  test('lists valid task directories while ignoring files and orphaned temporary files', () => {
    store.saveTask(snapshot('listed-task'));
    const stateRoot = path.join(root, 'download-tasks');
    fs.writeFileSync(path.join(stateRoot, 'not-a-directory'), 'ignore');
    fs.writeFileSync(path.join(stateRoot, 'orphan.tmp'), 'ignore');

    expect(store.listTasks().map((task) => task.taskId)).toEqual([
      'listed-task',
    ]);
  });
});
