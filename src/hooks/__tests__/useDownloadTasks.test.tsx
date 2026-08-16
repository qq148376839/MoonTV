import { act, render, screen, waitFor } from '@testing-library/react';

import { useDownloadTasks } from '../useDownloadTasks';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const response = (progress: number) =>
  ({
    ok: true,
    json: async () => ({
      tasks: [
        {
          task_id: 'task-1',
          title: '最佳损友',
          status: 'downloading',
          progress,
          created_at: 1,
          updated_at: progress,
        },
      ],
    }),
  } as Response);

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, EventListener[]>();

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, listener: EventListener) {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  emit(name: string, data: object) {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }

  close() {
    return undefined;
  }
}

function Harness() {
  const state = useDownloadTasks();
  return (
    <>
      <span data-testid='connection'>{state.connection}</span>
      <span data-testid='progress'>{state.tasks[0]?.progress ?? 'none'}</span>
    </>
  );
}

describe('useDownloadTasks refresh coordination', () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;

  beforeEach(() => {
    FakeEventSource.instances = [];
    globalThis.EventSource =
      FakeEventSource as unknown as typeof globalThis.EventSource;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
    jest.useRealTimers();
  });

  test('coalesces SSE refreshes and ignores a superseded response', async () => {
    const superseded = deferred<Response>();
    const newest = deferred<Response>();
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(response(10))
      .mockReturnValueOnce(superseded.promise)
      .mockReturnValueOnce(newest.promise);

    render(<Harness />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    act(() => FakeEventSource.instances[0].onopen?.());
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));

    act(() => {
      FakeEventSource.instances[0].emit('segment.batch', {
        taskId: 'task-1',
        progress: 20,
      });
      FakeEventSource.instances[0].emit('segment.batch', {
        taskId: 'task-1',
        progress: 30,
      });
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    await act(async () => superseded.resolve(response(15)));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3));
    expect(screen.getByTestId('progress')).toHaveTextContent('30');

    await act(async () => newest.resolve(response(40)));
    expect(await screen.findByTestId('progress')).toHaveTextContent('40');
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  test('does not schedule another poll after SSE reconnects', async () => {
    jest.useFakeTimers();
    const polling = deferred<Response>();
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(response(10))
      .mockReturnValueOnce(polling.promise)
      .mockResolvedValue(response(30));

    render(<Harness />);
    await act(async () => Promise.resolve());
    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => FakeEventSource.instances[0].onerror?.());
    expect(screen.getByTestId('connection')).toHaveTextContent('polling');

    act(() => jest.advanceTimersByTime(5000));
    expect(FakeEventSource.instances).toHaveLength(2);
    act(() => FakeEventSource.instances[1].onopen?.());
    expect(screen.getByTestId('connection')).toHaveTextContent('live');

    await act(async () => polling.resolve(response(20)));
    await act(async () => jest.advanceTimersByTime(8000));
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });
});
