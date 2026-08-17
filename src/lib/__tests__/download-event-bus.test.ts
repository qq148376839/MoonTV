import { DownloadEventBus } from '../download-event-bus';

describe('DownloadEventBus', () => {
  test('publishes monotonically and replays after the supplied id', () => {
    const bus = new DownloadEventBus(100);
    const first = bus.publish('task.updated', { taskId: 'a' });
    const second = bus.publish('episode.updated', { taskId: 'a', episode: 1 });

    expect(second.id).toBe(first.id + 1);
    expect(bus.since(second.id - 1)).toEqual([second]);
  });

  test('requires resync when requested history has fallen out of the buffer', () => {
    const bus = new DownloadEventBus(2);
    bus.publish('task.updated', { taskId: 'a' });
    bus.publish('task.updated', { taskId: 'b' });
    bus.publish('task.updated', { taskId: 'c' });

    expect(bus.since(0)).toBeNull();
    expect(bus.since(1)?.map((event) => event.id)).toEqual([2, 3]);
  });

  test('unsubscribes listeners', () => {
    const bus = new DownloadEventBus();
    const listener = jest.fn();
    const unsubscribe = bus.subscribe(listener);
    bus.publish('task.updated', {});
    unsubscribe();
    bus.publish('task.updated', {});
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('rejects invalid ids and capacities', () => {
    expect(() => new DownloadEventBus(0)).toThrow();
    expect(new DownloadEventBus().since(Number.NaN)).toBeNull();
  });
});
