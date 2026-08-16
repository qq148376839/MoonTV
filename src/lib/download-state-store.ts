import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { redactDownloadUrl, redactUrlsInText } from './download-transaction';
import type {
  DownloadFailure,
  DownloadStage,
  DownloadTaskSnapshot,
  DownloadTaskStatus,
  EpisodeDownloadState,
} from './download-types';

type EpisodeSummary = Omit<
  EpisodeDownloadState,
  | 'completedSegmentIndices'
  | 'failedSegmentIndices'
  | 'activeItems'
  | 'failures'
>;

type PersistedTask = Omit<DownloadTaskSnapshot, 'episodes'> & {
  episodes: Record<string, EpisodeSummary>;
};

const RECOVERABLE_TASK_STATUSES = new Set<DownloadTaskStatus>([
  'pending',
  'downloading',
  'paused',
]);

const TERMINAL_EPISODE_STAGES = new Set<DownloadStage>([
  'completed',
  'partial_failed',
  'cancelled_resumable',
]);

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

function episodeFileName(episode: number): string {
  if (!Number.isInteger(episode) || episode < 0) {
    throw new Error(`Invalid episode number: ${episode}`);
  }
  return `${String(episode).padStart(2, '0')}.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class DownloadStateStore {
  private readonly stateRoot: string;

  constructor(storageRoot: string) {
    this.stateRoot = path.resolve(storageRoot, 'download-tasks');
  }

  saveTask(snapshot: DownloadTaskSnapshot): void {
    this.assertTaskId(snapshot.taskId);
    const taskDir = this.taskDirectory(snapshot.taskId);
    const episodesDir = path.join(taskDir, 'episodes');
    const sanitized = this.sanitizeSnapshot(snapshot);

    fs.mkdirSync(episodesDir, { recursive: true });
    for (const state of Object.values(sanitized.episodes)) {
      this.writeJsonAtomically(
        path.join(episodesDir, episodeFileName(state.episode)),
        state
      );
    }
    this.writeJsonAtomically(
      path.join(taskDir, 'task.json'),
      this.toPersistedTask(sanitized)
    );
  }

  loadTask(taskId: string): DownloadTaskSnapshot {
    this.assertTaskId(taskId);
    const taskDir = this.taskDirectory(taskId);
    this.removeTemporaryFiles(taskDir);
    this.removeTemporaryFiles(path.join(taskDir, 'episodes'));
    const persisted = this.readPersistedTask(path.join(taskDir, 'task.json'));
    if (persisted.taskId !== taskId) {
      throw new Error(`Download task state taskId mismatch for ${taskId}`);
    }

    const episodes: Record<string, EpisodeDownloadState> = {};
    for (const [key, summary] of Object.entries(persisted.episodes)) {
      const episodePath = path.join(
        taskDir,
        'episodes',
        episodeFileName(summary.episode)
      );
      const state = this.readEpisodeState(episodePath);
      if (state.episode !== summary.episode) {
        throw new Error(`Episode state mismatch in ${episodePath}`);
      }
      episodes[key] = state;
    }

    return { ...persisted, episodes };
  }

  listTasks(): DownloadTaskSnapshot[] {
    if (!fs.existsSync(this.stateRoot)) return [];

    this.removeTemporaryFiles(this.stateRoot);
    return fs
      .readdirSync(this.stateRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && this.isSafeTaskId(entry.name))
      .map((entry) => this.loadTask(entry.name));
  }

  loadRecoverableTasks(): DownloadTaskSnapshot[] {
    return this.listTasks().flatMap((snapshot) => {
      const hasRecoverableEpisode = Object.values(snapshot.episodes).some(
        (episode) => !TERMINAL_EPISODE_STAGES.has(episode.stage)
      );
      if (
        !RECOVERABLE_TASK_STATUSES.has(snapshot.status) &&
        !hasRecoverableEpisode
      ) {
        return [];
      }

      const episodes = Object.fromEntries(
        Object.entries(snapshot.episodes).map(([key, episode]) => [
          key,
          TERMINAL_EPISODE_STAGES.has(episode.stage)
            ? episode
            : { ...episode, stage: 'recovery_wait' as const },
        ])
      );
      return [{ ...snapshot, status: 'recovery_wait', episodes }];
    });
  }

  deleteTaskState(taskId: string): void {
    this.assertTaskId(taskId);
    fs.rmSync(this.taskDirectory(taskId), { recursive: true, force: true });
  }

  cleanupHistory(now: number): { removed: string[] } {
    if (!fs.existsSync(this.stateRoot)) return { removed: [] };

    this.removeTemporaryFiles(this.stateRoot);
    const removed: string[] = [];
    for (const entry of fs.readdirSync(this.stateRoot, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory() || !this.isSafeTaskId(entry.name)) continue;

      const taskId = entry.name;
      const taskDir = this.taskDirectory(taskId);
      this.removeTemporaryFiles(taskDir);
      this.removeTemporaryFiles(path.join(taskDir, 'episodes'));
      const persisted = this.readPersistedTask(path.join(taskDir, 'task.json'));
      if (persisted.taskId !== taskId) {
        throw new Error(`Download task state taskId mismatch for ${taskId}`);
      }
      if (this.shouldRemove(persisted.status, persisted.updatedAt, now)) {
        fs.rmSync(taskDir, { recursive: true, force: true });
        removed.push(taskId);
      }
    }
    return { removed };
  }

  private sanitizeSnapshot(
    snapshot: DownloadTaskSnapshot
  ): DownloadTaskSnapshot {
    return {
      ...snapshot,
      episodes: Object.fromEntries(
        Object.entries(snapshot.episodes).map(([key, state]) => [
          key,
          {
            ...state,
            failures: state.failures.map((failure) =>
              this.sanitizeFailure(failure)
            ),
          },
        ])
      ),
    };
  }

  private sanitizeFailure(failure: DownloadFailure): DownloadFailure {
    return {
      ...failure,
      path: redactDownloadUrl(failure.path),
      message: redactUrlsInText(failure.message),
    };
  }

  private toPersistedTask(snapshot: DownloadTaskSnapshot): PersistedTask {
    return {
      ...snapshot,
      episodes: Object.fromEntries(
        Object.entries(snapshot.episodes).map(([key, state]) => {
          const {
            completedSegmentIndices: _completedSegmentIndices,
            failedSegmentIndices: _failedSegmentIndices,
            activeItems: _activeItems,
            failures: _failures,
            ...summary
          } = state;
          return [key, summary];
        })
      ),
    };
  }

  private readPersistedTask(filePath: string): PersistedTask {
    const parsed = this.readJson(filePath, 'task.json');
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== 1 ||
      !isRecord(parsed.episodes)
    ) {
      throw new Error(`Invalid download task state in ${filePath}`);
    }
    return parsed as unknown as PersistedTask;
  }

  private readEpisodeState(filePath: string): EpisodeDownloadState {
    const parsed = this.readJson(
      filePath,
      `episode state ${path.basename(filePath)}`
    );
    if (!isRecord(parsed) || typeof parsed.episode !== 'number') {
      throw new Error(`Invalid episode state in ${filePath}`);
    }
    return parsed as unknown as EpisodeDownloadState;
  }

  private readJson(filePath: string, label: string): unknown {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to read ${label} at ${filePath}: ${detail}`);
    }
  }

  private writeJsonAtomically(filePath: string, value: unknown): void {
    const temporaryPath = `${filePath}.${
      process.pid
    }.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(value), 'utf8');
      fs.renameSync(temporaryPath, filePath);
    } catch (error) {
      fs.rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  private shouldRemove(
    status: DownloadTaskStatus,
    updatedAt: number,
    now: number
  ): boolean {
    if (status === 'completed') return updatedAt <= now - SEVEN_DAYS;
    return (
      (status === 'failed' ||
        status === 'partial_completed' ||
        status === 'cancelled_resumable') &&
      updatedAt <= now - THIRTY_DAYS
    );
  }

  private taskDirectory(taskId: string): string {
    const directory = path.resolve(this.stateRoot, taskId);
    if (directory !== path.join(this.stateRoot, taskId)) {
      throw new Error(`Invalid taskId: ${taskId}`);
    }
    return directory;
  }

  private assertTaskId(taskId: string): void {
    if (!this.isSafeTaskId(taskId))
      throw new Error(`Invalid taskId: ${taskId}`);
  }

  private isSafeTaskId(taskId: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(taskId);
  }

  private removeTemporaryFiles(directory: string): void {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.tmp')) {
        fs.rmSync(path.join(directory, entry.name), { force: true });
      }
    }
  }
}
