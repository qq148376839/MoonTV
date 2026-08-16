import {
  DownloadCancelledError,
  DownloadScheduler,
} from '../download-scheduler';
import type { DownloadWorkItem } from '../download-types';

const item = (taskId: string, index = 0): DownloadWorkItem => ({
  taskId,
  episode: 1,
  generationId: 'generation-1',
  kind: 'segment',
  index,
  attempt: 0,
});

const deferred = <T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('DownloadScheduler', () => {
  test('shares a fixed global maximum of three active operations', async () => {
    const scheduler = new DownloadScheduler({ concurrency: 3 });
    const gates = Array.from({ length: 6 }, () => deferred<void>());
    let active = 0;
    let maximumActive = 0;

    const operations = gates.map((gate, index) =>
      scheduler.enqueue(item(`task-${index % 2}`, index), async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await gate.promise;
        active -= 1;
      })
    );

    await flush();
    expect(maximumActive).toBe(3);
    expect(scheduler.getGlobalStats().active).toBe(3);

    gates.forEach((gate) => gate.resolve());
    await Promise.all(operations);
  });

  test('round-robins normal-priority tasks so a later task is not starved', async () => {
    const scheduler = new DownloadScheduler({ concurrency: 1 });
    const order: string[] = [];
    const first = deferred<void>();

    const firstA = scheduler.enqueue(item('A', 0), async () => {
      order.push('A0');
      await first.promise;
    });
    scheduler.enqueue(item('A', 1), () => order.push('A1'));
    scheduler.enqueue(item('A', 2), () => order.push('A2'));
    await flush();
    scheduler.enqueue(item('B', 0), () => order.push('B0'));

    first.resolve();
    await firstA;
    await scheduler.onIdle();

    expect(order).toEqual(['A0', 'A1', 'B0', 'A2']);
  });

  test('pauses only future dispatches and resumes queued work', async () => {
    const scheduler = new DownloadScheduler({ concurrency: 1 });
    const first = deferred<void>();
    const order: string[] = [];

    const active = scheduler.enqueue(item('A', 0), async () => {
      order.push('first');
      await first.promise;
    });
    const queued = scheduler.enqueue(item('A', 1), () => {
      order.push('second');
    });
    await flush();
    scheduler.pauseTask('A');
    first.resolve();
    await active;
    await flush();

    expect(order).toEqual(['first']);
    expect(scheduler.getTaskStats('A')).toMatchObject({
      active: 0,
      queued: 1,
      paused: true,
    });

    scheduler.resumeTask('A');
    await queued;
    expect(order).toEqual(['first', 'second']);
  });

  test('gives high priority two opportunities per round without exceeding capacity', async () => {
    const scheduler = new DownloadScheduler({ concurrency: 2 });
    const order: string[] = [];
    let active = 0;
    let maximumActive = 0;

    const enqueue = (taskId: string, index: number): Promise<void> =>
      scheduler.enqueue(item(taskId, index), async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        order.push(`${taskId}${index}`);
        await Promise.resolve();
        active -= 1;
      });

    const work = [
      enqueue('A', 0),
      enqueue('A', 1),
      enqueue('A', 2),
      enqueue('A', 3),
      enqueue('B', 0),
      enqueue('B', 1),
    ];
    scheduler.setPriority('A', 'high');
    await Promise.all(work);

    expect(order.slice(0, 3).map((entry) => entry[0])).toEqual(['A', 'A', 'B']);
    expect(order.slice(3).map((entry) => entry[0])).toEqual(['A', 'A', 'B']);
    expect(maximumActive).toBeLessThanOrEqual(2);
  });

  test('cancels queued promises but lets active work complete', async () => {
    const scheduler = new DownloadScheduler({ concurrency: 1 });
    const gate = deferred<void>();
    let completed = false;
    const active = scheduler.enqueue(item('A', 0), async () => {
      await gate.promise;
      completed = true;
    });
    const cancelled = scheduler.enqueue(item('A', 1), () => undefined);
    await flush();

    scheduler.cancelQueued('A');
    await expect(cancelled).rejects.toBeInstanceOf(DownloadCancelledError);
    gate.resolve();
    await active;

    expect(completed).toBe(true);
    expect(scheduler.getTaskStats('A')).toBeNull();
  });

  test('releases a slot after rejection, continues scheduling, and resolves onIdle', async () => {
    const scheduler = new DownloadScheduler({ concurrency: 1 });
    const failure = new Error('download failed');
    let followedFailure = false;

    const rejected = scheduler.enqueue(item('A', 0), () => {
      throw failure;
    });
    const next = scheduler.enqueue(item('A', 1), () => {
      followedFailure = true;
    });
    const idle = scheduler.onIdle();

    await expect(rejected).rejects.toBe(failure);
    await next;
    await expect(idle).resolves.toBeUndefined();
    expect(followedFailure).toBe(true);
  });

  test('reports accurate global and per-task stats without retaining empty tasks', async () => {
    const scheduler = new DownloadScheduler({ concurrency: 2 });
    const gate = deferred<void>();
    const blocker = scheduler.enqueue(item('B', 0), () => gate.promise);
    const active = scheduler.enqueue(item('A', 0), () => gate.promise);
    const queued = scheduler.enqueue(item('A', 1), () => undefined);
    await flush();
    scheduler.pauseTask('A');

    expect(scheduler.getGlobalStats()).toEqual({
      concurrency: 2,
      active: 2,
      queued: 1,
      tasks: 2,
      pausedTasks: 1,
    });
    expect(scheduler.getTaskStats('A')).toEqual({
      taskId: 'A',
      active: 1,
      queued: 1,
      paused: true,
      priority: 'normal',
    });

    scheduler.resumeTask('A');
    gate.resolve();
    await Promise.all([blocker, active, queued]);
    expect(scheduler.getGlobalStats()).toEqual({
      concurrency: 2,
      active: 0,
      queued: 0,
      tasks: 0,
      pausedTasks: 0,
    });
    expect(scheduler.getTaskStats('A')).toBeNull();
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid concurrency %p',
    (concurrency) => {
      expect(() => new DownloadScheduler({ concurrency })).toThrow(
        /concurrency/i
      );
    }
  );

  test('resolves onIdle immediately when there is no work', async () => {
    const scheduler = new DownloadScheduler({ concurrency: 1 });
    await expect(scheduler.onIdle()).resolves.toBeUndefined();
  });

  test('handles one thousand immediately resolved operations without recursive stack growth', async () => {
    const scheduler = new DownloadScheduler({ concurrency: 1 });
    let completed = 0;

    const work = Array.from({ length: 1000 }, (_, index) =>
      scheduler.enqueue(item('A', index), () => {
        completed += 1;
      })
    );

    await Promise.all(work);
    await scheduler.onIdle();
    expect(completed).toBe(1000);
  });
});
