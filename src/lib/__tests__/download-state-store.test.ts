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

  test('uses atomic replacements without tmp remnants and preserves old JSON when rename fails', () => {
    const first = snapshot();
    store.saveTask(first);
    const taskPath = path.join(
      root,
      'download-tasks',
      first.taskId,
      'task.json'
    );
    const original = fs.readFileSync(taskPath, 'utf8');
    const originalRename = fs.renameSync;
    const rename = jest.spyOn(fs, 'renameSync').mockImplementation(((
      source: fs.PathLike,
      destination: fs.PathLike
    ) => {
      if (String(destination) === taskPath) throw new Error('rename failed');
      return originalRename(source, destination);
    }) as typeof fs.renameSync);

    try {
      expect(() =>
        store.saveTask(snapshot('task-1', { title: 'new title' }))
      ).toThrow('rename failed');
    } finally {
      rename.mockRestore();
    }

    expect(fs.readFileSync(taskPath, 'utf8')).toBe(original);
    expect(fs.readdirSync(path.dirname(taskPath))).not.toContainEqual(
      expect.stringContaining('.tmp')
    );
    expect(store.loadTask('task-1').title).toBe('A title');
  });

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

  test('explicitly fails for malformed task JSON and missing episode state', () => {
    store.saveTask(snapshot());
    const taskDir = path.join(root, 'download-tasks', 'task-1');
    fs.writeFileSync(path.join(taskDir, 'task.json'), '{bad json');
    expect(() => store.loadTask('task-1')).toThrow(/task\.json/);

    store.saveTask(snapshot());
    fs.rmSync(path.join(taskDir, 'episodes', '02.json'));
    expect(() => store.loadTask('task-1')).toThrow(/episode.*02\.json/i);
  });

  test('rejects traversal task IDs', () => {
    expect(() => store.saveTask(snapshot('../escape'))).toThrow(/taskId/i);
    expect(() => store.loadTask('../task-1')).toThrow(/taskId/i);
    expect(() => store.deleteTaskState('nested/task')).toThrow(/taskId/i);
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
