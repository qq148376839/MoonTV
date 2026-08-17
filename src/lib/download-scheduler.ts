import type { DownloadWorkItem } from './download-types';

export type DownloadPriority = 'normal' | 'high';

export interface DownloadSchedulerOptions {
  concurrency: number;
}

export interface DownloadGlobalStats {
  concurrency: number;
  active: number;
  queued: number;
  tasks: number;
  pausedTasks: number;
}

export interface DownloadTaskStats {
  taskId: string;
  active: number;
  queued: number;
  paused: boolean;
  priority: DownloadPriority;
}

export class DownloadCancelledError extends Error {
  constructor(taskId: string) {
    super(`Queued download work for task "${taskId}" was cancelled.`);
    this.name = 'DownloadCancelledError';
  }
}

interface QueuedWork {
  taskId: string;
  item: DownloadWorkItem;
  operation: (item: DownloadWorkItem) => unknown;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

interface TaskState {
  queue: QueuedWork[];
  active: number;
  paused: boolean;
  priority: DownloadPriority;
}

export class DownloadScheduler {
  private readonly concurrency: number;
  private readonly tasks = new Map<string, TaskState>();
  private readonly highPriorityTasks = new Set<string>();
  private readonly idleWaiters: Array<() => void> = [];
  private round: string[] = [];
  private active = 0;
  private drainScheduled = false;

  constructor({ concurrency }: DownloadSchedulerOptions) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error('DownloadScheduler concurrency must be an integer >= 1.');
    }

    this.concurrency = concurrency;
  }

  enqueue<T>(
    item: DownloadWorkItem,
    operation: (item: DownloadWorkItem) => T | Promise<T>
  ): Promise<T> {
    const taskId = item.taskId;
    const task = this.getOrCreateTask(taskId);

    const promise = new Promise<T>((resolve, reject) => {
      task.queue.push({
        taskId,
        item,
        operation,
        resolve: (value) => resolve(value as T),
        reject,
      });
    });

    this.requestDrain();
    return promise;
  }

  pauseTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    task.paused = true;
  }

  resumeTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    task.paused = false;
    this.requestDrain();
  }

  cancelQueued(taskId: string): DownloadWorkItem[] {
    const task = this.tasks.get(taskId);
    if (!task || task.queue.length === 0) {
      return [];
    }

    const cancelled = task.queue.splice(0);
    const error = new DownloadCancelledError(taskId);
    cancelled.forEach((work) => work.reject(error));
    this.removeTaskIfEmpty(taskId, task);
    this.requestDrain();
    this.resolveIdleWaiters();
    return cancelled.map((work) => work.item);
  }

  setPriority(taskId: string, priority: DownloadPriority): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.priority = priority;
      return;
    }

    if (priority === 'high') {
      this.highPriorityTasks.add(taskId);
    } else {
      this.highPriorityTasks.delete(taskId);
    }
  }

  getGlobalStats(): DownloadGlobalStats {
    let queued = 0;
    let pausedTasks = 0;

    this.tasks.forEach((task) => {
      queued += task.queue.length;
      if (task.paused) {
        pausedTasks += 1;
      }
    });

    return {
      concurrency: this.concurrency,
      active: this.active,
      queued,
      tasks: this.tasks.size,
      pausedTasks,
    };
  }

  getTaskStats(taskId: string): DownloadTaskStats | null {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }

    return {
      taskId,
      active: task.active,
      queued: task.queue.length,
      paused: task.paused,
      priority: task.priority,
    };
  }

  onIdle(): Promise<void> {
    if (this.isIdle()) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  private getOrCreateTask(taskId: string): TaskState {
    const existing = this.tasks.get(taskId);
    if (existing) {
      return existing;
    }

    const task: TaskState = {
      queue: [],
      active: 0,
      paused: false,
      priority: this.highPriorityTasks.delete(taskId) ? 'high' : 'normal',
    };
    this.tasks.set(taskId, task);
    return task;
  }

  private requestDrain(): void {
    if (this.drainScheduled) {
      return;
    }

    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.concurrency) {
      const next = this.takeNext();
      if (!next) {
        break;
      }

      const { task, work } = next;
      this.active += 1;
      task.active += 1;
      this.run(work, task);
    }

    this.resolveIdleWaiters();
  }

  private takeNext(): { task: TaskState; work: QueuedWork } | null {
    for (;;) {
      if (this.round.length === 0) {
        this.createRound();
      }

      const taskId = this.round.shift();
      if (!taskId) {
        return null;
      }

      const task = this.tasks.get(taskId);
      if (!task || task.paused || task.queue.length === 0) {
        continue;
      }

      const work = task.queue.shift();
      if (!work) {
        continue;
      }

      return { task, work };
    }
  }

  private createRound(): void {
    this.tasks.forEach((task, taskId) => {
      if (task.paused || task.queue.length === 0) {
        return;
      }

      const weight = task.priority === 'high' ? 2 : 1;
      for (let index = 0; index < weight; index += 1) {
        this.round.push(taskId);
      }
    });
  }

  private run(work: QueuedWork, task: TaskState): void {
    Promise.resolve()
      .then(() => work.operation(work.item))
      .then(
        (value) => {
          this.complete(task, work);
          work.resolve(value);
        },
        (error: unknown) => {
          this.complete(task, work);
          work.reject(error);
        }
      );
  }

  private complete(task: TaskState, work: QueuedWork): void {
    this.active -= 1;
    task.active -= 1;
    this.removeTaskIfEmpty(work.taskId, task);
    this.requestDrain();
  }

  private removeTaskIfEmpty(taskId: string, task: TaskState): void {
    if (
      task.active === 0 &&
      task.queue.length === 0 &&
      this.tasks.get(taskId) === task
    ) {
      this.tasks.delete(taskId);
    }
  }

  private isIdle(): boolean {
    return this.active === 0 && this.getGlobalStats().queued === 0;
  }

  private resolveIdleWaiters(): void {
    if (!this.isIdle()) {
      return;
    }

    this.idleWaiters.splice(0).forEach((resolve) => resolve());
  }
}
